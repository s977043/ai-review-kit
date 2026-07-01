import test from 'node:test';
import assert from 'node:assert/strict';

import { parseUnifiedDiff, optimizeDiff } from '../src/lib/diff-processor.mjs';

test('parseUnifiedDiff returns empty files array for null input', () => {
  assert.deepEqual(parseUnifiedDiff(null), { files: [] });
});

test('parseUnifiedDiff returns empty files array for undefined input', () => {
  assert.deepEqual(parseUnifiedDiff(undefined), { files: [] });
});

test('parseUnifiedDiff returns empty files array for empty string', () => {
  assert.deepEqual(parseUnifiedDiff(''), { files: [] });
});

test('optimizeDiff strips hunks consisting only of --> comment lines', () => {
  const diff = {
    diffText: '',
    files: [
      {
        path: 'index.html',
        oldPath: 'index.html',
        newPath: 'index.html',
        hunks: [
          {
            header: '@@ -1,1 +1,1 @@',
            lines: ['-  -->', '+  -->'],
          },
        ],
      },
    ],
  };
  const result = optimizeDiff(diff);
  assert.equal(result.files.length, 0, '--> only hunk should be stripped as comment-only');
  assert.equal(result.diffText, '', 'diffText should be empty when all files stripped');
});

test('optimizeDiff strips hunks consisting only of --!> comment lines', () => {
  const diff = {
    diffText: '',
    files: [
      {
        path: 'index.html',
        oldPath: 'index.html',
        newPath: 'index.html',
        hunks: [
          {
            header: '@@ -1,1 +1,1 @@',
            lines: ['-  --!>', '+  --!>'],
          },
        ],
      },
    ],
  };
  const result = optimizeDiff(diff);
  assert.equal(result.files.length, 0, '--!> only hunk should be stripped as comment-only');
  assert.equal(result.diffText, '', 'diffText should be empty when all files stripped');
});
