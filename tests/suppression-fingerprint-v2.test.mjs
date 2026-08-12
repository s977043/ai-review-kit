// tests/suppression-fingerprint-v2.test.mjs
//
// #1797 項目3: 抑制キーに行番号が無いため、同一ファイル内の同 kind の finding が
// まとめて抑制される問題に対する fingerprintAlgo v2（行番号込み）併存の pin。
//
// この canary が守る不変条件は 2 つある。
//
//   1. **v1 は一切変わらない**。v1 の値は `review-differ.mjs` / `runs-digest.mjs`
//      の run 横断追跡と、利用者の `.river/memory/index.json` に既に保存済みの
//      抑制エントリのキーでもある。したがって v1 の検証は「自己整合」では
//      不十分で、(a) ハッシュ値そのもののリテラル pin と (b) 本番経路である
//      `annotateFingerprints` の実出力との突合の両方で確認する。
//      リテラル値は本変更を入れる前の worktree で実測したもの
//      （`node -e "computeFingerprint({ruleId:'temporary-without-exit',
//      file:'src/app.ts',message:'Temporary code without exit condition'})"`
//      → `4c67325d1dbb9039`）。
//   2. v2 は行番号でのみ v1 と異なる。正規化（lowercase / 空白畳み込み /
//      先頭 60 字）は v1 と同じ実装を共有しており、別実装に分岐していないこと。
//
// 既知の欠点（設計上の受容）: v2 の抑制は行がズレると外れる。行番号に紐づける
// 以上避けられないトレードオフであり、既定は v1 のまま（オプトイン）である。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import {
  computeFingerprint,
  computeFingerprintV2,
  annotateFingerprints,
} from '../src/lib/finding-factory.mjs';
import { applySuppressions } from '../src/lib/suppression-apply.mjs';
import { formatUnknownFingerprintAlgoWarning } from '../src/lib/suppression.mjs';
import { parseArgs } from '../src/cli.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 本変更の前に実測した v1 の値（変更してはならない）。 */
const V1_PIN = {
  finding: {
    ruleId: 'temporary-without-exit',
    file: 'src/app.ts',
    message: 'Temporary code without exit condition',
  },
  fingerprint: '4c67325d1dbb9039',
};

function makeSuppression({ id, fingerprint, fingerprintAlgo }) {
  return {
    id,
    type: 'suppression',
    content: 'accepted',
    metadata: {
      createdAt: '2026-08-12T00:00:00Z',
      author: 't',
      tags: ['suppression', 'active', 'file'],
      relatedFiles: ['src/app.ts'],
    },
    context: {
      scope: 'file',
      active: true,
      fingerprint,
      ...(fingerprintAlgo ? { fingerprintAlgo } : {}),
      feedbackType: 'false_positive',
    },
  };
}

// ---------------------------------------------------------------------------
// 不変条件 1: v1 は変わらない
// ---------------------------------------------------------------------------

test('v1: computeFingerprint の値が本変更の前後で不変（リテラル pin）', () => {
  assert.equal(computeFingerprint(V1_PIN.finding), V1_PIN.fingerprint);
});

test('v1: 本番経路 annotateFingerprints の実出力が同じ v1 値を返す（経路突合）', () => {
  const [annotated] = annotateFingerprints([V1_PIN.finding]);
  assert.equal(annotated.fingerprint, V1_PIN.fingerprint);
});

test('v1: line を持つ finding でも v1 値は line 無しと同一（line 非依存の維持）', () => {
  const withLine = { ...V1_PIN.finding, lineStart: 120 };
  assert.equal(computeFingerprint(withLine), V1_PIN.fingerprint);
  const [annotated] = annotateFingerprints([withLine]);
  assert.equal(annotated.fingerprint, V1_PIN.fingerprint);
});

// ---------------------------------------------------------------------------
// 不変条件 2: v2 は行番号でのみ v1 と異なる
// ---------------------------------------------------------------------------

test('v2: 同一 finding でも行が違えば別の値になる', () => {
  const a = { ...V1_PIN.finding, lineStart: 10 };
  const b = { ...V1_PIN.finding, lineStart: 20 };
  assert.notEqual(computeFingerprintV2(a), computeFingerprintV2(b));
  // v1 側は従来どおり両者が同じ値（= 項目3 の症状そのもの）。
  assert.equal(computeFingerprint(a), computeFingerprint(b));
});

test('v2: annotateFingerprints が v1 と v2 の両方を注釈する（本番経路突合）', () => {
  const finding = { ...V1_PIN.finding, lineStart: 10 };
  const [annotated] = annotateFingerprints([finding]);
  assert.equal(annotated.fingerprint, computeFingerprint(finding));
  assert.equal(annotated.fingerprintV2, computeFingerprintV2(finding));
  assert.equal(annotated.fingerprintV2.length, 16);
});

test('v2: line / lineStart のどちらでも同じ値になる（パイプラインの二重呼称）', () => {
  assert.equal(
    computeFingerprintV2({ ...V1_PIN.finding, lineStart: 42 }),
    computeFingerprintV2({ ...V1_PIN.finding, line: 42 })
  );
});

test('v2: 行アンカーが無い finding も安定した値を返し v1 とは異なる', () => {
  const noLine = { ...V1_PIN.finding };
  assert.equal(computeFingerprintV2(noLine), computeFingerprintV2(noLine));
  assert.notEqual(computeFingerprintV2(noLine), computeFingerprint(noLine));
});

test('v2: message の正規化・60 字切り詰めは v1 と同じ実装を共有する', () => {
  const long = 'x'.repeat(80);
  const base = { ruleId: 'r', file: 'f.ts' };
  // 61 字目以降だけが違う 2 件は v1 でも v2 でも同値（同じ切り詰め規則）。
  const a = { ...base, message: long + 'AAA', lineStart: 3 };
  const b = { ...base, message: long + 'BBB', lineStart: 3 };
  assert.equal(computeFingerprint(a), computeFingerprint(b));
  assert.equal(computeFingerprintV2(a), computeFingerprintV2(b));
  // 大文字小文字・空白の畳み込みも同様。
  assert.equal(
    computeFingerprintV2({ ...base, message: 'Leak  Detected', lineStart: 3 }),
    computeFingerprintV2({ ...base, message: 'leak detected', lineStart: 3 })
  );
});

// ---------------------------------------------------------------------------
// applySuppressions の algo 別照合
// ---------------------------------------------------------------------------

const twoOccurrences = () =>
  annotateFingerprints([
    { ...V1_PIN.finding, lineStart: 10, severity: 'minor' },
    { ...V1_PIN.finding, lineStart: 200, severity: 'minor' },
  ]);

test('v1 の抑制は従来どおり同ファイル内の同 kind をまとめて抑制する（既存挙動の不変）', () => {
  const findings = twoOccurrences();
  const suppression = makeSuppression({
    id: 'suppression-v1',
    fingerprint: findings[0].fingerprint,
  });
  const { keptFindings, suppressedFindings, applied } = applySuppressions(findings, {
    suppressions: [suppression],
  });
  assert.equal(suppressedFindings.length, 2);
  assert.equal(keptFindings.length, 0);
  assert.deepEqual(
    applied.map((a) => a.fingerprintAlgo),
    ['v1', 'v1']
  );
});

test('fingerprintAlgo 未指定のエントリは v1 として扱われる（既存エントリの後方互換）', () => {
  const findings = twoOccurrences();
  // makeSuppression は fingerprintAlgo を省略すると context に書かない。
  const suppression = makeSuppression({
    id: 'suppression-legacy',
    fingerprint: findings[0].fingerprint,
  });
  assert.equal(suppression.context.fingerprintAlgo, undefined);
  const { suppressedFindings } = applySuppressions(findings, { suppressions: [suppression] });
  assert.equal(suppressedFindings.length, 2);
});

test('v2 の抑制は同ファイル内の該当行の finding だけを抑制する（#1797 項目3 の修正）', () => {
  const findings = twoOccurrences();
  const suppression = makeSuppression({
    id: 'suppression-v2',
    fingerprint: findings[0].fingerprintV2,
    fingerprintAlgo: 'v2',
  });
  const { keptFindings, suppressedFindings, applied } = applySuppressions(findings, {
    suppressions: [suppression],
  });
  assert.equal(suppressedFindings.length, 1);
  assert.equal(suppressedFindings[0].lineStart, 10);
  assert.equal(suppressedFindings[0].suppressionAlgo, 'v2');
  assert.equal(keptFindings.length, 1);
  assert.equal(keptFindings[0].lineStart, 200);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].fingerprintAlgo, 'v2');
  assert.equal(applied[0].fingerprint, findings[0].fingerprintV2);
});

test('v2 の抑制は行がズレると外れる（既知の欠点をそのまま pin する）', () => {
  const findings = twoOccurrences();
  const suppression = makeSuppression({
    id: 'suppression-v2',
    fingerprint: findings[0].fingerprintV2,
    fingerprintAlgo: 'v2',
  });
  // 同じ finding が 1 行下へ移動した次の run。
  const shifted = annotateFingerprints([{ ...V1_PIN.finding, lineStart: 11, severity: 'minor' }]);
  const { keptFindings, suppressedFindings } = applySuppressions(shifted, {
    suppressions: [suppression],
  });
  assert.equal(suppressedFindings.length, 0);
  assert.equal(keptFindings.length, 1);
});

test('未知の fingerprintAlgo は無視される（fail-safe: v1 として誤適用しない）', () => {
  const findings = twoOccurrences();
  const suppression = makeSuppression({
    id: 'suppression-v9',
    fingerprint: findings[0].fingerprint,
    fingerprintAlgo: 'v9',
  });
  const warnings = [];
  const { keptFindings, suppressedFindings, applied } = applySuppressions(
    findings,
    { suppressions: [suppression] },
    { warn: (m) => warnings.push(m) }
  );
  assert.equal(suppressedFindings.length, 0);
  assert.equal(keptFindings.length, 2);
  assert.equal(applied.length, 0);
  // main では抑制されていたエントリが無言で失効するのを防ぐ（#1780/#1801 と同型）。
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /suppression-v9/);
  assert.match(warnings[0], /fingerprintAlgo/);
  assert.equal(
    warnings[0],
    formatUnknownFingerprintAlgoWarning({ id: 'suppression-v9', fingerprintAlgo: 'v9' })
  );
});

test('空文字の fingerprintAlgo も未知として警告される（既定へ落とさない）', () => {
  const findings = twoOccurrences();
  const suppression = makeSuppression({
    id: 'suppression-empty',
    fingerprint: findings[0].fingerprint,
    fingerprintAlgo: '',
  });
  // makeSuppression は falsy を書き込まないので、ここだけ直接立てる。
  suppression.context.fingerprintAlgo = '';
  const warnings = [];
  const { suppressedFindings } = applySuppressions(
    findings,
    { suppressions: [suppression] },
    { warn: (m) => warnings.push(m) }
  );
  assert.equal(suppressedFindings.length, 0);
  assert.equal(warnings.length, 1);
});

test('既知の algo（v1 / v2 / 未指定）では警告を出さない', () => {
  const findings = twoOccurrences();
  for (const entry of [
    makeSuppression({ id: 's1', fingerprint: findings[0].fingerprint }),
    makeSuppression({ id: 's2', fingerprint: findings[0].fingerprint, fingerprintAlgo: 'v1' }),
    makeSuppression({
      id: 's3',
      fingerprint: findings[0].fingerprintV2,
      fingerprintAlgo: 'v2',
    }),
  ]) {
    const warnings = [];
    applySuppressions(findings, { suppressions: [entry] }, { warn: (m) => warnings.push(m) });
    assert.deepEqual(warnings, [], `${entry.id} で不要な警告が出ている`);
  }
});

test('v1 と v2 のエントリは併存でき、それぞれの粒度で適用される', () => {
  const findings = annotateFingerprints([
    { ...V1_PIN.finding, lineStart: 10, severity: 'minor' },
    { ...V1_PIN.finding, lineStart: 200, severity: 'minor' },
    { ruleId: 'other-rule', file: 'src/app.ts', message: 'other', lineStart: 5, severity: 'minor' },
  ]);
  const v2Entry = makeSuppression({
    id: 'suppression-v2',
    fingerprint: findings[0].fingerprintV2,
    fingerprintAlgo: 'v2',
  });
  const v1Entry = makeSuppression({
    id: 'suppression-v1',
    fingerprint: findings[2].fingerprint,
    fingerprintAlgo: 'v1',
  });
  const { keptFindings, suppressedFindings } = applySuppressions(findings, {
    suppressions: [v2Entry, v1Entry],
  });
  assert.deepEqual(suppressedFindings.map((f) => f.suppressionRef).sort(), [
    'suppression-v1',
    'suppression-v2',
  ]);
  assert.equal(keptFindings.length, 1);
  assert.equal(keptFindings[0].lineStart, 200);
});

// ---------------------------------------------------------------------------
// 語彙の SSoT 突合 + CLI（オプトイン）
// ---------------------------------------------------------------------------

test('CLI の --fingerprint-algo 語彙は schema の enum と一致する', () => {
  const schema = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'schemas', 'suppression-context.schema.json'), 'utf8')
  );
  const enumValues = schema.$defs.fingerprintAlgo.enum;
  assert.deepEqual(enumValues, ['v1', 'v2']);
  // CLI 側は module-private なので、受理／拒否の実挙動で突合する。
  for (const value of enumValues) {
    const parsed = parseArgs([
      'suppression',
      'add',
      '--fingerprint',
      'a'.repeat(16),
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--fingerprint-algo',
      value,
    ]);
    assert.notEqual(parsed.usageError, true, `${value} は受理されるべき`);
    assert.equal(parsed.suppressionFingerprintAlgo, value);
  }
});

test('CLI: --fingerprint-algo の既定は v1（オプトイン）', () => {
  const parsed = parseArgs([
    'suppression',
    'add',
    '--fingerprint',
    'a'.repeat(16),
    '--feedback',
    'false_positive',
    '--rationale',
    'r',
  ]);
  assert.equal(parsed.suppressionFingerprintAlgo, 'v1');
});

test('CLI: --fingerprint-algo は大小を無視して受理し小文字で保存する', () => {
  // 他の列挙値オプション（--severity / --phase / --fail-on / --warn-on）が
  // すべて大小無視である以上、ここだけ区別すると v1.72.1 の `--phase Upstream`
  // 誤拒否と同型の非対称になる。schema の enum は小文字なので保存値も小文字。
  for (const variant of ['V2', 'v2', 'V1']) {
    const parsed = parseArgs([
      'suppression',
      'add',
      '--fingerprint',
      'a'.repeat(16),
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--fingerprint-algo',
      variant,
    ]);
    assert.notEqual(parsed.usageError, true, `--fingerprint-algo ${variant} を誤拒否した`);
    assert.equal(parsed.suppressionFingerprintAlgo, variant.toLowerCase());
  }
});

test('CLI: --fingerprint-algo の不正値・値欠落は usage error になる', () => {
  const invalid = parseArgs([
    'suppression',
    'add',
    '--fingerprint',
    'a'.repeat(16),
    '--feedback',
    'false_positive',
    '--rationale',
    'r',
    '--fingerprint-algo',
    'v9',
  ]);
  assert.equal(invalid.usageError, true);

  const missing = parseArgs([
    'suppression',
    'add',
    '--fingerprint',
    'a'.repeat(16),
    '--fingerprint-algo',
  ]);
  assert.equal(missing.usageError, true);
});

// ---------------------------------------------------------------------------
// v2 fingerprint の入手経路（--debug 出力）
// ---------------------------------------------------------------------------
// `--fingerprint-algo v2` を用意しても、利用者が v2 の 16-hex を入手できなければ
// 「exit 0 で作られるが何も抑制しないエントリ」しか作れない。`--debug` は
// pages/guides/repo-wide-review.md が #687 以来「fingerprint はここから拾う」と
// 書いてきた経路なので、v1 と v2 の両方をここに出す。
test('--debug 出力に finding の v1 / v2 fingerprint が両方出る', async () => {
  const { printDebugInfo } = await import('../src/cli/render.mjs');
  const findings = annotateFingerprints([
    { ...V1_PIN.finding, lineStart: 10, severity: 'minor' },
    { ...V1_PIN.finding, lineStart: 200, severity: 'minor' },
  ]);
  const lines = [];
  printDebugInfo(
    {
      findings,
      changedFiles: ['src/app.ts'],
      diffText: '',
      tokenEstimate: 0,
      reviewDebug: {},
    },
    { log: (m) => lines.push(String(m)) }
  );
  const out = lines.join('\n');
  for (const f of findings) {
    assert.ok(
      out.includes(f.fingerprint),
      `v1 fingerprint ${f.fingerprint} が --debug に出ていない`
    );
    assert.ok(
      out.includes(f.fingerprintV2),
      `v2 fingerprint ${f.fingerprintV2} が --debug に出ていない`
    );
  }
  // 行が分かる形で出す（同 kind が複数あるとき、どちらの行か判別できないと
  // v2 の hex を選べない）。
  assert.match(out, /src\/app\.ts:10/);
  assert.match(out, /src\/app\.ts:200/);
});

test('--debug: fingerprint を持たない finding では節を出さない', async () => {
  const { printDebugInfo } = await import('../src/cli/render.mjs');
  const lines = [];
  printDebugInfo(
    { findings: [], changedFiles: [], diffText: '', tokenEstimate: 0, reviewDebug: {} },
    { log: (m) => lines.push(String(m)) }
  );
  assert.ok(!lines.join('\n').includes('Finding fingerprints'));
});
