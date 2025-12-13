import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseUnifiedDiff } from '../src/lib/diff.mjs';
import { buildHeuristicComments } from '../src/lib/heuristic-review.mjs';

test('buildHeuristicComments detects hardcoded secrets for security skill', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-security-hardcoded-token.diff',
    'utf8',
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-midstream-security-basic-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/config/auth.ts');
  assert.equal(comments[0].line, 6);
  assert.match(comments[0].message, /秘密情報/);
});

test('buildHeuristicComments is quiet when security skill is not selected', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-security-hardcoded-token.diff',
    'utf8',
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-midstream-typescript-strict-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

