// 2 系統（legacy を送った run / compiled を送った run）の A/B 比較経路
// （ADR-006 / #1880、`river evolve prompt-ab`）のテスト。
//
// 入力は手書きの stub ではなく、**本番経路が実際に作った run レコード**である。
// generateReview（observe / active）→ buildRunRecord を通したものを使う。観測の
// 形を手で書くと、review-engine 側が記録キーを変えてもテストだけが古い形のまま
// 通り続ける。
//
// SSoT の import を機械保証する観点（CLAUDE.md「Import the SSoT, never
// re-derive it」）:
//   - case key / run id / manifest 導出を自前で書いていないことを、
//     **既存 production 経路の出力**（buildPairedReplay / buildExperimentManifest /
//     deriveCaseKey / deriveReviewRunId）との突合で確かめる。自分の実装同士を
//     比べる自己整合テストにしない。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import { generateReview } from '../src/lib/review-engine.mjs';
import { buildRunRecord, saveRunRecord } from '../src/lib/result-store.mjs';
import {
  buildExperimentManifest,
  buildPairedReplay,
  deriveCaseKey,
} from '../src/lib/paired-replay.mjs';
import { deriveReviewRunId } from '../src/lib/shadow-aggregate.mjs';
import {
  ACCEPTANCE_COVERAGE,
  LATENCY_COST_UNBLOCKED_BY,
  LEGACY_CONFIG_ID,
  PROMPT_AB_ACCEPTANCE_COVERAGE,
  PROMPT_AB_ROUTE,
  PROMPT_AB_UNBLOCKED_BY,
  PROMPT_COMPARE_ROUTE,
  PromptComparisonError,
  buildPromptAbComparison,
  buildPromptAbSpec,
  buildPromptComparison,
  compiledConfigId,
  formatPromptAbMarkdown,
  resolveAbAcceptanceCoverage,
} from '../src/lib/prompt-compiler-paired.mjs';
import { runCliInProcess } from './helpers/cli.mjs';

const NOW = new Date('2026-08-26T00:00:00.000Z');
const REPO_ROOT = '/workspace/repo-under-review';

const plan = {
  selected: [{ metadata: { id: 'skill-1', name: 'Skill One', phase: 'midstream' } }],
  skipped: [],
};

/**
 * globalThis.fetch を stub に差し替え、後始末まで面倒を見る。
 *
 * `tests/prompt-compiler-active.test.mjs` の `withCountedFetch` と同じ形である。
 * これを使うと `debug.llmUsed === true` の run が作れる。dryRun だけで作った
 * fixture では `llmUsed` が常に false になり、#1880 B1（LLM 応答が無い run を
 * 「別々の応答」として報告する欠陥）を原理的に検出できない。
 */
async function withStubbedLlm(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'NO_ISSUES' } }] }),
    text: async () => '',
    headers: { get: () => null },
  });
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * 1 回レビューを走らせ、保存形式の run レコードを返す。
 *
 * `mode` が observe なら sentPrompt=legacy、active なら compiled。
 * `llm` が `'used'` なら apiKey + fetch stub で LLM 応答のある run になり
 * （`debug.llmUsed === true`）、`'skipped'` なら dryRun で呼び出し自体が
 * 起きない run になる（`llmUsed === false` / `llmSkipped: 'dry-run enabled'`）。
 * `sentPrompt` は **どちらでも mode どおり**である点が #1880 B1 の核心である。
 */
async function makeRecord({
  n,
  mode,
  runId,
  findings,
  llm = 'used',
  repoRoot = REPO_ROOT,
  configExtra = {},
  recordExtra = {},
} = {}) {
  const diffText = `diff --git a/src/app${n}.ts b/src/app${n}.ts
--- a/src/app${n}.ts
+++ b/src/app${n}.ts
@@ -10,0 +11,2 @@
+const value = ${n};
+console.log(value);
`;
  const args = {
    diff: {
      diffText,
      files: [{ path: `src/app${n}.ts`, addedLines: [11, 12], hunks: [] }],
      changedFiles: [`src/app${n}.ts`],
    },
    plan,
    phase: 'midstream',
    includeFallback: false,
    config: {
      review: { promptCompiler: { mode } },
      model: { provider: 'openai', modelName: 'test-model' },
      ...configExtra,
    },
  };
  const review =
    llm === 'used'
      ? await withStubbedLlm(() => generateReview({ ...args, apiKey: 'test-key' }))
      : await generateReview({ ...args, dryRun: true });
  return buildRunRecord(
    {
      // 実 FS には触れない。case key の材料になる文字列としてだけ使う。
      repoRoot,
      mergeBase: `base-${n}`,
      findings,
      changedFiles: [`src/app${n}.ts`],
      reviewDebug: review.debug,
      commitSha: String(n).repeat(40),
      ...recordExtra,
    },
    { phase: 'midstream', runId }
  );
}

/** case n の baseline（legacy を送った observe の run）。 */
function baselineFindings(n) {
  return [
    { fingerprint: `fp-${n}-a`, severity: 'critical', file: `src/app${n}.ts`, title: `crit-${n}` },
    { fingerprint: `fp-${n}-b`, severity: 'minor', file: `src/app${n}.ts`, title: `nit-${n}` },
  ];
}

/**
 * case n の candidate（compiled を送った active の run）。
 * `fp-${n}-a` を critical から major へ**下げて**ある。paired-replay の定義では
 * 「candidate が baseline の critical を失った / 下げた」ことが critical 回帰
 * なので（`pairFindings` のコメント）、これで 1 case あたり 1 件の回帰が出る。
 */
function candidateFindings(n) {
  return [
    { fingerprint: `fp-${n}-a`, severity: 'major', file: `src/app${n}.ts`, title: `crit-${n}` },
    { fingerprint: `fp-${n}-b`, severity: 'minor', file: `src/app${n}.ts`, title: `nit-${n}` },
  ];
}

let DATASET;
/** legacy 側 2 件 / compiled 側 2 件、case は 2 つ（両側に同じ case がある）。 */
async function dataset() {
  DATASET ??= [
    await makeRecord({
      n: 1,
      mode: 'observe',
      runId: 'run-legacy-1',
      findings: baselineFindings(1),
    }),
    await makeRecord({
      n: 2,
      mode: 'observe',
      runId: 'run-legacy-2',
      findings: baselineFindings(2),
    }),
    await makeRecord({
      n: 1,
      mode: 'active',
      runId: 'run-compiled-1',
      findings: candidateFindings(1),
    }),
    await makeRecord({
      n: 2,
      mode: 'active',
      runId: 'run-compiled-2',
      findings: candidateFindings(2),
    }),
  ];
  return DATASET;
}

let SKIPPED_DATASET;
/**
 * 同じ 2 系統だが、**LLM 呼び出しが起きていない** dataset（#1880 B1）。
 * dryRun なので `llmUsed: false` / `llmSkipped: 'dry-run enabled'` になる。
 * `sentPrompt` は mode どおり legacy / compiled が入る。
 */
async function skippedDataset() {
  SKIPPED_DATASET ??= [
    await makeRecord({
      n: 1,
      mode: 'observe',
      llm: 'skipped',
      runId: 'run-legacy-skipped-1',
      findings: baselineFindings(1),
    }),
    await makeRecord({
      n: 1,
      mode: 'active',
      llm: 'skipped',
      runId: 'run-compiled-skipped-1',
      findings: candidateFindings(1),
    }),
  ];
  return SKIPPED_DATASET;
}

describe('#1880 B1 LLM 応答が無い run を「応答差」として報告しない', () => {
  test('前提の実測: sentPrompt は mode から決まり、応答の有無は llmUsed が持つ', async () => {
    const [skippedLegacy, skippedCompiled] = await skippedDataset();
    // 送信物の宣言は mode どおり入る。
    assert.equal(skippedCompiled.debug.execution.promptCompiler.sentPrompt, 'compiled');
    // しかし LLM 呼び出しは起きていない。
    assert.equal(skippedCompiled.debug.llmUsed, false);
    assert.equal(skippedCompiled.debug.llmSkipped, 'dry-run enabled');
    assert.equal(skippedLegacy.debug.llmUsed, false);
    // 対照: 応答のある dataset は llmUsed が true で llmSkipped を持たない。
    const [used] = await dataset();
    assert.equal(used.debug.llmUsed, true);
    assert.equal('llmSkipped' in used.debug, false);
  });

  test('応答が無い dataset は findings 水準を観測不可として報告する', async () => {
    const result = buildPromptAbComparison({ runRecords: await skippedDataset(), now: NOW });
    assert.equal(result.findingComparison.observable, false);
    assert.match(result.findingComparison.reason, /実際の応答差ではない/);
    assert.match(result.findingComparison.reason, /debug\.llmUsed === true/);
    // null は「観測できなかった」であり 0 でも false でもない。
    assert.equal(result.findingComparison.criticalRegressionCount, null);
    assert.equal(result.findingComparison.criticalRegressionZero, null);
    assert.equal(result.llmResponseCoverage.respondedCaseCount, 0);
    assert.equal(result.llmResponseCoverage.baseline.llmUsedRunCount, 0);
    assert.equal(result.llmResponseCoverage.candidate.llmUsedRunCount, 0);
    assert.deepEqual(result.llmResponseCoverage.candidate.skipReasons, [
      { reason: 'dry-run enabled', runCount: 1 },
    ]);
  });

  test('応答が無いと critical 回帰の行も観測不可へ下がる（token の行は下がらない）', async () => {
    const result = buildPromptAbComparison({ runRecords: await skippedDataset(), now: NOW });
    const byMetric = new Map(result.acceptanceCoverage.map((row) => [row.metric, row]));
    assert.equal(byMetric.get('critical 回帰').observable, false);
    assert.match(byMetric.get('critical 回帰').unblockedBy, /LLM 応答を持つ run/);
    // 送信前の推定長は応答が無くても測れる。全面拒否にしない理由がこれである。
    assert.equal(byMetric.get('token（送信前のプロンプト推定長）').observable, true);
    // 解決前の静的表は critical 回帰を可としている（dataset 依存であることの対照）。
    assert.equal(
      PROMPT_AB_ACCEPTANCE_COVERAGE.find((row) => row.metric === 'critical 回帰').observable,
      true
    );
    assert.equal(
      resolveAbAcceptanceCoverage({ findingsObservable: true }).find(
        (row) => row.metric === 'critical 回帰'
      ).observable,
      true
    );
  });

  test('応答がある dataset は従来どおり観測可で、応答数が成果物に出る', async () => {
    const result = buildPromptAbComparison({ runRecords: await dataset(), now: NOW });
    assert.equal(result.findingComparison.observable, true);
    assert.equal(result.llmResponseCoverage.findingsObservable, true);
    assert.equal(result.llmResponseCoverage.respondedCaseCount, 2);
    assert.deepEqual(result.llmResponseCoverage.respondedCaseKeys, result.pairedCaseKeys);
    assert.equal(result.llmResponseCoverage.baseline.llmUsedRunCount, 2);
    assert.equal(result.llmResponseCoverage.candidate.llmUsedRunCount, 2);
    assert.equal(result.llmResponseCoverage.baseline.llmUnknownRunCount, 0);
  });

  test('片側だけ応答がある case は観測可にしない', async () => {
    const [legacyUsed] = await dataset();
    const [, compiledSkipped] = await skippedDataset();
    // baseline は応答あり / candidate は応答なし。同じ case（base-1）である。
    const result = buildPromptAbComparison({
      runRecords: [legacyUsed, compiledSkipped],
      now: NOW,
    });
    assert.equal(result.llmResponseCoverage.baseline.llmUsedRunCount, 1);
    assert.equal(result.llmResponseCoverage.candidate.llmUsedRunCount, 0);
    assert.equal(result.findingComparison.observable, false);
  });

  test('llmUsed を持たない古いレコードは false と区別して数える', async () => {
    const [legacy, , compiled] = await dataset();
    const strip = (record) => {
      const { llmUsed, ...rest } = record.debug;
      void llmUsed;
      return { ...record, debug: rest };
    };
    const result = buildPromptAbComparison({
      runRecords: [strip(legacy), strip(compiled)],
      now: NOW,
    });
    assert.equal(result.llmResponseCoverage.baseline.llmUnknownRunCount, 1);
    assert.equal(result.llmResponseCoverage.baseline.llmUnusedRunCount, 0);
    // 未取得は「応答があった」とは読まない。
    assert.equal(result.findingComparison.observable, false);
  });

  test('Markdown は LLM 応答の充足度を findings 水準より前に出す', async () => {
    const text = formatPromptAbMarkdown(
      buildPromptAbComparison({ runRecords: await skippedDataset(), now: NOW })
    );
    const coverageAt = text.indexOf('### LLM 応答の充足度');
    const findingsAt = text.indexOf('### findings 水準');
    assert.ok(coverageAt > -1 && findingsAt > -1);
    assert.ok(coverageAt < findingsAt, 'LLM 応答の充足度が findings 水準より後ろにある');
    assert.ok(text.includes('dry-run enabled × 1'));
    assert.ok(text.includes('findings 水準の比較: 不可'));
  });
});

describe('#1880 2 系統が sentPrompt で正しく組になる', () => {
  test('baseline は legacy を送った run、candidate は compiled を送った run である', async () => {
    const records = await dataset();
    const result = buildPromptAbComparison({ runRecords: records, now: NOW });

    assert.deepEqual(result.sides.baseline.runIds, ['run-legacy-1', 'run-legacy-2']);
    assert.deepEqual(result.sides.candidate.runIds, ['run-compiled-1', 'run-compiled-2']);
    assert.equal(result.sides.baseline.sentPrompt, 'legacy');
    assert.equal(result.sides.candidate.sentPrompt, 'compiled');
    assert.deepEqual(result.sides.baseline.modes, ['observe']);
    assert.deepEqual(result.sides.candidate.modes, ['active']);
    assert.equal(result.sides.baseline.configId, LEGACY_CONFIG_ID);
    assert.equal(
      result.sides.candidate.configId,
      compiledConfigId({ profileId: 'openai-review-v1', profileVersion: '1' })
    );

    // 同じレコードが両側に入らない（sentPrompt は 1 値なので構造上起こらない）。
    const overlap = result.sides.baseline.runIds.filter((id) =>
      result.sides.candidate.runIds.includes(id)
    );
    assert.deepEqual(overlap, []);
    assert.equal(result.sameRecordOnBothSides, false);

    // spec の両側も別レコードである（observe 経路はここが同一配列になる）。
    const spec = result.spec;
    assert.notDeepEqual(spec.baseline.runs, spec.candidate.runs);
    assert.equal(spec.baseline.runs.length, 2);
    assert.equal(spec.candidate.runs.length, 2);
  });

  test('組になった case は deriveCaseKey（SSoT）の交差そのものである', async () => {
    const records = await dataset();
    const result = buildPromptAbComparison({ runRecords: records, now: NOW });

    const legacyKeys = new Set(records.slice(0, 2).map(deriveCaseKey));
    const compiledKeys = new Set(records.slice(2).map(deriveCaseKey));
    const expected = [...legacyKeys].filter((key) => compiledKeys.has(key)).sort();
    assert.deepEqual(result.pairedCaseKeys, expected);

    // 対照: production 経路（buildPairedReplay）が出す case key とも一致する。
    const production = buildPairedReplay(result.spec, { now: NOW });
    assert.deepEqual(
      production.pairing.cases.map((c) => c.caseKey).sort(),
      [...result.pairedCaseKeys].sort()
    );
  });

  test('明示 caseId（空白・NFD 込み）でも production の case key と一致する', async () => {
    const [l1, l2, c1, c2] = await dataset();
    const tricky = [
      { ...l1, caseId: '  case̊-1  ' },
      { ...l2, caseId: '  case̊-2  ' },
      { ...c1, caseId: '  case̊-1  ' },
      { ...c2, caseId: '  case̊-2  ' },
    ];
    const result = buildPromptAbComparison({ runRecords: tricky, now: NOW });
    assert.deepEqual(result.pairedCaseKeys, [...new Set(tricky.map(deriveCaseKey))].sort());
  });

  test('run id / manifest は production の導出そのものである', async () => {
    const records = await dataset();
    const result = buildPromptAbComparison({ runRecords: records, now: NOW });

    assert.deepEqual(
      [...result.replay.manifest.baseline.reviewRunIds].sort(),
      records.slice(0, 2).map(deriveReviewRunId).sort()
    );
    assert.deepEqual(
      [...result.replay.manifest.candidate.reviewRunIds].sort(),
      records.slice(2).map(deriveReviewRunId).sort()
    );

    const production = buildExperimentManifest(result.spec, { now: NOW });
    // バイト等価。manifestId / experimentKey / manifestHash を手で組んでいない。
    assert.equal(JSON.stringify(result.replay.manifest), JSON.stringify(production.manifest));
    assert.ok(result.replay.manifest.manifestId.startsWith('RR-EXP-'));
    assert.equal(result.replay.manifestVerification.verified, true);
  });

  test('findings 水準が観測でき、critical 回帰が paired diff から出る', async () => {
    const result = buildPromptAbComparison({ runRecords: await dataset(), now: NOW });
    assert.equal(result.findingComparison.observable, true);
    assert.equal(result.findingComparison.pairedCaseCount, 2);
    // candidate 側で critical -> major に下げた 1 件 × 2 case。
    assert.equal(result.findingComparison.counts.changedFindingCount, 2);
    assert.equal(result.findingComparison.counts.unchangedFindingCount, 2);
    assert.equal(result.findingComparison.criticalRegressionCount, 2);
    assert.equal(result.findingComparison.criticalRegressionZero, false);
    // 既存モジュール側の判定と一致していること（自前判定にしていない）。
    assert.equal(
      result.findingComparison.criticalRegressionCount,
      result.replay.acceptance.contract6.criticalRegressionCount
    );
    assert.equal(
      result.findingComparison.activationVerified,
      result.replay.activationCheck.verified
    );
    // 構成が違い、かつ差分が観測できたので activation は verified になる。
    assert.equal(result.replay.activationCheck.configurationDiffers, true);
    assert.equal(result.replay.activationCheck.observedDifference, true);
  });

  test('各側の推定長は「実際に送ったプロンプト」の値である', async () => {
    const records = await dataset();
    const result = buildPromptAbComparison({ runRecords: records, now: NOW });
    for (const record of records) {
      const observation = record.debug.execution.promptCompiler;
      const row = result.promptMetrics.runs.find((r) => r.runId === deriveReviewRunId(record));
      const expected =
        observation.sentPrompt === 'legacy'
          ? observation.legacyPromptEstimate
          : observation.compiledPromptEstimate;
      assert.equal(row.sentPromptEstimate, expected);
      assert.equal(
        row.sentPromptHash,
        observation.sentPrompt === 'legacy'
          ? observation.legacyPromptHash
          : observation.compiledPromptHash
      );
    }
    const legacyTotal = records
      .slice(0, 2)
      .reduce((acc, r) => acc + r.debug.execution.promptCompiler.legacyPromptEstimate, 0);
    assert.equal(result.promptMetrics.baselineSentEstimateTotal, legacyTotal);
    // 全 run が対になっているので、この dataset では合計＝全件合計になる。
    assert.equal(result.promptMetrics.estimateScope, 'paired-case');
    assert.equal(result.promptMetrics.baselinePairedRunCount, 2);
    assert.equal(result.promptMetrics.candidatePairedRunCount, 2);
    assert.equal(result.promptMetrics.estimateComparable, true);
  });
});

describe('#1880 M1 推定長合計は対になった run だけを足す', () => {
  test('片側にだけある case の run は合計へ入らない', async () => {
    const [legacy1, legacy2, compiled1] = await dataset();
    // baseline に case 2 があり candidate には無い。対になるのは case 1 だけ。
    const result = buildPromptAbComparison({
      runRecords: [legacy1, legacy2, compiled1],
      now: NOW,
    });
    assert.equal(result.pairedCaseKeys.length, 1);
    assert.equal(result.promptMetrics.baselineRunCount, 2);
    assert.equal(result.promptMetrics.baselinePairedRunCount, 1);
    assert.deepEqual(result.promptMetrics.unpairedRunCount, { baseline: 1, candidate: 0 });

    // 合計は case 1 の 1 run 分だけである（case 2 を足し込まない）。
    const observation = legacy1.debug.execution.promptCompiler;
    assert.equal(result.promptMetrics.baselineSentEstimateTotal, observation.legacyPromptEstimate);
    // 対になった run 数が両側で一致するので差は出せる。
    assert.equal(result.promptMetrics.estimateComparable, true);
    assert.equal(
      result.promptMetrics.estimateDeltaTotal,
      compiled1.debug.execution.promptCompiler.compiledPromptEstimate -
        observation.legacyPromptEstimate
    );
  });

  test('対になった run 数が両側で違うと差を出さず理由を添える', async () => {
    const [legacy1, , compiled1] = await dataset();
    // 同じ case を baseline 側だけ 2 run にする（繰り返し計測の形）。
    const legacy1b = await makeRecord({
      n: 1,
      mode: 'observe',
      runId: 'run-legacy-1b',
      findings: baselineFindings(1),
    });
    const result = buildPromptAbComparison({
      runRecords: [legacy1, legacy1b, compiled1],
      now: NOW,
    });
    assert.equal(result.promptMetrics.baselinePairedRunCount, 2);
    assert.equal(result.promptMetrics.candidatePairedRunCount, 1);
    assert.equal(result.promptMetrics.estimateComparable, false);
    // null は 0 ではない。母集団サイズの差を「短くなった」と読ませない。
    assert.equal(result.promptMetrics.estimateDeltaTotal, null);
    assert.match(result.promptMetrics.estimateDeltaUnavailableReason, /母集団サイズの差/);

    const text = formatPromptAbMarkdown(result);
    assert.ok(text.includes('比較不可'));
    assert.ok(text.includes('対象範囲: paired-case'));
  });
});

describe('#1880 observe の run と 2 系統を取り違えない', () => {
  test('observe だけの dataset は prompt-ab が受理せず prompt-compare へ回す', async () => {
    const observeOnly = (await dataset()).slice(0, 2);
    assert.throws(() => buildPromptAbComparison({ runRecords: observeOnly, now: NOW }), {
      name: 'PromptComparisonError',
      message: /sentPrompt: compiled）が 1 件も無い/,
    });
    // 同じ dataset を observe 経路へ渡すと、こちらは従来どおり成立する。
    const compare = buildPromptComparison({ runRecords: observeOnly, now: NOW });
    assert.equal(compare.mode, 'prompt-compiler-paired');
  });

  test('compiled だけの dataset は baseline が無いので受理しない', async () => {
    const compiledOnly = (await dataset()).slice(2);
    assert.throws(() => buildPromptAbComparison({ runRecords: compiledOnly, now: NOW }), {
      name: 'PromptComparisonError',
      message: /sentPrompt: legacy）が 1 件も無い/,
    });
  });

  test('成果物だけで経路を判別できる（route / mode / sameRecordOnBothSides）', async () => {
    const records = await dataset();
    const ab = buildPromptAbComparison({ runRecords: records, now: NOW });
    const compare = buildPromptComparison({ runRecords: records.slice(0, 2), now: NOW });

    assert.equal(ab.route, PROMPT_AB_ROUTE);
    assert.equal(compare.route, PROMPT_COMPARE_ROUTE);
    assert.notEqual(ab.route, compare.route);
    assert.equal(ab.mode, 'prompt-compiler-ab');
    assert.equal(compare.mode, 'prompt-compiler-paired');
    assert.equal(ab.sameRecordOnBothSides, false);
    assert.equal(compare.sameRecordOnBothSides, true);
    // observe 経路は candidate 側も legacy を送っている（configId は compiled）。
    assert.equal(compare.sides.candidate.sentPrompt, 'legacy');
    assert.equal(ab.sides.candidate.sentPrompt, 'compiled');

    // Markdown の 1 行目付近にも経路が出る。
    const text = formatPromptAbMarkdown(ab);
    assert.ok(text.includes(`\`${PROMPT_AB_ROUTE}\``));
    assert.ok(text.includes('両側が同一レコードか | いいえ'));
  });

  test('既存 prompt-compare の legacy 限定拒否は従来どおり発火する（回帰防止）', async () => {
    const records = await dataset();
    // 2 系統が混ざった dataset を observe 経路へ渡す = #1860 の安全弁の対象。
    assert.throws(() => buildPromptComparison({ runRecords: records, now: NOW }), {
      name: 'PromptComparisonError',
      message: /sentPrompt が legacy でない run が 2 件ある/,
    });
    // 拒否メッセージは #1861 と新経路の両方を指す。
    assert.throws(() => buildPromptComparison({ runRecords: records, now: NOW }), {
      message: /#1861/,
    });
    assert.throws(() => buildPromptComparison({ runRecords: records, now: NOW }), {
      message: /river evolve prompt-ab/,
    });
  });
});

describe('#1880 Experiment Manifest の pin が効く', () => {
  test('モデルが混ざった集合は組にできない', async () => {
    const [l1, l2, c1, c2] = await dataset();
    const otherModel = { ...c1, debug: { ...c1.debug, llmModel: 'another-model' } };
    assert.throws(
      () => buildPromptAbComparison({ runRecords: [l1, l2, otherModel, c2], now: NOW }),
      { message: /model が run ごとに異なる/ }
    );
  });

  test('profile が混ざった集合は組にできない', async () => {
    const [l1, l2, c1, c2] = await dataset();
    const otherProfile = {
      ...c1,
      debug: {
        ...c1.debug,
        execution: {
          promptCompiler: { ...c1.debug.execution.promptCompiler, profileId: 'generic-review-v1' },
        },
      },
    };
    assert.throws(
      () => buildPromptAbComparison({ runRecords: [l1, l2, otherProfile, c2], now: NOW }),
      { message: /profileId が run ごとに異なる/ }
    );
  });

  test('context（phase / reviewMode）が混ざった集合は組にできない', async () => {
    const [l1, l2, c1, c2] = await dataset();
    assert.throws(
      () =>
        buildPromptAbComparison({
          runRecords: [l1, l2, { ...c1, phase: 'upstream' }, c2],
          now: NOW,
        }),
      { message: /phase が run ごとに異なる/ }
    );
    assert.throws(
      () =>
        buildPromptAbComparison({
          runRecords: [l1, l2, { ...c1, reviewMode: 'deep' }, c2],
          now: NOW,
        }),
      { message: /reviewMode が run ごとに異なる/ }
    );
  });

  test('共通 case が 1 件も無い集合は組にできない（同一 fixture の pin）', async () => {
    const [l1, , c1] = await dataset();
    // candidate 側だけ別 fixture（別 mergeBase）にすると交差が空になる。
    const otherCase = { ...c1, mergeBase: 'base-other' };
    assert.throws(() => buildPromptAbComparison({ runRecords: [l1, otherCase], now: NOW }), {
      message: /共通の case が 1 件も無い/,
    });
  });

  test('manifest は両側の case key と provenance を pin する', async () => {
    const result = buildPromptAbComparison({ runRecords: await dataset(), now: NOW });
    const manifest = result.replay.manifest;
    assert.deepEqual(manifest.baseline.caseKeys, manifest.candidate.caseKeys);
    assert.equal(manifest.metrics.denominator, 'paired-case');
    assert.equal(manifest.environment.phase, 'midstream');
    assert.equal(manifest.environment.reviewMode, 'medium');
    assert.deepEqual(manifest.environment.baselineModes, ['observe']);
    assert.deepEqual(manifest.environment.candidateModes, ['active']);
  });

  test('sentPrompt が未知の語彙の run は組にできない', async () => {
    const [l1, , c1] = await dataset();
    const weird = {
      ...c1,
      debug: {
        ...c1.debug,
        execution: {
          promptCompiler: { ...c1.debug.execution.promptCompiler, sentPrompt: 'something-else' },
        },
      },
    };
    assert.throws(() => buildPromptAbComparison({ runRecords: [l1, weird], now: NOW }), {
      message: /sentPrompt が legacy \/ compiled のいずれでもない/,
    });
  });
});

describe('#1880 受入基準表と非ゴール', () => {
  test('observe 経路の 7 行は本経路を指し、latency / cost だけは指さない', async () => {
    const byMetric = new Map(ACCEPTANCE_COVERAGE.map((row) => [row.metric, row]));
    // candidate 側の findings が無いことが理由の 7 行。A/B 経路が解消先である。
    for (const metric of [
      'should-detect recall',
      'should-not-detect precision',
      'parse 成功率',
      'Evidence / Fix の充足',
      'invalid ArtifactRefs',
      'duplicate findings',
      'critical 回帰',
    ]) {
      assert.equal(byMetric.get(metric).unblockedBy, PROMPT_AB_UNBLOCKED_BY);
    }
    // m1: latency / cost は 2 系統を揃えても測れない（run レコードが所要時間も
    // 課金も持たない）。A/B 経路を解消先と書くのは事実に反する。
    assert.equal(byMetric.get('latency / cost').unblockedBy, LATENCY_COST_UNBLOCKED_BY);
    assert.notEqual(byMetric.get('latency / cost').unblockedBy, PROMPT_AB_UNBLOCKED_BY);
    // 2 表で同じ値であること（片方だけ直すとドリフトする）。
    assert.equal(
      PROMPT_AB_ACCEPTANCE_COVERAGE.find((row) => row.metric === 'latency / cost').unblockedBy,
      byMetric.get('latency / cost').unblockedBy
    );
    // m5: 定数同士の比較だけでは値の書き換えを検出できないので、literal も pin する。
    assert.equal(PROMPT_AB_UNBLOCKED_BY, 'river evolve prompt-ab（#1880 の 2 系統経路）');
    assert.ok(PROMPT_AB_UNBLOCKED_BY.includes(PROMPT_AB_ROUTE));
    // 配線（#1861）は済んでいるので、解消条件としては残さない。
    const stale = ACCEPTANCE_COVERAGE.filter((row) => row.unblockedBy === '#1861 active 配線');
    assert.deepEqual(stale, []);
  });

  test('A/B 経路の表は observe 経路と同じ metric 語彙を、別の観測可否で持つ', async () => {
    assert.deepEqual(
      PROMPT_AB_ACCEPTANCE_COVERAGE.map((row) => row.metric),
      ACCEPTANCE_COVERAGE.map((row) => row.metric)
    );
    const byMetric = new Map(PROMPT_AB_ACCEPTANCE_COVERAGE.map((row) => [row.metric, row]));
    // 本経路で本当に測れるのは 2 行だけである（測れないものを測れたことにしない）。
    assert.deepEqual(
      PROMPT_AB_ACCEPTANCE_COVERAGE.filter((row) => row.observable).map((row) => row.metric),
      ['critical 回帰', 'token（送信前のプロンプト推定長）']
    );
    for (const row of PROMPT_AB_ACCEPTANCE_COVERAGE) {
      assert.equal(row.observable === (row.unblockedBy == null), true, `${row.metric} の行が矛盾`);
    }
    assert.equal(byMetric.get('critical 回帰').observable, true);

    const result = buildPromptAbComparison({ runRecords: await dataset(), now: NOW });
    assert.deepEqual(result.acceptanceCoverage, [...PROMPT_AB_ACCEPTANCE_COVERAGE]);
    assert.ok(result.unpinnedConditions.length > 0);
  });

  test('非ゴール（自動 canary / 昇格）が成果物側で固定されている', async () => {
    const result = buildPromptAbComparison({ runRecords: await dataset(), now: NOW });
    assert.equal(result.decision, null);
    assert.equal(result.applied, false);
    assert.equal(result.autoPromotion, false);
    assert.equal(result.requiresHumanJudgment, true);
    assert.deepEqual(result.writeEffects, []);
    assert.equal(result.readOnly, true);
    // 閾値 profile を宣言していない（観測できない基準の vacuous pass を作らない）。
    assert.deepEqual(result.spec.acceptance.profiles, []);
    assert.equal(result.replay.acceptance.decision, null);
    assert.equal(result.replay.acceptance.applied, false);
  });
});

describe('#1880 決定論と副作用', () => {
  test('run の順序を入れ替えても結果はバイト等価である', async () => {
    const records = await dataset();
    const a = buildPromptAbComparison({ runRecords: records, now: NOW });
    const b = buildPromptAbComparison({ runRecords: [...records].reverse(), now: NOW });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(
      JSON.stringify(buildPromptAbSpec({ runRecords: records })),
      JSON.stringify(buildPromptAbSpec({ runRecords: [...records].reverse() }))
    );
  });

  test('LLM / provider を呼ばない', async () => {
    const records = await dataset();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('prompt-ab must not call a provider');
    };
    try {
      buildPromptAbComparison({ runRecords: records, now: NOW });
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(calls, 0);
  });
});

describe('#1880 CLI 配線（river evolve prompt-ab）', () => {
  test('保存済みの 2 系統を読み、JSON に経路と両側が出る', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'river-prompt-ab-'));
    try {
      for (const [n, mode, runId, findings] of [
        [1, 'observe', 'run-legacy-1', baselineFindings(1)],
        [1, 'active', 'run-compiled-1', candidateFindings(1)],
      ]) {
        const record = await makeRecord({ n, mode, runId, findings, repoRoot: dir });
        await saveRunRecord(record);
      }
      const result = await runCliInProcess(['evolve', 'prompt-ab', dir, '--output', 'json'], {
        cwd: dir,
      });
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.route, PROMPT_AB_ROUTE);
      assert.equal(parsed.mode, 'prompt-compiler-ab');
      assert.equal(parsed.sameRecordOnBothSides, false);
      assert.deepEqual(parsed.sides.baseline.runIds, ['run-legacy-1']);
      assert.deepEqual(parsed.sides.candidate.runIds, ['run-compiled-1']);
      assert.deepEqual(parsed.writeEffects, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('LLM 応答が無い store は exit 0 だが observable:false で出る（#1880 B1）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'river-prompt-ab-skipped-'));
    try {
      for (const [n, mode, runId, findings] of [
        [1, 'observe', 'run-legacy-1', baselineFindings(1)],
        [1, 'active', 'run-compiled-1', candidateFindings(1)],
      ]) {
        const record = await makeRecord({
          n,
          mode,
          runId,
          findings,
          llm: 'skipped',
          repoRoot: dir,
        });
        await saveRunRecord(record);
      }
      const result = await runCliInProcess(['evolve', 'prompt-ab', dir, '--output', 'json'], {
        cwd: dir,
      });
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      // sentPrompt は compiled と宣言されているが、応答は 1 件も無い。
      assert.equal(parsed.sides.candidate.sentPrompt, 'compiled');
      assert.equal(parsed.llmResponseCoverage.candidate.llmUsedRunCount, 0);
      assert.deepEqual(parsed.llmResponseCoverage.candidate.skipReasons, [
        { reason: 'dry-run enabled', runCount: 1 },
      ]);
      assert.equal(parsed.findingComparison.observable, false);
      assert.equal(parsed.findingComparison.criticalRegressionCount, null);
      assert.equal(parsed.findingComparison.criticalRegressionZero, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('存在しないパスは dataset エラーではなくパスの診断を出して exit 1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'river-prompt-ab-missing-'));
    try {
      const result = await runCliInProcess(
        ['evolve', 'prompt-ab', join(dir, 'nope'), '--output', 'json'],
        { cwd: dir }
      );
      assert.equal(result.code, 1);
      assert.match(result.stderr, /does not exist, so this prompt-ab read an empty store/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('観測が 0 件のとき prompt-ab 向けの文言を出す（m2）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'river-prompt-ab-empty-'));
    try {
      // mode=off の run（観測を持たない）だけを置く。
      const record = await makeRecord({
        n: 1,
        mode: 'off',
        llm: 'skipped',
        runId: 'run-off',
        findings: [],
        repoRoot: dir,
      });
      await saveRunRecord(record);
      const result = await runCliInProcess(['evolve', 'prompt-ab', dir], { cwd: dir });
      assert.equal(result.code, 1);
      // observe だけを指示すると、そのとおりにしても再度 exit 1 になる。
      assert.match(result.stderr, /`observe` にした run と `active` にした run/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('replay / aggregate のオプションは受け付けない', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'river-prompt-ab-opts-'));
    try {
      const result = await runCliInProcess(['evolve', 'prompt-ab', dir, '--min', '2'], {
        cwd: dir,
      });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /--min is not valid for `river evolve prompt-ab`/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
