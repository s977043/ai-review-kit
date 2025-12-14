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
  assert.equal(comments[0].kind, 'hardcoded-secret');
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

test('buildHeuristicComments detects hardcoded secrets in object literals (unquoted key)', () => {
  const diffText = `diff --git a/src/config/auth.ts b/src/config/auth.ts
index 1111111..2222222 100644
--- a/src/config/auth.ts
+++ b/src/config/auth.ts
@@ -1,3 +1,4 @@
 export const authConfig = {
   issuer: 'https://example.com',
+  serviceToken: 'DUMMY_TOKEN_123',
 };
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-midstream-security-basic-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/config/auth.ts');
  assert.equal(comments[0].line, 3);
  assert.equal(comments[0].kind, 'hardcoded-secret');
});

test('buildHeuristicComments detects explicit token patterns (AKIA/ghp_/sk-)', () => {
  const diffText = `diff --git a/src/config/keys.ts b/src/config/keys.ts
index 1111111..2222222 100644
--- a/src/config/keys.ts
+++ b/src/config/keys.ts
@@ -1,1 +1,4 @@
+export const AWS_KEY = 'AKIA1234567890ABCDEF';
+export const GH_TOKEN = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
+export const API_KEY = 'sk-1234567890abcdef1234567890abcdef';
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-midstream-security-basic-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 3);
  assert.equal(comments[0].file, 'src/config/keys.ts');
  assert.ok(comments.every(c => c.kind === 'hardcoded-secret'));
});

test('buildHeuristicComments ignores env var references (process.env / import.meta.env)', () => {
  const diffText = `diff --git a/src/config/keys.ts b/src/config/keys.ts
index 1111111..2222222 100644
--- a/src/config/keys.ts
+++ b/src/config/keys.ts
@@ -1,1 +1,3 @@
+export const API_KEY = process.env.API_KEY;
+export const TOKEN = import.meta.env.VITE_TOKEN;
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-midstream-security-basic-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('buildHeuristicComments ignores URL values and short values', () => {
  const diffText = `diff --git a/src/config/keys.ts b/src/config/keys.ts
index 1111111..2222222 100644
--- a/src/config/keys.ts
+++ b/src/config/keys.ts
@@ -1,1 +1,3 @@
+export const API_KEY = 'https://example.com/not-a-secret';
+export const API_TOKEN = 'short';
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-midstream-security-basic-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('buildHeuristicComments limits hardcoded secret findings to 3', () => {
  const diffText = `diff --git a/src/config/keys.ts b/src/config/keys.ts
index 1111111..2222222 100644
--- a/src/config/keys.ts
+++ b/src/config/keys.ts
@@ -1,1 +1,6 @@
+export const TOKEN_1 = 'DUMMY_TOKEN_123';
+export const TOKEN_2 = 'DUMMY_TOKEN_234';
+export const TOKEN_3 = 'DUMMY_TOKEN_345';
+export const TOKEN_4 = 'DUMMY_TOKEN_456';
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-midstream-security-basic-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 3);
});

test('buildHeuristicComments detects hardcoded secrets in object literals (quoted key)', () => {
  const diffText = `diff --git a/src/config/auth.ts b/src/config/auth.ts
index 1111111..2222222 100644
--- a/src/config/auth.ts
+++ b/src/config/auth.ts
@@ -1,3 +1,4 @@
 export const authConfig = {
   issuer: 'https://example.com',
+  'serviceToken': 'DUMMY_TOKEN_123',
 };
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-midstream-security-basic-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].kind, 'hardcoded-secret');
});

test('buildHeuristicComments detects silent catch for observability skill', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-observability-silent-catch.diff',
    'utf8',
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-midstream-logging-observability-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/services/payments.ts');
  assert.equal(comments[0].kind, 'silent-catch');
  assert.ok(Number.isInteger(comments[0].line));
});

test('buildHeuristicComments detects missing tests for downstream test skills', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/downstream-new-behavior-no-tests.diff',
    'utf8',
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'rr-downstream-test-existence-001' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/calc.ts');
  assert.equal(comments[0].kind, 'missing-tests');
  assert.ok(Number.isInteger(comments[0].line));
});
