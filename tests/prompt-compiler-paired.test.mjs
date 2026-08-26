// legacy と compiled の paired 比較導線（ADR-006 / #1860）のテスト。
//
// 入力は手書きの stub ではなく、**本番経路が実際に作った run レコード**である。
// generateReview（observe）→ buildRunRecord を通したものを使う。観測の形を
// 手で書くと、review-engine 側が記録キーを変えてもテストだけが古い形のまま
// 通り続ける。
//
// SSoT の import を機械保証する観点（CLAUDE.md「Import the SSoT, never
// re-derive it」）:
//   - case key / run id / manifest 導出を自前で書いていないことを、
//     **既存 production 経路の出力**（buildPairedReplay / buildExperimentManifest）
//     との突合で確かめる。自分の実装同士を比べる自己整合テストにしない。
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { generateReview } from '../src/lib/review-engine.mjs';
import { buildRunRecord } from '../src/lib/result-store.mjs';
import {
  buildExperimentManifest,
  buildPairedReplay,
  deriveCaseKey,
} from '../src/lib/paired-replay.mjs';
import { deriveReviewRunId } from '../src/lib/shadow-aggregate.mjs';
import {
  ACCEPTANCE_COVERAGE,
  LEGACY_CONFIG_ID,
  PROMPT_AB_UNBLOCKED_BY,
  PromptComparisonError,
  buildPromptComparison,
  buildPromptComparisonSpec,
  compiledConfigId,
  extractPromptCompilerObservation,
  formatPromptComparisonMarkdown,
} from '../src/lib/prompt-compiler-paired.mjs';

const NOW = new Date('2026-08-15T00:00:00.000Z');

const plan = {
  selected: [{ metadata: { id: 'skill-1', name: 'Skill One', phase: 'midstream' } }],
  skipped: [],
};

/**
 * observe モードで 1 回レビューを走らせ、保存形式の run レコードを返す。
 * dryRun のため LLM は呼ばれない。
 */
async function makeObserveRecord({ n, mode = 'observe', extra = {}, recordExtra = {} } = {}) {
  const diffText = `diff --git a/src/app${n}.ts b/src/app${n}.ts
--- a/src/app${n}.ts
+++ b/src/app${n}.ts
@@ -10,0 +11,2 @@
+const value = ${n};
+console.log(value);
`;
  const review = await generateReview({
    diff: {
      diffText,
      files: [{ path: `src/app${n}.ts`, addedLines: [11, 12], hunks: [] }],
      changedFiles: [`src/app${n}.ts`],
    },
    plan,
    phase: 'midstream',
    includeFallback: false,
    dryRun: true,
    config: {
      review: { promptCompiler: { mode } },
      model: { provider: 'openai', modelName: 'test-model' },
      ...extra,
    },
  });
  return buildRunRecord(
    {
      // 実 FS には触れない。case key の材料になる文字列としてだけ使う。
      repoRoot: '/workspace/repo-under-review',
      mergeBase: `base-${n}`,
      findings: [
        { fingerprint: `fp-${n}`, severity: 'major', file: `src/app${n}.ts`, title: `t${n}` },
      ],
      changedFiles: [`src/app${n}.ts`],
      reviewDebug: review.debug,
      commitSha: String(n).repeat(40),
      ...recordExtra,
    },
    { phase: 'midstream', runId: `run-${n}` }
  );
}

let RECORDS;
async function records() {
  RECORDS ??= [await makeObserveRecord({ n: 1 }), await makeObserveRecord({ n: 2 })];
  return RECORDS;
}

describe('#1860 observe の観測から 2 系統を取り出す', () => {
  test('1 回の observe run が legacy と compiled の両側を持つ（設計の前提）', async () => {
    const [record] = await records();
    const observation = extractPromptCompilerObservation(record);
    assert.equal(observation.sentPrompt, 'legacy');
    // 両側の指紋と推定長が 1 run に揃っている。2 回 run する必要が無い根拠。
    assert.match(observation.legacyPromptHash, /^[0-9a-f]{16}$/);
    assert.match(observation.compiledPromptHash, /^[0-9a-f]{16}$/);
    assert.ok(observation.legacyPromptEstimate > 0);
    assert.ok(observation.compiledPromptEstimate > 0);
  });

  test('観測が無い run は null、壊れた観測は投げる', async () => {
    const off = await makeObserveRecord({ n: 9, mode: 'off' });
    assert.equal(off.debug.execution, undefined);
    assert.equal(extractPromptCompilerObservation(off), null);
    assert.equal(extractPromptCompilerObservation(undefined), null);

    const [record] = await records();
    const broken = {
      ...record,
      debug: {
        ...record.debug,
        execution: {
          promptCompiler: { ...record.debug.execution.promptCompiler, compiledPromptHash: null },
        },
      },
    };
    assert.throws(() => extractPromptCompilerObservation(broken), {
      name: 'PromptComparisonError',
      message: /compiledPromptHash/,
    });
  });

  test('2 系統は configId でのみ分かれ、run は同一である', async () => {
    const spec = buildPromptComparisonSpec({ runRecords: await records() });
    assert.equal(spec.baseline.configId, LEGACY_CONFIG_ID);
    assert.equal(
      spec.candidate.configId,
      compiledConfigId({ profileId: 'openai-review-v1', profileVersion: '1' })
    );
    // 同一 fixture・同一モデル・同一 context・同一 skills。
    assert.equal(spec.baseline.model, spec.candidate.model);
    assert.equal(spec.baseline.provider, spec.candidate.provider);
    assert.deepEqual(spec.baseline.runs, spec.candidate.runs);
    // findings 水準を観測できない状態で profile を宣言しない（vacuous pass 防止）。
    assert.deepEqual(spec.acceptance.profiles, []);
  });
});

describe('#1860 既存 SSoT への委譲（再実装が入り込んでいないこと）', () => {
  test('case key は buildPairedReplay が出す production の case key と一致する', async () => {
    // 素の record ではなく、明示 caseId（空白・NFD を含む）を持つ record で見る。
    // 自前の正規化を書くとここで production 経路とズレる。
    const base = await records();
    const tricky = base.map((record, i) => ({
      ...record,
      caseId: `  case̊-${i}  `,
    }));
    const result = buildPromptComparison({ runRecords: tricky, now: NOW });

    const production = buildPairedReplay(result.spec, { now: NOW });
    const productionKeys = production.pairing.cases.map((c) => c.caseKey).sort();
    const mineKeys = [...new Set(result.promptMetrics.runs.map((r) => r.caseKey))].sort();
    assert.deepEqual(mineKeys, productionKeys);
    // 対照: deriveCaseKey（SSoT）そのものの戻り値とも一致する。
    assert.deepEqual(mineKeys, [...new Set(tricky.map(deriveCaseKey))].sort());
  });

  test('run id は manifest（production）が導出した reviewRunIds と一致する', async () => {
    const result = buildPromptComparison({ runRecords: await records(), now: NOW });
    const mine = result.promptMetrics.runs.map((r) => r.runId).sort();
    assert.deepEqual(mine, [...result.replay.manifest.baseline.reviewRunIds].sort());
    assert.deepEqual(mine, [...(await records())].map(deriveReviewRunId).sort());
  });

  test('manifest は buildExperimentManifest の出力そのものである', async () => {
    const result = buildPromptComparison({ runRecords: await records(), now: NOW });
    const production = buildExperimentManifest(result.spec, { now: NOW });
    // バイト等価。manifestId / experimentKey / manifestHash を手で組んでいない。
    assert.equal(JSON.stringify(result.replay.manifest), JSON.stringify(production.manifest));
    assert.ok(result.replay.manifest.manifestId.startsWith('RR-EXP-'));
    assert.equal(result.replay.manifestVerification.verified, true);
  });

  test('推定長は observe が記録した値をそのまま使う（数え直さない）', async () => {
    const recs = await records();
    const result = buildPromptComparison({ runRecords: recs, now: NOW });
    for (const record of recs) {
      const observation = record.debug.execution.promptCompiler;
      const row = result.promptMetrics.runs.find((r) => r.runId === deriveReviewRunId(record));
      assert.equal(row.legacyPromptEstimate, observation.legacyPromptEstimate);
      assert.equal(row.compiledPromptEstimate, observation.compiledPromptEstimate);
      assert.equal(
        row.estimateDelta,
        observation.compiledPromptEstimate - observation.legacyPromptEstimate
      );
    }
    const legacyTotal = recs.reduce(
      (acc, r) => acc + r.debug.execution.promptCompiler.legacyPromptEstimate,
      0
    );
    assert.equal(result.promptMetrics.legacyPromptEstimateTotal, legacyTotal);
  });
});

describe('#1860 測れないものを測れたことにしない', () => {
  test('findings 水準は観測不可として報告され、activation も verified にならない', async () => {
    const result = buildPromptComparison({ runRecords: await records(), now: NOW });
    assert.equal(result.findingComparison.observable, false);
    assert.equal(result.findingComparison.activationVerified, false);
    // 既存モジュール側の判定と一致していること（自前判定にしていない）。
    assert.equal(result.replay.activationCheck.verified, false);
    assert.ok(
      result.replay.activationCheck.reasons.some((r) => r.includes('paired diff に差分がなく'))
    );
  });

  test('ADR-006 の受入基準は、LLM 応答を要する行がすべて観測不可である', async () => {
    const byMetric = new Map(ACCEPTANCE_COVERAGE.map((row) => [row.metric, row]));
    for (const metric of [
      'should-detect recall',
      'should-not-detect precision',
      'parse 成功率',
      'Evidence / Fix の充足',
      'invalid ArtifactRefs',
      'duplicate findings',
      'critical 回帰',
      'latency / cost',
    ]) {
      const row = byMetric.get(metric);
      assert.ok(row, `${metric} の行が無い`);
      assert.equal(row.observable, false, `${metric} が観測可能として報告されている`);
      // #1880: active は #1861 で配線済みなので、解消条件は 2 系統の比較経路
      // （`river evolve prompt-ab`）そのものである。
      assert.equal(row.unblockedBy, PROMPT_AB_UNBLOCKED_BY);
      assert.ok(row.unblockedBy.includes('river evolve prompt-ab'));
    }
    // 観測できる唯一の行。
    assert.equal(byMetric.get('token（送信前のプロンプト推定長）').observable, true);

    const result = buildPromptComparison({ runRecords: await records(), now: NOW });
    assert.deepEqual(result.acceptanceCoverage, [...ACCEPTANCE_COVERAGE]);
  });

  test('非ゴール（自動 canary / 昇格）が成果物側で固定されている', async () => {
    const result = buildPromptComparison({ runRecords: await records(), now: NOW });
    assert.equal(result.decision, null);
    assert.equal(result.applied, false);
    assert.equal(result.autoPromotion, false);
    assert.equal(result.requiresHumanJudgment, true);
    assert.deepEqual(result.writeEffects, []);
    assert.equal(result.readOnly, true);
    // 委譲先も同じ姿勢であること。
    assert.equal(result.replay.acceptance.decision, null);
    assert.equal(result.replay.acceptance.applied, false);
  });

  test('Markdown は観測不可を paired replay の表より先に出す', async () => {
    const result = buildPromptComparison({ runRecords: await records(), now: NOW });
    const text = formatPromptComparisonMarkdown(result);
    const coverageAt = text.indexOf('### 観測できない受入基準');
    const replayAt = text.indexOf('## Paired replay');
    assert.ok(coverageAt > -1 && replayAt > -1);
    assert.ok(coverageAt < replayAt, '受入基準の観測可否が paired replay の表より後ろにある');
    assert.ok(text.includes('prompt token が減ったから採用'));
  });
});

describe('#1860 前提が崩れた入力は受理しない', () => {
  test('観測を持つ run が 0 件なら投げる', async () => {
    const off = await makeObserveRecord({ n: 8, mode: 'off' });
    assert.throws(() => buildPromptComparison({ runRecords: [off], now: NOW }), {
      name: 'PromptComparisonError',
      message: /観測を持つ run が 1 件も無い/,
    });
    assert.throws(() => buildPromptComparison({ runRecords: [], now: NOW }), PromptComparisonError);
  });

  test('sentPrompt が legacy でない run は #1861 の経路へ回す', async () => {
    const [record] = await records();
    const sent = {
      ...record,
      debug: {
        ...record.debug,
        execution: {
          promptCompiler: { ...record.debug.execution.promptCompiler, sentPrompt: 'compiled' },
        },
      },
    };
    assert.throws(() => buildPromptComparison({ runRecords: [sent], now: NOW }), {
      name: 'PromptComparisonError',
      message: /#1861/,
    });
  });

  test('profile / model が混ざった集合は投げる', async () => {
    const [a, b] = await records();
    const otherProfile = {
      ...b,
      debug: {
        ...b.debug,
        execution: {
          promptCompiler: { ...b.debug.execution.promptCompiler, profileId: 'generic-review-v1' },
        },
      },
    };
    assert.throws(() => buildPromptComparison({ runRecords: [a, otherProfile], now: NOW }), {
      message: /profileId が run ごとに異なる/,
    });

    const otherModel = { ...b, debug: { ...b.debug, llmModel: 'another-model' } };
    assert.throws(() => buildPromptComparison({ runRecords: [a, otherModel], now: NOW }), {
      message: /model が run ごとに異なる/,
    });
  });
});

describe('#1860 決定論と副作用', () => {
  test('run の順序を入れ替えても結果はバイト等価である', async () => {
    const recs = await records();
    const a = buildPromptComparison({ runRecords: recs, now: NOW });
    const b = buildPromptComparison({ runRecords: [...recs].reverse(), now: NOW });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  test('LLM / provider を呼ばない', async () => {
    const recs = await records();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('prompt-compare must not call a provider');
    };
    try {
      buildPromptComparison({ runRecords: recs, now: NOW });
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(calls, 0);
  });
});
