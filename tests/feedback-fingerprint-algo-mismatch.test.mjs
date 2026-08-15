// #1823 残件2: a v2 (line-anchored) fingerprint pasted into
// `river feedback add --fingerprint` used to degrade in complete silence.
//
// What was measured on the pre-change code (the behaviour these tests exist to
// stop coming back), with one saved run and two feedback rows:
//
//   v1 hex  -> subClusterKey `<v1>::rule-y::src/b.mjs`, candidate RR-PC-ef9e8caa1d64
//   v2 hex  -> subClusterKey `<v2>::no-category::no-file-path`, candidate RR-PC-ba4d1c1c7eb8
//
// i.e. the row is NOT dropped and is NOT `shadowOnly` — it clusters under its
// own key, loses both stage-2 axes, and still mints a candidate, just a
// different one. Nothing on any output surface said so.
//
// Every expected value below is derived from the PRODUCTION path
// (annotateFingerprints / buildRunRecord / saveRunRecord / buildShadowAggregate)
// rather than recomputed locally — see the header of
// tests/prompt-sections.test.mjs for why self-consistent expectations do not
// count as verification here.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  annotateFingerprints,
  classifyFingerprintAlgo,
  formatUnmatchedFeedbackFingerprintWarning,
} from '../src/lib/finding-factory.mjs';
import {
  buildShadowAggregate,
  formatShadowAggregateMarkdown,
} from '../src/lib/shadow-aggregate.mjs';
import { buildRunRecord, resolveStoreDir, saveRunRecord } from '../src/lib/result-store.mjs';
import { compileSchemaFile } from './helpers/schema-validator.mjs';
import { runCliInProcess } from './helpers/cli.mjs';
import { createTempGitRepo } from './helpers/temp-repo.mjs';

const validateAggregate = compileSchemaFile('shadow-aggregate.schema.json', {
  ajvOptions: { allErrors: true },
});

const NOW = new Date('2026-08-15T00:00:00.000Z');
const RUN_ID = '2026-08-01T00-00-00-000Z-aaaaaa';
const UNKNOWN_FP = '0123456789abcdef';

/** One finding, annotated by the production annotator (both algos at once). */
const [FINDING] = annotateFingerprints([
  {
    ruleId: 'rule-y',
    file: 'src/b.mjs',
    lineStart: 42,
    message: 'unchecked input',
    severity: 'major',
  },
]);

const RUN_RECORD = {
  runId: RUN_ID,
  timestamp: '2026-08-01T00:00:00.000Z',
  findings: [FINDING],
};

function feedbackRow(fingerprint, pr) {
  return {
    timestamp: '2026-08-02T00:00:00.000Z',
    skillId: 'rule-y',
    feedbackType: 'false_positive',
    findingFingerprint: fingerprint,
    pr,
    review_run_id: RUN_ID,
  };
}

/** Aggregate over one run and two feedback rows naming `fingerprint`. */
function aggregateFor(fingerprint, { warn } = {}) {
  return buildShadowAggregate({
    runRecords: [RUN_RECORD],
    feedbackEntries: [feedbackRow(fingerprint, 1), feedbackRow(fingerprint, 2)],
    now: NOW,
    ...(warn ? { warn } : {}),
  });
}

describe('#1823 残件2: classifyFingerprintAlgo', () => {
  test('保存済み finding の v1 値を v1 と判定する', () => {
    assert.equal(classifyFingerprintAlgo(FINDING.fingerprint, [FINDING]), 'v1');
  });

  test('保存済み finding の v2 値を v2 と判定する', () => {
    assert.equal(classifyFingerprintAlgo(FINDING.fingerprintV2, [FINDING]), 'v2');
  });

  test('v1 と v2 は同じ 16-hex 空間の別値であり、判定は取り違えない', () => {
    // The premise the whole residual rests on: the two are indistinguishable
    // by shape, so only a lookup can tell them apart.
    assert.notEqual(FINDING.fingerprint, FINDING.fingerprintV2);
    assert.match(FINDING.fingerprint, /^[0-9a-f]{16}$/);
    assert.match(FINDING.fingerprintV2, /^[0-9a-f]{16}$/);
  });

  test('どの finding にも無い値は null（fail-safe: v1 に丸めない）', () => {
    assert.equal(classifyFingerprintAlgo(UNKNOWN_FP, [FINDING]), null);
    assert.equal(classifyFingerprintAlgo(FINDING.fingerprint, []), null);
    assert.equal(classifyFingerprintAlgo('', [FINDING]), null);
    assert.equal(classifyFingerprintAlgo(null, [FINDING]), null);
  });

  test('#1797 より前の run record（fingerprintV2 なし）でも v1 判定は効く', () => {
    const legacy = { fingerprint: FINDING.fingerprint };
    assert.equal(classifyFingerprintAlgo(FINDING.fingerprint, [legacy]), 'v1');
    assert.equal(classifyFingerprintAlgo(FINDING.fingerprintV2, [legacy]), null);
  });
});

describe('#1823 残件2: formatUnmatchedFeedbackFingerprintWarning', () => {
  // Literal pin, not a comparison against the formatter itself: every other
  // assertion in this file compares emitted text to this formatter's output, so
  // without a literal here a formatter regression would stay self-consistent.
  test('v2 と判定した場合の文面（リテラル pin）', () => {
    assert.equal(
      formatUnmatchedFeedbackFingerprintWarning({
        fingerprint: 'd546d613c0cc9e23',
        likelyAlgo: 'v2',
      }),
      'Warning: findingFingerprint d546d613c0cc9e23 matches no finding in the saved runs under .river/runs/; ' +
        'it is the v2 (line-anchored) fingerprint of a saved finding. ' +
        'Feedback is joined on the v1 fingerprint, so this entry stays unjoined and clusters under its own key. ' +
        'Re-record it with the v1 value from `river review --debug`.'
    );
  });

  test('判定できない場合の文面（リテラル pin: v2 と断定しない）', () => {
    assert.equal(
      formatUnmatchedFeedbackFingerprintWarning({ fingerprint: UNKNOWN_FP, likelyAlgo: null }),
      'Warning: findingFingerprint 0123456789abcdef matches no finding in the saved runs under .river/runs/. ' +
        'Check the value copied from `river review --debug`.'
    );
  });
});

describe('#1823 残件2: buildShadowAggregate が未一致 fingerprint を報告する', () => {
  test('v2 hex を貼ると unmatched / v2 の両方に載り、warn sink に v2 用の文面が届く', () => {
    const warnings = [];
    const aggregate = aggregateFor(FINDING.fingerprintV2, { warn: (m) => warnings.push(m) });

    assert.deepEqual(aggregate.join.unmatchedFindingFingerprints, [FINDING.fingerprintV2]);
    assert.deepEqual(aggregate.join.v2FindingFingerprints, [FINDING.fingerprintV2]);
    assert.deepEqual(warnings, [
      formatUnmatchedFeedbackFingerprintWarning({
        fingerprint: FINDING.fingerprintV2,
        likelyAlgo: 'v2',
      }),
    ]);
    // The formatter must actually name the diagnosis, not just the hex.
    assert.match(warnings[0], /v2 \(line-anchored\)/);
    assert.match(warnings[0], /v1/);
  });

  test('警告が指す劣化は実在する: v2 経路は軸を失い、別 candidateId になる', () => {
    // This is what makes the warning worth emitting. Both figures come from the
    // builder itself, so the assertion pins the divergence, not a literal.
    const withV1 = aggregateFor(FINDING.fingerprint);
    const withV2 = aggregateFor(FINDING.fingerprintV2);

    const subV1 = withV1.clusters[0].subClusters[0];
    const subV2 = withV2.clusters[0].subClusters[0];

    assert.equal(subV1.category, 'rule-y');
    assert.equal(subV1.filePath, 'src/b.mjs');
    assert.equal(subV2.category, null);
    assert.equal(subV2.filePath, null);
    assert.match(subV2.subClusterKey, /::no-category::no-file-path$/);

    // Not dropped and not shadow-only: it still produces a candidate.
    assert.ok(withV2.candidate, 'v2 経路でも candidate は生成される（無言で落ちてはいない）');
    assert.notEqual(withV2.candidate.candidateId, withV1.candidate.candidateId);
  });

  test('正しい v1 hex では unmatched は空で、warn sink は一度も呼ばれない', () => {
    const warnings = [];
    const aggregate = aggregateFor(FINDING.fingerprint, { warn: (m) => warnings.push(m) });

    assert.deepEqual(aggregate.join.unmatchedFindingFingerprints, []);
    assert.deepEqual(aggregate.join.v2FindingFingerprints, []);
    assert.deepEqual(warnings, []);
  });

  test('v2 でもない未知の値は unmatched のみに載り、汎用の文面になる', () => {
    const warnings = [];
    const aggregate = aggregateFor(UNKNOWN_FP, { warn: (m) => warnings.push(m) });

    assert.deepEqual(aggregate.join.unmatchedFindingFingerprints, [UNKNOWN_FP]);
    assert.deepEqual(aggregate.join.v2FindingFingerprints, []);
    assert.deepEqual(warnings, [
      formatUnmatchedFeedbackFingerprintWarning({ fingerprint: UNKNOWN_FP, likelyAlgo: null }),
    ]);
    assert.doesNotMatch(warnings[0], /line-anchored/);
  });

  test('review_run_id の join (契約2) とは別軸である', () => {
    // Both rows join on review_run_id yet still name an unmatched fingerprint —
    // so unjoinedFeedbackCount cannot be used to notice this.
    const aggregate = aggregateFor(FINDING.fingerprintV2);
    assert.equal(aggregate.join.unjoinedFeedbackCount, 0);
    assert.equal(aggregate.join.unmatchedFindingFingerprints.length, 1);
  });

  test('warn 既定値は no-op（モジュールの副作用ゼロ契約を壊さない）', () => {
    const original = console.warn;
    const seen = [];
    console.warn = (...args) => seen.push(args);
    try {
      const aggregate = aggregateFor(FINDING.fingerprintV2);
      // The artifact still carries the information even with no sink wired.
      assert.deepEqual(aggregate.join.unmatchedFindingFingerprints, [FINDING.fingerprintV2]);
    } finally {
      console.warn = original;
    }
    assert.deepEqual(seen, []);
  });

  test('決定性: 同じ入力なら join も byte-identical', () => {
    const a = aggregateFor(FINDING.fingerprintV2);
    const b = aggregateFor(FINDING.fingerprintV2);
    assert.equal(JSON.stringify(a.join), JSON.stringify(b.join));
  });

  test('新フィールド込みでも schemas/shadow-aggregate.schema.json に適合する', () => {
    const aggregate = aggregateFor(FINDING.fingerprintV2);
    assert.ok(validateAggregate(aggregate), JSON.stringify(validateAggregate.errors, null, 2));
  });

  test('Markdown 出力にも未一致 fingerprint が出る（--output text で無言にならない）', () => {
    const markdown = formatShadowAggregateMarkdown(aggregateFor(FINDING.fingerprintV2));
    assert.match(markdown, /Unmatched findingFingerprint \| 1/);
    assert.ok(markdown.includes(FINDING.fingerprintV2), markdown);
    assert.match(markdown, /v2/);

    const clean = formatShadowAggregateMarkdown(aggregateFor(FINDING.fingerprint));
    assert.match(clean, /Unmatched findingFingerprint \| 0/);
    assert.ok(!clean.includes('どの run の finding にも一致しない'), clean);
  });
});

describe('#1823 残件2: `river feedback add` が貼った瞬間に警告する', () => {
  /** Temp git repo with ONE saved run whose finding carries both fingerprints. */
  async function repoWithSavedRun(t) {
    const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-fp-algo-' });
    t.after(cleanup);
    // Built and saved through the production writers so the record on disk has
    // the exact shape `river run --save` produces.
    const record = buildRunRecord(
      { findings: [FINDING], repoRoot: dir, changedFiles: ['src/b.mjs'] },
      { runId: RUN_ID }
    );
    await saveRunRecord(record, { storeDir: resolveStoreDir(dir) });
    return dir;
  }

  const addArgs = (fingerprint) => [
    'feedback',
    'add',
    '--type',
    'false_positive',
    '--skill',
    'rule-y',
    '--fingerprint',
    fingerprint,
    '--pr',
    '1823',
  ];

  test('v2 hex を渡すと stderr に v2 の警告が出る（exit 0 のまま、行は書かれる）', async (t) => {
    const dir = await repoWithSavedRun(t);
    const res = await runCliInProcess(addArgs(FINDING.fingerprintV2), { cwd: dir });

    assert.equal(res.code, 0, res.stderr);
    assert.ok(
      res.stderr.includes(
        formatUnmatchedFeedbackFingerprintWarning({
          fingerprint: FINDING.fingerprintV2,
          likelyAlgo: 'v2',
        })
      ),
      `v2 の警告が stderr に無い: ${JSON.stringify(res.stderr)}`
    );
    // Advisory only: the row the user asked for is still recorded.
    assert.match(res.stdout, /Feedback recorded: false_positive for rule-y/);
  });

  test('正しい v1 hex では警告が出ない', async (t) => {
    const dir = await repoWithSavedRun(t);
    const res = await runCliInProcess(addArgs(FINDING.fingerprint), { cwd: dir });

    assert.equal(res.code, 0, res.stderr);
    assert.ok(!res.stderr.includes('matches no finding'), res.stderr);
  });

  test('保存済み run が 0 件のリポジトリでは警告しない（初回実行で鳴らない）', async (t) => {
    const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-fp-algo-empty-' });
    t.after(cleanup);
    const res = await runCliInProcess(addArgs(FINDING.fingerprintV2), { cwd: dir });

    assert.equal(res.code, 0, res.stderr);
    assert.ok(!res.stderr.includes('matches no finding'), res.stderr);
  });

  test('未知の値には汎用の警告が出る（v2 と断定しない）', async (t) => {
    const dir = await repoWithSavedRun(t);
    const res = await runCliInProcess(addArgs(UNKNOWN_FP), { cwd: dir });

    assert.equal(res.code, 0, res.stderr);
    assert.ok(
      res.stderr.includes(
        formatUnmatchedFeedbackFingerprintWarning({ fingerprint: UNKNOWN_FP, likelyAlgo: null })
      ),
      `汎用の警告が stderr に無い: ${JSON.stringify(res.stderr)}`
    );
    assert.ok(!res.stderr.includes('line-anchored'), res.stderr);
  });
});
