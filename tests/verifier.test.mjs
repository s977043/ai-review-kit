import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyFinding } from '../src/lib/verifier.mjs';

test('verifyFinding: passes for well-formed finding', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: The diff shows X\nSeverity: warning\nConfidence: high\nFix: Use Y instead of Z for better performance',
    },
    diff: '...',
    skill: { metadata: { phase: 'midstream', severity: 'major' } },
  });
  assert.ok(result.verified);
  assert.equal(result.reasons.length, 0);
});

test('verifyFinding: rejects finding without evidence', () => {
  const result = verifyFinding({
    finding: {
      message: 'Finding:\nSeverity: warning\nFix: Do something about this',
    },
    diff: '...',
    skill: { metadata: { phase: 'midstream' } },
  });
  assert.ok(!result.verified);
  assert.ok(result.reasons.some((r) => r.includes('evidence')));
  assert.equal(result.checks.evidenceExists, false);
});

test('verifyFinding: rejects finding without actionable fix', () => {
  const result = verifyFinding({
    finding: {
      message: 'Finding:\nEvidence: code at line 5\nSeverity: warning\nFix: fix it',
    },
    diff: '...',
    skill: { metadata: { phase: 'midstream' } },
  });
  assert.ok(!result.verified);
  assert.equal(result.checks.suggestionActionable, false);
});

test('verifyFinding: accepts finding with no phase info (lenient)', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: some evidence here\nSeverity: warning\nFix: Replace the old API call with the new versioned endpoint',
    },
    diff: '...',
    skill: { metadata: {} },
  });
  assert.ok(result.checks.phaseCoherent);
});

test('verifyFinding: severity blocker maps to critical', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: hardcoded secret\nSeverity: blocker\nFix: Move to environment variable and use GitHub Secrets',
    },
    diff: '...',
    skill: { metadata: { phase: 'midstream', severity: 'critical' } },
  });
  assert.ok(result.checks.severityJustified);
});

test('verifyFinding: rejects blocker severity when skill is minor', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: minor style issue\nSeverity: blocker\nFix: Rename the variable to follow naming convention guidelines',
    },
    diff: '...',
    skill: { metadata: { phase: 'midstream', severity: 'minor' } },
  });
  assert.equal(result.checks.severityJustified, false);
});

test('verifyFinding: severity nit maps to minor', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: trailing whitespace\nSeverity: nit\nFix: Remove the trailing whitespace on lines 5 and 12',
    },
    diff: '...',
    skill: { metadata: { severity: 'minor' } },
  });
  assert.ok(result.checks.severityJustified);
});

test('verifyFinding: nit severity rejected when skill is info', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: minor whitespace\nSeverity: nit\nFix: Clean up trailing whitespace in the file',
    },
    diff: '...',
    skill: { metadata: { severity: 'info' } },
  });
  assert.equal(result.checks.severityJustified, false);
});

test('verifyFinding: lenient when finding has no severity', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: some evidence here\nFix: Replace the old API call with the new versioned endpoint',
    },
    diff: '...',
    skill: { metadata: { severity: 'minor' } },
  });
  assert.ok(result.checks.severityJustified);
});

test('verifyFinding: lenient when skill has no severity', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: some evidence here\nSeverity: blocker\nFix: Replace the old API call with the new versioned endpoint',
    },
    diff: '...',
    skill: { metadata: {} },
  });
  assert.ok(result.checks.severityJustified);
});

test('verifyFinding: Suggestion label is accepted as actionable', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: duplicated logic\nSeverity: warning\nSuggestion: Extract the shared logic into a utility function',
    },
    diff: '...',
    skill: { metadata: { severity: 'major' } },
  });
  assert.ok(result.checks.suggestionActionable);
});

test('verifyFinding: phase mismatch is rejected', () => {
  const result = verifyFinding({
    finding: {
      phase: 'upstream',
      message:
        'Finding:\nEvidence: some evidence here\nSeverity: warning\nFix: Replace the old API call with the new versioned endpoint',
    },
    diff: '...',
    skill: { metadata: { phase: 'midstream', severity: 'major' } },
  });
  assert.equal(result.checks.phaseCoherent, false);
  assert.ok(result.reasons.some((r) => r.includes('Phase mismatch')));
});

test('verifyFinding: array skill phase containing finding phase passes', () => {
  const result = verifyFinding({
    finding: {
      phase: 'midstream',
      message:
        'Finding:\nEvidence: some evidence here\nSeverity: warning\nFix: Replace the old API call with the new versioned endpoint',
    },
    diff: '...',
    skill: { metadata: { phase: ['upstream', 'midstream'], severity: 'major' } },
  });
  assert.equal(result.checks.phaseCoherent, true);
  assert.ok(result.verified);
});

test('verifyFinding: array skill phase not containing finding phase is rejected', () => {
  const result = verifyFinding({
    finding: {
      phase: 'downstream',
      message:
        'Finding:\nEvidence: some evidence here\nSeverity: warning\nFix: Replace the old API call with the new versioned endpoint',
    },
    diff: '...',
    skill: { metadata: { phase: ['upstream', 'midstream'], severity: 'major' } },
  });
  assert.equal(result.checks.phaseCoherent, false);
  assert.ok(
    result.reasons.some((r) => r.includes('Phase mismatch') && r.includes('upstream/midstream'))
  );
});

test('verifyFinding: string skill phase matching finding phase still passes', () => {
  const result = verifyFinding({
    finding: {
      phase: 'midstream',
      message:
        'Finding:\nEvidence: some evidence here\nSeverity: warning\nFix: Replace the old API call with the new versioned endpoint',
    },
    diff: '...',
    skill: { metadata: { phase: 'midstream', severity: 'major' } },
  });
  assert.equal(result.checks.phaseCoherent, true);
});

test('verifyFinding: multiple failures are all reported', () => {
  const result = verifyFinding({
    finding: {
      phase: 'upstream',
      message: 'No structured labels at all',
    },
    diff: '...',
    skill: { metadata: { phase: 'midstream', severity: 'minor' } },
  });
  assert.ok(!result.verified);
  assert.ok(result.reasons.length >= 3);
  assert.equal(result.checks.evidenceExists, false);
  assert.equal(result.checks.phaseCoherent, false);
  assert.equal(result.checks.suggestionActionable, false);
});

test('verifyFinding: evidenceInDiff passes when file is in diff', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: hardcoded secret in src/config/auth.ts\nSeverity: warning\nFix: Move the secret to environment variables',
    },
    diff: 'diff --git a/src/config/auth.ts b/src/config/auth.ts\n+const secret = "abc";',
    skill: { metadata: { severity: 'major' } },
  });
  assert.equal(result.checks.evidenceInDiff, true);
});

test('verifyFinding: evidenceInDiff fails when file is not in diff', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: hardcoded secret in src/config/auth.ts\nSeverity: warning\nFix: Move the secret to environment variables',
    },
    diff: 'diff --git a/src/index.mjs b/src/index.mjs\n+console.log("hello");',
    skill: { metadata: { severity: 'major' } },
  });
  assert.equal(result.checks.evidenceInDiff, false);
  assert.ok(result.reasons.some((r) => r.includes('file not found in diff')));
});

test('verifyFinding: evidenceInDiff lenient when no file reference', () => {
  const result = verifyFinding({
    finding: {
      message:
        'Finding:\nEvidence: the code uses an outdated pattern\nSeverity: warning\nFix: Migrate to the newer API for better performance',
    },
    diff: 'diff --git a/src/index.mjs b/src/index.mjs\n+console.log("hello");',
    skill: { metadata: { severity: 'major' } },
  });
  assert.equal(result.checks.evidenceInDiff, true);
});

test('verifyFinding: filePhaseCoherent passes when file type matches phase', () => {
  const result = verifyFinding({
    finding: {
      file: 'tests/foo.test.mjs',
      phase: 'downstream',
      message:
        'Finding:\nEvidence: test is incomplete\nSeverity: nit\nFix: Add assertion for edge case',
    },
    diff: 'diff --git a/tests/foo.test.mjs\n+test()',
    skill: { metadata: { severity: 'minor' } },
    fileTypes: { test: ['tests/foo.test.mjs'], app: ['src/index.mjs'] },
  });
  assert.equal(result.checks.filePhaseCoherent, true);
});

test('verifyFinding: filePhaseCoherent rejects when file type mismatches phase', () => {
  const result = verifyFinding({
    finding: {
      file: 'tests/foo.test.mjs',
      phase: 'upstream',
      message:
        'Finding:\nEvidence: test is incomplete\nSeverity: nit\nFix: Add assertion for edge case',
    },
    diff: 'diff --git a/tests/foo.test.mjs\n+test()',
    skill: { metadata: { severity: 'minor' } },
    fileTypes: { test: ['tests/foo.test.mjs'], app: ['src/index.mjs'] },
  });
  assert.equal(result.checks.filePhaseCoherent, false);
  assert.ok(result.reasons.some((r) => r.includes('File type does not match')));
});

test('verifyFinding: filePhaseCoherent lenient when fileTypes not provided', () => {
  const result = verifyFinding({
    finding: {
      file: 'tests/foo.test.mjs',
      phase: 'upstream',
      message:
        'Finding:\nEvidence: test is incomplete\nSeverity: nit\nFix: Add assertion for edge case',
    },
    diff: 'diff --git a/tests/foo.test.mjs\n+test()',
    skill: { metadata: { severity: 'minor' } },
  });
  assert.equal(result.checks.filePhaseCoherent, true);
});
