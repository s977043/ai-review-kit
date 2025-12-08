import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizeDiff } from '../src/lib/diff-optimizer.mjs';
import { parseUnifiedDiff } from '../src/lib/diff.mjs';

const whitespaceDiff = `diff --git a/src/app.js b/src/app.js
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,3 @@
-const foo = 1;
+const foo = 1;
 const bar = 2;
 `;

const commentDiff = `diff --git a/src/app.js b/src/app.js
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,3 @@
-// old comment
+// new comment
 const bar = 2;
 `;

const markdownDiff = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,1 +1,1 @@
-hello
+hello world
`;

function buildLargeDiff() {
  const before = Array.from({ length: 250 }, (_, i) => `${i + 1}`).join('\n');
  const after = Array.from({ length: 250 }, (_, i) => `${i + 1}`).concat(['251', '252', '253']).join('\n');
  return `diff --git a/src/big.js b/src/big.js
--- a/src/big.js
+++ b/src/big.js
@@ -1,250 +1,253 @@
-${before.split('\n').join('\n-')}
+${after.split('\n').join('\n+')}`;
}

function optimizeFromText(diffText) {
  const parsed = parseUnifiedDiff(diffText);
  return optimizeDiff({ files: parsed.files, diffText });
}

test('filters whitespace-only changes', () => {
  const result = optimizeFromText(whitespaceDiff);
  assert.equal(result.files.length, 0);
  assert.equal(result.diffText, '');
});

test('filters comment-only changes', () => {
  const result = optimizeFromText(commentDiff);
  assert.equal(result.files.length, 0);
});

test('filters markdown file changes', () => {
  const result = optimizeFromText(markdownDiff);
  assert.equal(result.files.length, 0);
});

test('truncates large hunks', () => {
  const result = optimizeFromText(buildLargeDiff());
  const hunkLines = result.files[0].hunks[0].lines;
  assert.ok(hunkLines.includes('... (hunk truncated) ...'));
});

test('reduces token estimate compared to raw diff', () => {
  const result = optimizeFromText(`${commentDiff}\n${buildLargeDiff()}`);
  assert.ok(result.rawTokenEstimate >= result.tokenEstimate);
  assert.ok(result.reduction >= 0);
});

test('renders new file paths with /dev/null correctly', () => {
  const newFileDiff = `diff --git a/new.js b/new.js
--- /dev/null
+++ b/new.js
@@ -0,0 +1,2 @@
+console.log('new');
+module.exports = {};
`;
  const result = optimizeFromText(newFileDiff);
  assert.match(result.diffText, /--- \/dev\/null/);
  assert.match(result.diffText, /\+\+\+ b\/new.js/);
});
