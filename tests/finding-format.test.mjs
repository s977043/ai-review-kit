import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parseUnifiedDiff } from '../src/lib/diff-processor.mjs';
import { buildPrompt, generateReview, parseLineComments } from '../src/lib/review-engine.mjs';
import {
  formatFindingMessage,
  validateFindingMessage,
  parseFindingMessage,
  normalizeSeverity,
  severityToPriority,
  normalizeScope,
  extractRefFieldSpans,
  stripTraceabilityRefs,
  RESERVED_FINDING_LABELS,
  SEVERITY_RANK,
} from '../src/lib/finding-factory.mjs';

test('formatFindingMessage produces a valid labeled message', () => {
  const msg = formatFindingMessage({
    finding: '問題がある',
    evidence: '差分上の根拠',
    impact: '困る',
    fix: '直す',
    severity: 'warning',
    confidence: 'medium',
  });
  const validated = validateFindingMessage(msg);
  assert.equal(validated.ok, true);
});

test('severityToPriority maps all four severity levels correctly', () => {
  assert.equal(severityToPriority('critical'), 'P1');
  assert.equal(severityToPriority('major'), 'P2');
  assert.equal(severityToPriority('minor'), 'P3');
  assert.equal(severityToPriority('info'), 'P4');
});

test('severityToPriority falls back to P2 for unknown values', () => {
  assert.equal(severityToPriority('unknown'), 'P2');
  assert.equal(severityToPriority(''), 'P2');
  assert.equal(severityToPriority(null), 'P2');
  assert.equal(severityToPriority(undefined), 'P2');
});

test('severityToPriority is case-insensitive', () => {
  assert.equal(severityToPriority('CRITICAL'), 'P1');
  assert.equal(severityToPriority('Major'), 'P2');
});

test('parseFindingMessage extracts all labeled fields', () => {
  const msg = formatFindingMessage({
    finding: 'トークンが平文',
    evidence: 'SECRET_TOKEN = "abc"',
    impact: '情報漏洩',
    fix: '環境変数に移す',
    severity: 'blocker',
    confidence: 'high',
  });
  const parsed = parseFindingMessage(msg);
  assert.equal(parsed.title, 'トークンが平文');
  assert.deepEqual(parsed.evidence, ['SECRET_TOKEN = "abc"']);
  assert.equal(parsed.severity, 'blocker');
  assert.equal(parsed.confidence, 'high');
  assert.ok(parsed.suggestion.length > 0);
});

test('parseFindingMessage returns empty evidence array when field is missing', () => {
  const parsed = parseFindingMessage('Finding: something Severity: warning Confidence: low');
  assert.deepEqual(parsed.evidence, []);
});

test('validateFindingMessage accepts mixed-case Severity and Confidence values', () => {
  const msg = formatFindingMessage({
    finding: 'テスト問題',
    evidence: '根拠',
    impact: '影響',
    fix: '修正',
    severity: 'blocker',
    confidence: 'high',
  })
    .replace('Severity: blocker', 'Severity: Blocker')
    .replace('Confidence: high', 'Confidence: High');
  const validated = validateFindingMessage(msg);
  assert.equal(validated.ok, true, 'mixed-case severity/confidence should be accepted');
});

// Regression (calibration run #1543): the model emitted the finding text as
// prose and appended only Severity:/Confidence: inline at end-of-line, omitting
// the Finding:/Evidence:/Impact:/Fix: labels. The old validator required all
// six labels, so every finding in the batch failed and the whole review fell
// back to heuristics. The machine-load-bearing labels (Severity/Confidence)
// are present, so this must now validate; the content labels are reported as
// recommended-but-missing without failing the finding.
test('validateFindingMessage accepts inline Severity/Confidence without content labels (#1543)', () => {
  const message =
    'retry loop swallows errors and could mask failures Severity: warning Confidence: high';
  const validated = validateFindingMessage(message);
  assert.equal(validated.ok, true, 'inline Severity/Confidence-only findings must validate');
  assert.deepEqual(validated.missing, [], 'no required labels are missing');
  assert.deepEqual(
    validated.missingRecommended,
    ['Finding:', 'Evidence:', 'Impact:', 'Fix:'],
    'the omitted content labels are reported as recommended-but-missing'
  );
});

// Fail-safe unchanged: a finding without the machine-load-bearing labels (or
// with an out-of-vocabulary value) is still invalid, so it is dropped and the
// batch still falls back to heuristics when nothing valid remains.
test('validateFindingMessage rejects findings missing Severity/Confidence (fail-safe)', () => {
  const missingBoth = validateFindingMessage('Finding: x Evidence: y Impact: z Fix: w');
  assert.equal(missingBoth.ok, false);
  assert.deepEqual(missingBoth.missing, ['Severity:', 'Confidence:']);

  const missingConfidence = validateFindingMessage('some prose Severity: blocker');
  assert.equal(missingConfidence.ok, false);
  assert.deepEqual(missingConfidence.missing, ['Confidence:']);
});

test('validateFindingMessage rejects out-of-vocabulary Severity/Confidence values (fail-safe)', () => {
  const badSeverity = validateFindingMessage('prose Severity: catastrophic Confidence: high');
  assert.equal(badSeverity.ok, false);
  assert.ok(badSeverity.invalid.includes('Severity:catastrophic'));

  const badConfidence = validateFindingMessage('prose Severity: warning Confidence: certain');
  assert.equal(badConfidence.ok, false);
  assert.ok(badConfidence.invalid.includes('Confidence:certain'));
});

test('normalizeSeverity maps internal vocabulary to schema vocabulary', () => {
  assert.equal(normalizeSeverity('blocker'), 'critical');
  assert.equal(normalizeSeverity('warning'), 'major');
  assert.equal(normalizeSeverity('nit'), 'minor');
  assert.equal(normalizeSeverity('info'), 'info');
  assert.equal(normalizeSeverity('critical'), 'critical');
  assert.equal(normalizeSeverity('major'), 'major');
  assert.equal(normalizeSeverity('unknown'), 'major');
  assert.equal(normalizeSeverity(null), 'major');
});

test('normalizeSeverity is case-insensitive and trims whitespace', () => {
  assert.equal(normalizeSeverity('BLOCKER'), 'critical');
  assert.equal(normalizeSeverity('  Warning  '), 'major');
  assert.equal(normalizeSeverity('Nit'), 'minor');
});

test('normalizeSeverity fail-safes on non-string inputs without throwing', () => {
  // Non-string severities (e.g. a numeric `severity: 3` in skill frontmatter)
  // must coerce to 'major' fail-safe, not throw. Regression guard for the
  // String() coercion that the removed per-module copies all carried.
  assert.equal(normalizeSeverity(3), 'major');
  assert.equal(normalizeSeverity(0), 'major');
  assert.equal(normalizeSeverity({}), 'major');
  assert.equal(normalizeSeverity([]), 'major');
  assert.equal(normalizeSeverity(true), 'major');
  assert.equal(normalizeSeverity(undefined), 'major');
});

test('SEVERITY_RANK is the canonical ascending rank of schema severities', () => {
  assert.deepEqual(SEVERITY_RANK, { info: 0, minor: 1, major: 2, critical: 3 });
  // Ranks must be strictly increasing in severity order (relied on by
  // suppression-apply / review-plan / verifier / reviewer-orchestrator).
  assert.ok(
    SEVERITY_RANK.info < SEVERITY_RANK.minor &&
      SEVERITY_RANK.minor < SEVERITY_RANK.major &&
      SEVERITY_RANK.major < SEVERITY_RANK.critical
  );
});

test('generateReview returns structured findings[]', async () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-security-hardcoded-token.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const diff = { diffText, files: parsed.files, changedFiles: parsed.files.map((f) => f.path) };
  const plan = { selected: [{ metadata: { id: 'security-basic' } }], skipped: [] };

  const result = await generateReview({ diff, plan, phase: 'midstream', dryRun: true });
  assert.ok(Array.isArray(result.findings), 'findings should be an array');
  assert.equal(result.findings.length, result.comments.length);

  const f = result.findings[0];
  assert.ok(f.id, 'finding should have id');
  assert.ok(['critical', 'major', 'minor', 'info'].includes(f.severity), 'severity is normalized');
  assert.ok(['high', 'medium', 'low'].includes(f.confidence), 'confidence is set');
  assert.equal(f.status, 'open');
  assert.ok(Array.isArray(f.evidence));
  assert.ok(f.title.length > 0);
  assert.ok(f.file.length > 0);
});

test('generateReview uses labeled format for heuristic findings', async () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-security-hardcoded-token.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const diff = { diffText, files: parsed.files, changedFiles: parsed.files.map((f) => f.path) };
  const plan = { selected: [{ metadata: { id: 'security-basic' } }], skipped: [] };

  const result = await generateReview({ diff, plan, phase: 'midstream', dryRun: true });
  assert.equal(result.comments.length, 1);
  assert.match(result.comments[0].message, /Finding: /);
  assert.match(result.comments[0].message, /Evidence: /);
  assert.match(result.comments[0].message, /Severity: blocker/);
  assert.match(result.comments[0].message, /Confidence: high/);
  assert.equal(result.debug.findingFormat.ok, true);
});

// #1644 Phase 1: scope vocabulary
test('normalizeScope maps known values and fails safe to in-diff', () => {
  assert.equal(normalizeScope('in-diff'), 'in-diff');
  assert.equal(normalizeScope('pre-existing'), 'pre-existing');
  assert.equal(normalizeScope('PRE-EXISTING '), 'pre-existing');
  assert.equal(normalizeScope('preexisting'), 'pre-existing');
  assert.equal(normalizeScope('out-of-diff'), 'in-diff', 'unknown value fails safe');
  assert.equal(normalizeScope(undefined), 'in-diff');
  assert.equal(normalizeScope(null), 'in-diff');
  assert.equal(normalizeScope(''), 'in-diff');
});

test('parseFindingMessage extracts an optional Scope label without disturbing other labels', () => {
  const withScope = parseFindingMessage(
    'Finding: 問題 Evidence: 根拠 Impact: 影響 Fix: 直す Severity: warning Confidence: high Scope: pre-existing'
  );
  assert.equal(withScope.scope, 'pre-existing');
  assert.equal(withScope.severity, 'warning');
  assert.equal(withScope.confidence, 'high');
  assert.equal(withScope.suggestion, '直す');

  const withoutScope = parseFindingMessage(
    'Finding: 問題 Evidence: 根拠 Impact: 影響 Fix: 直す Severity: warning Confidence: high'
  );
  assert.equal(withoutScope.scope, null);
  assert.equal(withoutScope.confidence, 'high');
});

test('parseFindingMessage does not truncate content on a prose "Scope:" occurrence', () => {
  // Back-compat guard (#1644 review W3): OAuth / IAM scopes appear verbatim in
  // real review text, and treating "Scope:" as a structural label would cut the
  // Evidence and Fix captures short.
  const parsed = parseFindingMessage(
    'Finding: token is over-privileged Evidence: the OAuth Scope: admin:org is granted in src/app.mjs Impact: 影響 Fix: narrow the requested Scope: read:org only Severity: warning Confidence: high'
  );
  assert.equal(parsed.evidence[0], 'the OAuth Scope: admin:org is granted in src/app.mjs');
  assert.equal(parsed.suggestion, 'narrow the requested Scope: read:org only');
  assert.equal(parsed.scope, null, 'prose occurrence is not a self-report');
});

test('parseFindingMessage ignores an out-of-vocabulary Scope value', () => {
  const parsed = parseFindingMessage(
    'Finding: 問題 Evidence: 根拠 Fix: 直す Severity: warning Confidence: high Scope: unknown'
  );
  assert.equal(parsed.scope, null);
});

test('generateReview assigns a scope to every finding (fail-safe in-diff)', async () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-security-hardcoded-token.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const diff = { diffText, files: parsed.files, changedFiles: parsed.files.map((f) => f.path) };
  const plan = { selected: [{ metadata: { id: 'security-basic' } }], skipped: [] };

  const result = await generateReview({ diff, plan, phase: 'midstream', dryRun: true });
  assert.ok(result.findings.length > 0);
  for (const f of result.findings) {
    assert.ok(['in-diff', 'pre-existing'].includes(f.scope), `unexpected scope: ${f.scope}`);
  }
  assert.equal(typeof result.debug.scopeStats.mismatch, 'number');
});

// ---------------------------------------------------------------------------
// #1666 (#1545 Phase 2): criterionRefs / artifactRefs traceability labels
// ---------------------------------------------------------------------------

test('parseFindingMessage extracts CriterionRefs / ArtifactRefs without disturbing other labels', () => {
  const parsed = parseFindingMessage(
    'Finding: 問題 Evidence: 根拠 Impact: 影響 Fix: 直す Severity: warning Confidence: high CriterionRefs: AC-4, TC-7 ArtifactRefs: plan.md#AC-4, todo.md#TASK-3'
  );
  assert.deepEqual(parsed.criterionRefs, ['AC-4', 'TC-7']);
  assert.deepEqual(parsed.artifactRefs, ['plan.md#AC-4', 'todo.md#TASK-3']);
  assert.equal(parsed.severity, 'warning');
  assert.equal(parsed.confidence, 'high');
  assert.equal(parsed.suggestion, '直す');
  assert.equal(parsed.evidence[0], '根拠');
});

test('parseFindingMessage keeps refs out of a preceding capture regardless of label order', () => {
  // Reversal boundary: the refs labels may appear before Severity/Confidence,
  // in either order, and must terminate the Fix capture rather than be
  // swallowed by it.
  const parsed = parseFindingMessage(
    'Finding: 問題 Evidence: 根拠 Fix: 直す ArtifactRefs: plan.md#AC-4 CriterionRefs: AC-4 Severity: warning Confidence: high'
  );
  assert.equal(parsed.suggestion, '直す');
  assert.deepEqual(parsed.criterionRefs, ['AC-4']);
  assert.deepEqual(parsed.artifactRefs, ['plan.md#AC-4']);
  assert.equal(parsed.severity, 'warning');
});

test('parseFindingMessage returns null refs for an existing unlabeled message (back-compat)', () => {
  const msg = formatFindingMessage({
    finding: 'トークンが平文',
    evidence: 'SECRET_TOKEN = "abc"',
    impact: '情報漏洩',
    fix: '環境変数に移す',
    severity: 'blocker',
    confidence: 'high',
  });
  const parsed = parseFindingMessage(msg);
  assert.equal(parsed.criterionRefs, null);
  assert.equal(parsed.artifactRefs, null);
  // Every pre-existing field is byte-identical to the pre-#1666 behavior.
  assert.equal(parsed.title, 'トークンが平文');
  assert.deepEqual(parsed.evidence, ['SECRET_TOKEN = "abc"']);
  assert.equal(parsed.impact, '情報漏洩');
  assert.equal(parsed.suggestion, '環境変数に移す');
  assert.equal(parsed.severity, 'blocker');
  assert.equal(parsed.confidence, 'high');
});

test('parseFindingMessage does not truncate content on a prose refs mention (#1648 W3 regression)', () => {
  // The #1648 W3 lesson: a bare label in LABEL_ALTERNATION truncates any message
  // whose prose contains the same word. Refs values are free-form, so the guard
  // is shape-based (whitespace-free comma-separated tokens) plus case-sensitive
  // label matching (the lowerCamel schema field name is not a label).
  const japaneseProse = parseFindingMessage(
    'Finding: 参照が無い Evidence: finding に CriterionRefs: を付けていない Impact: 追跡不能 Fix: docs に ArtifactRefs: の説明を足す Severity: warning Confidence: high'
  );
  assert.equal(japaneseProse.evidence[0], 'finding に CriterionRefs: を付けていない');
  assert.equal(japaneseProse.suggestion, 'docs に ArtifactRefs: の説明を足す');
  assert.equal(japaneseProse.criterionRefs, null, 'prose occurrence is not a self-report');
  assert.equal(japaneseProse.artifactRefs, null);

  const lowerCamelProse = parseFindingMessage(
    'Finding: 命名 Evidence: the schema field criterionRefs: AC-4 is quoted here Fix: rename artifactRefs: plan.md#AC-4 in the doc Severity: warning Confidence: high'
  );
  assert.equal(lowerCamelProse.evidence[0], 'the schema field criterionRefs: AC-4 is quoted here');
  assert.equal(lowerCamelProse.suggestion, 'rename artifactRefs: plan.md#AC-4 in the doc');
  assert.equal(lowerCamelProse.criterionRefs, null, 'the label is case-sensitive');
  assert.equal(lowerCamelProse.artifactRefs, null);

  const englishProse = parseFindingMessage(
    'Finding: x Evidence: the plan lists CriterionRefs for every task Fix: add CriterionRefs to the template Severity: warning Confidence: high'
  );
  assert.equal(englishProse.evidence[0], 'the plan lists CriterionRefs for every task');
  assert.equal(englishProse.suggestion, 'add CriterionRefs to the template');
  assert.equal(englishProse.criterionRefs, null, 'a colon-less mention is not a label');
});

test('parseFindingMessage handles empty, reserved-word and oversized refs boundaries', () => {
  // Empty value: the label is present but carries no token.
  const empty = parseFindingMessage(
    'Finding: 問題 Evidence: 根拠 Fix: 直す CriterionRefs: Severity: warning Confidence: high'
  );
  assert.equal(empty.criterionRefs, null, 'an empty list is null, never []');
  assert.equal(empty.severity, 'warning', 'the following label is not swallowed');

  // A stray trailing comma must not let the list consume the next label.
  const trailingComma = parseFindingMessage(
    'Finding: 問題 Evidence: 根拠 Fix: 直す CriterionRefs: AC-4, Severity: warning Confidence: high'
  );
  assert.deepEqual(trailingComma.criterionRefs, ['AC-4']);
  assert.equal(trailingComma.severity, 'warning');
  assert.equal(trailingComma.confidence, 'high');

  // Oversized value: many refs and a long single token stay intact and linear.
  const manyRefs = Array.from({ length: 200 }, (_, i) => `AC-${i + 1}`);
  const longToken = `plan.md#${'a'.repeat(2000)}`;
  const started = Date.now();
  const oversized = parseFindingMessage(
    `Finding: 問題 Evidence: 根拠 Fix: 直す CriterionRefs: ${manyRefs.join(', ')} ArtifactRefs: ${longToken} Severity: warning Confidence: high`
  );
  assert.equal(oversized.criterionRefs.length, 200);
  assert.equal(oversized.criterionRefs[199], 'AC-200');
  assert.deepEqual(oversized.artifactRefs, [longToken]);
  assert.equal(oversized.severity, 'warning');
  assert.ok(Date.now() - started < 2000, 'parsing must not degrade on long ref lists');
});

test('generateReview carries CriterionRefs / ArtifactRefs from the message onto the finding', async () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-security-hardcoded-token.diff',
    'utf8'
  );
  const parsedDiff = parseUnifiedDiff(diffText);
  const diff = {
    diffText,
    files: parsedDiff.files,
    changedFiles: parsedDiff.files.map((f) => f.path),
  };
  const plan = { selected: [{ metadata: { id: 'security-basic' } }], skipped: [] };
  const targetFile = parsedDiff.files[0].path;
  const rawLlmText = [
    `${targetFile}:3: Finding: token is hardcoded Evidence: a literal token is added Impact: leak risk Fix: move the token to an environment variable Severity: warning Confidence: high CriterionRefs: AC-4, TC-7 ArtifactRefs: plan.md#AC-4`,
    `${targetFile}:4: Finding: no rotation path Evidence: no rotation helper is added Impact: stale credential Fix: document the rotation procedure Severity: nit Confidence: medium`,
  ].join('\n');

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: rawLlmText } }] }),
  });
  try {
    const result = await generateReview({
      diff,
      plan,
      phase: 'midstream',
      dryRun: false,
      includeFallback: false,
      apiKey: 'test-key',
    });
    assert.equal(result.debug.llmUsed, true);
    const withRefs = result.findings.find((f) => f.criterionRefs);
    assert.ok(withRefs, 'the labeled finding must survive to the findings array');
    assert.deepEqual(withRefs.criterionRefs, ['AC-4', 'TC-7']);
    assert.deepEqual(withRefs.artifactRefs, ['plan.md#AC-4']);
    // A finding without the labels keeps null — the refs are never invented.
    const withoutRefs = result.findings.find((f) => f.criterionRefs === null);
    assert.ok(withoutRefs, 'unlabeled findings stay unlabeled');
    assert.equal(withoutRefs.artifactRefs, null);
    // Non-interference: the refs never take part in the verified decision.
    assert.equal(result.debug.verifierStats.rejected, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// #1666 adversarial-review follow-up (F1, F3–F5, F7–F8)
// ---------------------------------------------------------------------------

test('buildPrompt instructs the model on the refs labels and forbids inventing IDs (F1)', () => {
  // Producer coverage: SKILL.md bodies never reach the model (buildSkillSummary
  // emits id/phase/severity only), so without a prompt line the schema field is
  // unreachable on the LLM path. The anti-fabrication clause is part of the
  // contract — River Review does not own the ID namespace.
  const { prompt } = buildPrompt({
    diffText: 'diff --git a/src/app.mjs b/src/app.mjs\n+const a = 1;\n',
    diffFiles: [{ path: 'src/app.mjs', addedLines: [1], hunks: [] }],
    plan: { selected: [], skipped: [] },
    phase: 'midstream',
  });
  assert.match(prompt, /"CriterionRefs: AC-4, TC-7"/);
  assert.match(prompt, /"ArtifactRefs: plan\.md#AC-4, todo\.md#TASK-3"/);
  assert.match(prompt, /appear verbatim in an artifact supplied above/);
  assert.match(prompt, /omit the label entirely — never invent, guess, abbreviate, or renumber/);
});

test('RESERVED_FINDING_LABELS is the shared label set and includes the Fix alias (F3)', () => {
  // `Suggestion` is accepted by the verifier's actionability check but was
  // missing from the reserved set, so `CriterionRefs: AC-4, Suggestion: …`
  // swallowed the suggestion and emitted "Suggestion" as a ref value.
  for (const label of [
    'Finding',
    'Evidence',
    'Impact',
    'Fix',
    'Severity',
    'Confidence',
    'Suggestion',
    'Scope',
    'CriterionRefs',
    'ArtifactRefs',
  ]) {
    assert.ok(RESERVED_FINDING_LABELS.includes(label), `${label} must be reserved`);
  }

  const parsed = parseFindingMessage(
    'Finding: x Evidence: root cause here CriterionRefs: AC-4, Suggestion: do the fix properly Severity: warning Confidence: high'
  );
  assert.deepEqual(parsed.criterionRefs, ['AC-4'], 'a reserved label is never a ref value');
  assert.match(
    stripTraceabilityRefs(
      'Finding: x Evidence: e CriterionRefs: AC-4, Suggestion: do the fix properly Severity: warning'
    ),
    /Suggestion: do the fix properly/,
    'stripping must not consume the following label'
  );
});

test('parseFindingMessage accepts the lenient label and value shapes (F4/F5)', () => {
  const cases = [
    // [label, message, expected artifactRefs]
    ['full-width colon', 'Fix: 直す ArtifactRefs：plan.md#AC-4', ['plan.md#AC-4']],
    [
      'japanese comma separator',
      'Fix: 直す ArtifactRefs: plan.md#AC-4、todo.md#TASK-3',
      ['plan.md#AC-4', 'todo.md#TASK-3'],
    ],
    ['relative path', 'Fix: 直す ArtifactRefs: ./docs/plan.md#AC-4', ['./docs/plan.md#AC-4']],
    ['backticked value', 'Fix: 直す ArtifactRefs: `plan.md#AC-4`', ['plan.md#AC-4']],
    ['no space after colon', 'Fix: 直す ArtifactRefs:plan.md#AC-4', ['plan.md#AC-4']],
  ];
  for (const [label, message, expected] of cases) {
    assert.deepEqual(parseFindingMessage(message).artifactRefs, expected, label);
  }

  // F5: a Japanese full stop directly before the label — the shape the filling
  // skills actually emit. The stop stays with the preceding field.
  const afterFullStop = parseFindingMessage(
    'Finding: x Evidence: e Fix: 環境変数へ移す。CriterionRefs: AC-4 Severity: warning Confidence: high'
  );
  assert.deepEqual(afterFullStop.criterionRefs, ['AC-4']);
  assert.equal(afterFullStop.suggestion, '環境変数へ移す。');

  // The exact example line requirements-acceptance/SKILL.md tells the reviewer
  // to emit must parse.
  const skillExample = parseFindingMessage(
    'docs/prd.md:42: [severity=major] AC-4 の期待結果がテスト不能。追記案: Then の観測点を数値で定義。CriterionRefs: AC-4 ArtifactRefs: docs/prd.md#AC-4'
  );
  assert.deepEqual(skillExample.criterionRefs, ['AC-4']);
  assert.deepEqual(skillExample.artifactRefs, ['docs/prd.md#AC-4']);

  // A trailing refs label must not bleed into Confidence any more.
  const trailing = parseFindingMessage(
    'Finding: x Evidence: e Fix: move to env var Severity: warning Confidence: high CriterionRefs：AC-4'
  );
  assert.equal(trailing.confidence, 'high');
  assert.deepEqual(trailing.criterionRefs, ['AC-4']);
});

test('parseFindingMessage rejects a URL ref value but still ends the preceding field (F9)', () => {
  // A URL truncates at the scheme colon, so it is not a supported ref shape.
  // It must be dropped, not glued onto the Fix text.
  const parsed = parseFindingMessage(
    'Finding: x Evidence: e Fix: fix it properly ArtifactRefs: https://example.com/plan#AC-4 Severity: warning Confidence: high'
  );
  assert.equal(parsed.artifactRefs, null);
  assert.equal(parsed.suggestion, 'fix it properly');
  assert.equal(parsed.confidence, 'high');
});

test('parseFindingMessage merges every occurrence of a refs label and dedupes (F8)', () => {
  const parsed = parseFindingMessage(
    'Finding: x Evidence: e Fix: fix it properly CriterionRefs: AC-1 CriterionRefs: AC-2, AC-1 Severity: warning Confidence: high'
  );
  assert.deepEqual(parsed.criterionRefs, ['AC-1', 'AC-2'], 'later labels are not dropped');
});

test('a well-formed refs label inside English prose is treated as a label (F7 tradeoff)', () => {
  // In-band labelling has no escape character, so a reviewer writing the exact
  // label form inside prose gets it parsed. This is the accepted cost, pinned
  // here so a future change is a deliberate one. Backticks are the workaround:
  // they are not a valid label prefix.
  const bare = parseFindingMessage(
    'Finding: x Evidence: e Impact: i Fix: add CriterionRefs: AC-4 to every finding Severity: warning Confidence: high'
  );
  assert.deepEqual(bare.criterionRefs, ['AC-4'], 'documented: prose in the label form is a label');
  assert.equal(bare.suggestion, 'add');

  const backticked = parseFindingMessage(
    'Finding: x Evidence: e Impact: i Fix: add `CriterionRefs:` AC-4 to every finding Severity: warning Confidence: high'
  );
  assert.equal(backticked.criterionRefs, null, 'a backticked mention is not a label');
  assert.equal(backticked.suggestion, 'add `CriterionRefs:` AC-4 to every finding');
});

test('the SKILL.md output templates survive line-based parsing (F6)', () => {
  // Findings are ingested one line at a time, so a refs label on a continuation
  // line is discarded before it ever reaches parseFindingMessage. Both filling
  // skills now put the labels at the end of the `<file>:<line>:` line; this
  // pins that so the templates cannot silently drift back.
  const assumptionTrace = [
    'src/lib/rate-limit.mjs:12: [Assumption 未解消] plan の「上流 API は 429 を返す」前提の解消証拠が無い ArtifactRefs: plan.md#assumptions-3',
    '  plan 前提: 「上流 API はレート超過時に HTTP 429 を返すと仮定する」(plan.md #assumptions-3)',
    '  Severity: warning',
  ].join('\n');
  const [traceComment] = parseLineComments(assumptionTrace) ?? [];
  assert.ok(traceComment, 'the anchor line must be ingested');
  assert.deepEqual(parseFindingMessage(traceComment.message).artifactRefs, [
    'plan.md#assumptions-3',
  ]);

  const requirements =
    'docs/prd.md:42: [severity=major] AC-4 の期待結果がテスト不能。追記案: Then の観測点を数値で定義。CriterionRefs: AC-4 ArtifactRefs: docs/prd.md#AC-4';
  const [requirementsComment] = parseLineComments(requirements) ?? [];
  assert.ok(requirementsComment);
  const requirementsParsed = parseFindingMessage(requirementsComment.message);
  assert.deepEqual(requirementsParsed.criterionRefs, ['AC-4']);
  assert.deepEqual(requirementsParsed.artifactRefs, ['docs/prd.md#AC-4']);
});

test('extractRefFieldSpans covers the whole refs field, not just the parsed list (F2 input)', () => {
  // Wider than the extraction grammar on purpose: a space-separated list is not
  // parsed into values, but it must still not destroy the finding downstream.
  assert.deepEqual(
    extractRefFieldSpans(
      'Finding: x Evidence: e ArtifactRefs: plan.md#AC-4 todo.md#TASK-3 Severity: warning'
    ),
    ['plan.md#AC-4 todo.md#TASK-3']
  );
  assert.deepEqual(extractRefFieldSpans('Finding: x Evidence: no refs here'), []);
  assert.deepEqual(
    extractRefFieldSpans('Fix: docs に ArtifactRefs: の説明を足す Severity: warning'),
    [],
    'a label with no value opens no span'
  );
});
