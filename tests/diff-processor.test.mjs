import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseUnifiedDiff,
  optimizeDiff,
  isGeneratedArtifactPath,
} from '../src/lib/diff-processor.mjs';

test('parseUnifiedDiff returns empty files array for null input', () => {
  assert.deepEqual(parseUnifiedDiff(null), { files: [] });
});

test('parseUnifiedDiff returns empty files array for undefined input', () => {
  assert.deepEqual(parseUnifiedDiff(undefined), { files: [] });
});

test('parseUnifiedDiff returns empty files array for empty string', () => {
  assert.deepEqual(parseUnifiedDiff(''), { files: [] });
});

test('parseUnifiedDiff returns file and hunk information', () => {
  const sampleDiff = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
-hello
+hello world
+next
 context
`;
  const parsed = parseUnifiedDiff(sampleDiff);
  assert.equal(parsed.files.length, 1);
  const file = parsed.files[0];
  assert.equal(file.path, 'README.md');
  assert.equal(file.hunks.length, 1);
  assert.deepEqual(file.hunks[0].addedLines, [1, 2]);
  assert.deepEqual(file.addedLines, [1, 2]);
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

// --- #1597: isGeneratedArtifactPath (finding-output-stage predicate) ---
//
// This predicate is intentionally NARROWER than isExcludedFile (the LLM-diff
// optimizer's rule): output suppression matches only a generated `dist/`
// directory segment, never `.md` / lock files — suppressing a real finding on
// docs or a lock file would hide it. These assertions pin that contract as a
// canary against future over-suppression.
test('isGeneratedArtifactPath flags dist directory segments', () => {
  assert.equal(
    isGeneratedArtifactPath('runners/github-action/dist/index.mjs'),
    true,
    'dist bundle path (the #1597 real-world case) must be flagged'
  );
  assert.equal(isGeneratedArtifactPath('dist/index.js'), true, 'top-level dist/ must be flagged');
});

test('isGeneratedArtifactPath does NOT flag .md or lock files (narrower than isExcludedFile)', () => {
  // The whole point of #1597 rev: these paths ARE excluded from the LLM diff
  // (isExcludedFile true) but must NOT be suppressed from finding output.
  assert.equal(
    isGeneratedArtifactPath('docs/how-to.md'),
    false,
    'a real finding on a .md file (e.g. hardcoded secret in a code fence) must reach output'
  );
  assert.equal(
    isGeneratedArtifactPath('package-lock.json'),
    false,
    'lock file findings must not be suppressed from output'
  );
  assert.equal(isGeneratedArtifactPath('pnpm-lock.yaml'), false);
  assert.equal(isGeneratedArtifactPath('yarn.lock'), false);
});

test('isGeneratedArtifactPath does not flag ordinary source paths', () => {
  assert.equal(isGeneratedArtifactPath('src/lib/review-engine.mjs'), false);
  assert.equal(
    isGeneratedArtifactPath('runners/github-action/src/index.mjs'),
    false,
    'src under a runner that also has a dist/ must not be flagged'
  );
  assert.equal(
    isGeneratedArtifactPath('src/redistribute.ts'),
    false,
    'a path containing "dist" as a substring but not a dist/ segment must not be flagged'
  );
});

test('isGeneratedArtifactPath handles nullish / non-string input safely', () => {
  assert.equal(isGeneratedArtifactPath(''), false);
  assert.equal(isGeneratedArtifactPath(null), false);
  assert.equal(isGeneratedArtifactPath(undefined), false);
});
