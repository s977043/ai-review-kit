import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parseUnifiedDiff } from '../src/lib/diff.mjs';
import { generateReview } from '../src/lib/review-engine.mjs';
import {
  formatFindingMessage,
  validateFindingMessage,
  parseFindingMessage,
  normalizeSeverity,
  severityToPriority,
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
