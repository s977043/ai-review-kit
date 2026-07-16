import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizeDiff, parseUnifiedDiff } from '../src/lib/diff-processor.mjs';

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
  const after = Array.from({ length: 250 }, (_, i) => `${i + 1}`)
    .concat(['251', '252', '253'])
    .join('\n');
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

test('filters bundled dist file changes', () => {
  const distDiff = `diff --git a/runners/github-action/dist/index.mjs b/runners/github-action/dist/index.mjs
--- a/runners/github-action/dist/index.mjs
+++ b/runners/github-action/dist/index.mjs
@@ -1,2 +1,2 @@
-const bundled = 1;
+const bundled = 2;
`;
  const result = optimizeFromText(distDiff);
  assert.equal(result.files.length, 0);
  assert.equal(result.diffText, '');
});

test('filters dist source-map and generated declaration changes', () => {
  const generatedDiff = `diff --git a/runners/node-api/dist/index.d.ts b/runners/node-api/dist/index.d.ts
--- a/runners/node-api/dist/index.d.ts
+++ b/runners/node-api/dist/index.d.ts
@@ -1,1 +1,1 @@
-export declare const a: number;
+export declare const a: string;
`;
  const result = optimizeFromText(generatedDiff);
  assert.equal(result.files.length, 0);
});

test('keeps normal source file changes (does not over-exclude)', () => {
  const srcDiff = `diff --git a/src/lib/diff-processor.mjs b/src/lib/diff-processor.mjs
--- a/src/lib/diff-processor.mjs
+++ b/src/lib/diff-processor.mjs
@@ -1,2 +1,2 @@
-const value = 1;
+const value = 2;
`;
  const result = optimizeFromText(srcDiff);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].path, 'src/lib/diff-processor.mjs');
  assert.match(result.diffText, /src\/lib\/diff-processor\.mjs/);
});

test('does not exclude paths that merely contain "dist" as a substring', () => {
  const redistDiff = `diff --git a/src/redistribute.mjs b/src/redistribute.mjs
--- a/src/redistribute.mjs
+++ b/src/redistribute.mjs
@@ -1,2 +1,2 @@
-const value = 1;
+const value = 2;
`;
  const result = optimizeFromText(redistDiff);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].path, 'src/redistribute.mjs');
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
