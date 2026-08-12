// Integration test for #687 PR-C: applySuppressions wired into runLocalReview.
//
// runLocalReview composes a lot of subsystems (diff parsing, plan, prompt,
// LLM, fingerprint annotation, suppression filtering). Spinning up the full
// pipeline from a unit test fights every part of it. Instead this file
// exercises the *seams* that PR-C added:
//
//   1. local-runner.mjs imports applySuppressions from suppression-apply.mjs.
//   2. The piece it inserts (annotateFingerprints -> applySuppressions ->
//      return) preserves the fingerprint and produces the contract that
//      callers downstream rely on.
//
// Full end-to-end behavior (memory loading, diff parsing, etc.) is covered
// by tests/integration/local-review.test.mjs which exercises runLocalReview
// via the CLI. If that integration breaks because of PR-C, that test fails;
// this file just guards the seam logic so a regression here surfaces with a
// clear message.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import { applySuppressions } from '../src/lib/suppression-apply.mjs';
import { computeFingerprint, annotateFingerprints } from '../src/lib/finding-factory.mjs';
import { filterSuppressedComments } from '../src/lib/local-runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localRunnerSource = readFileSync(
  resolve(__dirname, '..', 'src', 'lib', 'local-runner.mjs'),
  'utf8'
);

test('local-runner.mjs imports applySuppressions from suppression-apply.mjs', () => {
  // Direct grep — guards against an accidental removal of the import line
  // during a refactor. If this fires, the wiring has been lost.
  assert.match(
    localRunnerSource,
    /import \{ applySuppressions \} from '\.\/suppression-apply\.mjs';/,
    'applySuppressions import is missing from local-runner.mjs'
  );
});

test('local-runner.mjs runLocalReview return surfaces suppressedFindings + suppressionsApplied', () => {
  // Likewise grep for the contract keys. Future readers can rely on the
  // names below being part of the public return shape.
  assert.match(localRunnerSource, /\bsuppressedFindings\b/, 'suppressedFindings key missing');
  // reviewDebug spreads review.debug and always includes suppressionsApplied;
  // #692 PR-C may layer repoContextSecurity in alongside it.
  assert.match(
    localRunnerSource,
    /reviewDebug:\s*\{[\s\S]*\.\.\.\(review\.debug \?\? \{\}\)[\s\S]*suppressionsApplied/,
    'reviewDebug.suppressionsApplied wiring missing'
  );
});

test('local-runner.mjs filters review.comments alongside findings (no leak)', () => {
  // Regression guard for the gemini-code-assist[bot] high-priority finding on
  // PR #701: if the suppression filter only applied to `findings` and left
  // `comments` as the raw `review.comments`, suppressed findings still
  // surfaced verbatim in the PR review thread.
  assert.match(
    localRunnerSource,
    /comments:\s*keptComments,/,
    'comments must use the suppression-filtered keptComments, not review.comments'
  );
  assert.match(localRunnerSource, /const keptComments\s*=/, 'keptComments derivation missing');
});

test('comment filtering by fingerprint matches finding fingerprint algo', () => {
  // The filter computes a fingerprint from the comment's fields and rejects
  // comments whose fingerprint matches a suppressed finding. If the algo
  // ever drifts between the two paths, comments and findings desync.
  const finding = { ruleId: 'rule-x', file: 'src/x.ts', message: 'msg', severity: 'minor' };
  const comment = { skillId: 'rule-x', file: 'src/x.ts', message: 'msg', line: 42 };
  const fpFinding = computeFingerprint(finding);
  const fpComment = computeFingerprint({
    ruleId: comment.skillId || 'unknown',
    file: comment.file,
    message: comment.message,
  });
  assert.equal(fpFinding, fpComment, 'comment-derived fingerprint must equal finding fingerprint');
});

test('applySuppressions+annotateFingerprints integration: matched finding moves to suppressedFindings', () => {
  // Reproduce the exact composition runLocalReview uses. If applySuppressions
  // ever stops accepting findings annotated by annotateFingerprints, this
  // test fails with a precise diff between expected and actual shape.
  const rawFindings = [
    { ruleId: 'r1', file: 'src/x.ts', message: 'leak detected', severity: 'minor' },
    { ruleId: 'r2', file: 'src/y.ts', message: 'unrelated finding', severity: 'major' },
  ];
  const annotated = annotateFingerprints(rawFindings);
  assert.equal(annotated[0].fingerprint.length, 16);
  assert.equal(annotated[1].fingerprint.length, 16);

  const suppression = {
    id: 'suppression-' + annotated[0].fingerprint + '-1',
    type: 'suppression',
    content: 'accepted',
    metadata: {
      createdAt: '2026-04-01T00:00:00Z',
      author: 't',
      tags: ['suppression', 'active', 'file'],
      relatedFiles: ['src/x.ts'],
    },
    context: {
      scope: 'file',
      active: true,
      fingerprint: annotated[0].fingerprint,
      feedbackType: 'false_positive',
    },
  };

  const { keptFindings, suppressedFindings, applied } = applySuppressions(annotated, {
    suppressions: [suppression],
  });

  // r1 (minor + matching fingerprint + false_positive) → suppressed.
  // r2 (no matching suppression) → kept.
  assert.equal(suppressedFindings.length, 1);
  assert.equal(suppressedFindings[0].ruleId, 'r1');
  assert.equal(suppressedFindings[0].suppressionRef, suppression.id);

  assert.equal(keptFindings.length, 1);
  assert.equal(keptFindings[0].ruleId, 'r2');

  assert.equal(applied.length, 1);
  assert.equal(applied[0].action, 'suppressed');
});

test('applySuppressions deterministic with computeFingerprint inputs', () => {
  // Sanity: computeFingerprint must round-trip identically. Without this,
  // suppression matching becomes non-deterministic and the entire #687 P1
  // policy degrades into best-effort matching.
  const finding = { ruleId: 'r1', file: 'src/x.ts', message: 'leak detected' };
  assert.equal(computeFingerprint(finding), computeFingerprint(finding));
});

// ---------------------------------------------------------------------------
// #1797: fingerprintAlgo v2（行アンカー）でのコメント絞り込み
// ---------------------------------------------------------------------------
// v2 の抑制はコメント側も同じ粒度で落とさなければ意味がない。逆に v1 の粒度で
// 落とすと、v2 が区別するために存在している「同ファイル・同 kind の別の行」の
// コメントまで消える。この分岐は runLocalReview の内部にあり未テストだったため、
// filterSuppressedComments として切り出して直接 pin する。
//
// v2 の正しさは「comment 側の `c.line` と finding 側の `lineStart` が同じ行を
// 指すこと」に依存している（review-engine.mjs が `lineStart: c.line ?? null` と
// して finding を作る）。読めば整合しているが pin されていなかった前提なので、
// ここで明示的に assert する。

const v2Comments = [
  { skillId: 'rule-x', file: 'src/x.ts', message: 'msg', line: 10 },
  { skillId: 'rule-x', file: 'src/x.ts', message: 'msg', line: 200 },
];

/** review-engine.mjs が comment から finding を作る形の最小再現。 */
const findingsFromComments = (comments) =>
  annotateFingerprints(
    comments.map((c) => ({
      ruleId: c.skillId,
      file: c.file,
      message: c.message,
      lineStart: c.line,
      severity: 'minor',
    }))
  );

test('#1797: comment の line と finding の lineStart は同じ v2 fingerprint を導く', () => {
  const [finding] = findingsFromComments([v2Comments[0]]);
  const [kept] = filterSuppressedComments(v2Comments.slice(0, 1), [
    { ...finding, suppressionAlgo: 'v2' },
  ]);
  // 突合の形: 該当行のコメントは落ちる（kept が undefined になる）。
  assert.equal(kept, undefined, 'comment 側の line から導いた v2 値が finding と一致していない');
});

test('#1797: v2 抑制は同ファイル・同 kind でも別の行のコメントを残す', () => {
  const findings = findingsFromComments(v2Comments);
  const suppressed = [{ ...findings[0], suppressionAlgo: 'v2' }];
  const kept = filterSuppressedComments(v2Comments, suppressed);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].line, 200);
});

test('#1797: v1 抑制は従来どおり同ファイル・同 kind のコメントを全部落とす', () => {
  const findings = findingsFromComments(v2Comments);
  const suppressed = [{ ...findings[0], suppressionAlgo: 'v1' }];
  assert.deepEqual(filterSuppressedComments(v2Comments, suppressed), []);
  // suppressionAlgo が無い（v2 以前の呼び出し元）場合も v1 として扱う。
  const legacy = [{ ...findings[0] }];
  delete legacy[0].suppressionAlgo;
  assert.deepEqual(filterSuppressedComments(v2Comments, legacy), []);
});

test('#1797: 抑制が無ければコメントは素通りする（同一配列を返す）', () => {
  assert.equal(filterSuppressedComments(v2Comments, []), v2Comments);
});

test('#1797: v1 と v2 の抑制が混在しても互いの粒度を壊さない', () => {
  const comments = [
    ...v2Comments,
    { skillId: 'rule-y', file: 'src/x.ts', message: 'other', line: 5 },
    { skillId: 'rule-y', file: 'src/x.ts', message: 'other', line: 300 },
  ];
  const findings = findingsFromComments(comments);
  const kept = filterSuppressedComments(comments, [
    { ...findings[0], suppressionAlgo: 'v2' }, // rule-x の 10 行目だけ
    { ...findings[2], suppressionAlgo: 'v1' }, // rule-y は全部
  ]);
  assert.deepEqual(
    kept.map((c) => [c.skillId, c.line]),
    [['rule-x', 200]]
  );
});
