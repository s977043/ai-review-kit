import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeTestImpact } from '../src/lib/test-impact.mjs';

test('analyzeTestImpact: no app changes is low risk', () => {
  const result = analyzeTestImpact(['docs/readme.md']);
  assert.equal(result.riskLevel, 'low');
  assert.equal(result.appFilesChanged, 0);
});

test('analyzeTestImpact: app changes with tests is low risk', () => {
  const result = analyzeTestImpact(['src/lib/verifier.mjs', 'tests/verifier.test.mjs']);
  assert.equal(result.riskLevel, 'low');
  assert.equal(result.gapFiles.length, 0);
});

test('analyzeTestImpact: app changes without tests is high risk', () => {
  const result = analyzeTestImpact(['src/lib/review-engine.mjs', 'src/lib/diff-processor.mjs']);
  assert.equal(result.riskLevel, 'high');
  assert.equal(result.gapFiles.length, 2);
});

test('analyzeTestImpact: partial test coverage is medium risk', () => {
  const result = analyzeTestImpact([
    'src/lib/verifier.mjs',
    'src/lib/review-engine.mjs',
    'tests/verifier.test.mjs',
  ]);
  assert.equal(result.riskLevel, 'medium');
});
