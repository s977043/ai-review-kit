import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parseUnifiedDiff } from '../src/lib/diff.mjs';
import { generateReview } from '../src/lib/review-engine.mjs';
import { formatFindingMessage, validateFindingMessage } from '../src/lib/finding-format.mjs';

test('formatFindingMessage produces a valid labeled message', () => {
  const msg = formatFindingMessage({
    finding: '問題がある',
    impact: '困る',
    fix: '直す',
    severity: 'warning',
    confidence: 'medium',
  });
  const validated = validateFindingMessage(msg);
  assert.equal(validated.ok, true);
});

test('generateReview uses labeled format for heuristic findings', async () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-security-hardcoded-token.diff',
    'utf8',
  );
  const parsed = parseUnifiedDiff(diffText);
  const diff = { diffText, files: parsed.files, changedFiles: parsed.files.map(f => f.path) };
  const plan = { selected: [{ metadata: { id: 'rr-midstream-security-basic-001' } }], skipped: [] };

  const result = await generateReview({ diff, plan, phase: 'midstream', dryRun: true });
  assert.equal(result.comments.length, 1);
  assert.match(result.comments[0].message, /Finding: /);
  assert.match(result.comments[0].message, /Severity: blocker/);
  assert.match(result.comments[0].message, /Confidence: high/);
  assert.equal(result.debug.findingFormat.ok, true);
});
