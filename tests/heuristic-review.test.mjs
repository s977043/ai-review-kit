import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseUnifiedDiff } from '../src/lib/diff.mjs';
import { buildHeuristicComments } from '../src/lib/heuristic-review.mjs';

test('buildHeuristicComments detects hardcoded secrets for security skill', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-security-hardcoded-token.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/config/auth.ts');
  assert.equal(comments[0].line, 6);
  assert.equal(comments[0].kind, 'hardcoded-secret');
});

test('buildHeuristicComments is quiet when security skill is not selected', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-security-hardcoded-token.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'typescript-strict' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('buildHeuristicComments detects dangerous eval for security skill (no LLM)', () => {
  const diffText = `diff --git a/src/handler.ts b/src/handler.ts
index 1111111..2222222 100644
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,2 +1,3 @@
 export function run(input) {
+  return eval(input);
 }
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  const evalC = comments.find((c) => c.kind === 'dangerous-eval');
  assert.ok(evalC, 'expected a dangerous-eval finding');
  assert.equal(evalC.file, 'src/handler.ts');
});

test('buildHeuristicComments flags document.write and string-arg setTimeout (#dangerous-eval)', () => {
  const docWrite = `diff --git a/src/ui/render.ts b/src/ui/render.ts
--- a/src/ui/render.ts
+++ b/src/ui/render.ts
@@ -1,1 +1,2 @@
 const a = 1;
+document.write(userHtml);
`;
  const strTimer = `diff --git a/src/ui/render.ts b/src/ui/render.ts
--- a/src/ui/render.ts
+++ b/src/ui/render.ts
@@ -1,1 +1,2 @@
 const a = 1;
+setTimeout('doStuff()', 100);
`;
  const safeTimer = `diff --git a/src/ui/render.ts b/src/ui/render.ts
--- a/src/ui/render.ts
+++ b/src/ui/render.ts
@@ -1,1 +1,2 @@
 const a = 1;
+setTimeout(() => doStuff(), 100);
`;
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const dw = buildHeuristicComments({ diff: { files: parseUnifiedDiff(docWrite).files }, plan });
  const st = buildHeuristicComments({ diff: { files: parseUnifiedDiff(strTimer).files }, plan });
  const safe = buildHeuristicComments({ diff: { files: parseUnifiedDiff(safeTimer).files }, plan });
  assert.ok(dw.find((c) => c.kind === 'dangerous-eval'));
  assert.ok(st.find((c) => c.kind === 'dangerous-eval'));
  assert.equal(
    safe.find((c) => c.kind === 'dangerous-eval'),
    undefined
  );
});

test('buildHeuristicComments flags document.writeln (#1085 review)', () => {
  const diffText = `diff --git a/src/ui/render.ts b/src/ui/render.ts
--- a/src/ui/render.ts
+++ b/src/ui/render.ts
@@ -1,1 +1,2 @@
 const a = 1;
+document.writeln(userHtml);
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.ok(comments.find((c) => c.kind === 'dangerous-eval'));
});

test('buildHeuristicComments still flags eval after a // inside a string (#1085 review)', () => {
  // The trailing-comment strip must be quote-aware: the // here is inside the
  // string literal, so the real eval after it must NOT be lost.
  const diffText = `diff --git a/src/handler.ts b/src/handler.ts
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const u = "http://x"; eval(payload);
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.ok(comments.find((c) => c.kind === 'dangerous-eval'));
});

test('buildHeuristicComments does not flag dangerous eval in test files', () => {
  const diffText = `diff --git a/src/handler.test.ts b/src/handler.test.ts
index 1111111..2222222 100644
--- a/src/handler.test.ts
+++ b/src/handler.test.ts
@@ -1,2 +1,3 @@
 test('x', () => {
+  eval('1+1');
 });
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.equal(
    comments.find((c) => c.kind === 'dangerous-eval'),
    undefined
  );
});

test('buildHeuristicComments detects leftover debugger for logging skill (no LLM)', () => {
  const diffText = `diff --git a/src/handler.ts b/src/handler.ts
index 1111111..2222222 100644
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,2 +1,3 @@
 export function run() {
+  debugger;
 }
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'logging-observability' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  const dbg = comments.find((c) => c.kind === 'debugger-leftover');
  assert.ok(dbg, 'expected a debugger-leftover finding');
  assert.equal(dbg.file, 'src/handler.ts');
});

test('buildHeuristicComments does not flag a commented-out debugger', () => {
  const diffText = `diff --git a/src/handler.ts b/src/handler.ts
index 1111111..2222222 100644
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,2 +1,3 @@
 export function run() {
+  // debugger;
 }
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'logging-observability' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.equal(
    comments.find((c) => c.kind === 'debugger-leftover'),
    undefined
  );
});

test('buildHeuristicComments detects disabled TLS verification for security skill (no LLM)', () => {
  const diffText = `diff --git a/src/config/http.ts b/src/config/http.ts
index 1111111..2222222 100644
--- a/src/config/http.ts
+++ b/src/config/http.ts
@@ -1,2 +1,3 @@
 export const agent = new https.Agent({
+  rejectUnauthorized: false,
 });
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  const tls = comments.find((c) => c.kind === 'insecure-tls');
  assert.ok(tls, 'expected an insecure-tls finding');
  assert.equal(tls.file, 'src/config/http.ts');
});

test('buildHeuristicComments detects merge conflict markers (no LLM)', () => {
  const diffText = `diff --git a/src/handler.ts b/src/handler.ts
index 1111111..2222222 100644
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,1 +1,4 @@
 const a = 1;
+<<<<<<< HEAD
+const b = 2;
+>>>>>>> feature
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'logging-observability' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.ok(comments.find((c) => c.kind === 'merge-conflict'));
});

test('buildHeuristicComments detects weak hash (md5/sha1) for security skill (no LLM)', () => {
  const diffText = `diff --git a/src/auth/token.ts b/src/auth/token.ts
--- a/src/auth/token.ts
+++ b/src/auth/token.ts
@@ -1,1 +1,2 @@
 import crypto from 'crypto';
+const h = crypto.createHash('md5').update(x).digest('hex');
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.ok(comments.find((c) => c.kind === 'weak-hash'));
});

test('buildHeuristicComments detects command injection via template literal (no LLM)', () => {
  const inj = `diff --git a/src/api/run.ts b/src/api/run.ts
--- a/src/api/run.ts
+++ b/src/api/run.ts
@@ -1,1 +1,2 @@
 import { execSync } from 'child_process';
+execSync(\`ls \${userInput}\`);
`;
  const safe = `diff --git a/src/api/run.ts b/src/api/run.ts
--- a/src/api/run.ts
+++ b/src/api/run.ts
@@ -1,1 +1,2 @@
 import { execFile } from 'child_process';
+execFile('ls', [userInput]);
`;
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const injComments = buildHeuristicComments({
    diff: { files: parseUnifiedDiff(inj).files },
    plan,
  });
  const safeComments = buildHeuristicComments({
    diff: { files: parseUnifiedDiff(safe).files },
    plan,
  });
  assert.ok(injComments.find((c) => c.kind === 'command-injection'));
  assert.equal(
    safeComments.find((c) => c.kind === 'command-injection'),
    undefined
  );
});

test('buildHeuristicComments does not flag weak hash in a trailing comment (#1084 review)', () => {
  const diffText = `diff --git a/src/auth/token.ts b/src/auth/token.ts
--- a/src/auth/token.ts
+++ b/src/auth/token.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const h = strong(); // do not use createHash('md5')
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.equal(
    comments.find((c) => c.kind === 'weak-hash'),
    undefined
  );
});

test('buildHeuristicComments does not flag regex.exec as command injection (#1084 review)', () => {
  const diffText = `diff --git a/src/api/run.ts b/src/api/run.ts
--- a/src/api/run.ts
+++ b/src/api/run.ts
@@ -1,1 +1,2 @@
 const re = /x/;
+const m = re.exec(\`value \${userInput}\`);
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.equal(
    comments.find((c) => c.kind === 'command-injection'),
    undefined
  );
});

test('buildHeuristicComments detects disabled tests (.skip / xit) (no LLM)', () => {
  const diffText = `diff --git a/tests/foo.test.mjs b/tests/foo.test.mjs
index 1111111..2222222 100644
--- a/tests/foo.test.mjs
+++ b/tests/foo.test.mjs
@@ -1,2 +1,4 @@
 import test from 'node:test';
+test.skip('pending', () => {});
+xit('also disabled', () => {});
+xcontext('group disabled', () => {});
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'test-existence' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.ok(comments.find((c) => c.kind === 'disabled-test'));
});

test('buildHeuristicComments detects diff3 base marker ||||||| (#1082 review)', () => {
  const diffText = `diff --git a/src/handler.ts b/src/handler.ts
index 1111111..2222222 100644
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,1 +1,2 @@
 const a = 1;
+||||||| base
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'logging-observability' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.ok(comments.find((c) => c.kind === 'merge-conflict'));
});

test('buildHeuristicComments detects @ts-ignore but not @ts-expect-error (no LLM)', () => {
  const ignore = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,1 +1,2 @@
 const a = 1;
+// @ts-ignore
`;
  const expectErr = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,1 +1,2 @@
 const a = 1;
+// @ts-expect-error reason
`;
  const plan = { selected: [{ metadata: { id: 'typescript-strict' } }] };
  const ignoreComments = buildHeuristicComments({
    diff: { files: parseUnifiedDiff(ignore).files },
    plan,
  });
  const expectComments = buildHeuristicComments({
    diff: { files: parseUnifiedDiff(expectErr).files },
    plan,
  });
  assert.ok(ignoreComments.find((c) => c.kind === 'ts-suppression'));
  assert.equal(
    expectComments.find((c) => c.kind === 'ts-suppression'),
    undefined
  );
});

test('buildHeuristicComments does not flag debugger in a trailing comment (#1081 review)', () => {
  const diffText = `diff --git a/src/handler.ts b/src/handler.ts
index 1111111..2222222 100644
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,2 +1,3 @@
 export function run() {
+  const x = 1; // remove the debugger later
 }
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'logging-observability' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.equal(
    comments.find((c) => c.kind === 'debugger-leftover'),
    undefined
  );
});

test('buildHeuristicComments flags NODE_TLS_REJECT_UNAUTHORIZED=0 but not =1 (#1081 review)', () => {
  const insecure = `diff --git a/src/config/http.ts b/src/config/http.ts
--- a/src/config/http.ts
+++ b/src/config/http.ts
@@ -1,1 +1,2 @@
 const a = 1;
+process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
`;
  const secure = `diff --git a/src/config/http.ts b/src/config/http.ts
--- a/src/config/http.ts
+++ b/src/config/http.ts
@@ -1,1 +1,2 @@
 const a = 1;
+process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
`;
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const insecureComments = buildHeuristicComments({
    diff: { files: parseUnifiedDiff(insecure).files },
    plan,
  });
  const secureComments = buildHeuristicComments({
    diff: { files: parseUnifiedDiff(secure).files },
    plan,
  });
  assert.ok(insecureComments.find((c) => c.kind === 'insecure-tls'));
  assert.equal(
    secureComments.find((c) => c.kind === 'insecure-tls'),
    undefined
  );
});

test('buildHeuristicComments does not flag eval in a comment (#1080 review)', () => {
  const diffText = `diff --git a/src/handler.ts b/src/handler.ts
index 1111111..2222222 100644
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,2 +1,3 @@
 export function run(input) {
+  // never use eval(input) here
 }
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.equal(
    comments.find((c) => c.kind === 'dangerous-eval'),
    undefined
  );
});

test('buildHeuristicComments does not flag a commented-out .only (#1080 review)', () => {
  const diffText = `diff --git a/tests/foo.test.mjs b/tests/foo.test.mjs
index 1111111..2222222 100644
--- a/tests/foo.test.mjs
+++ b/tests/foo.test.mjs
@@ -1,2 +1,3 @@
 import test from 'node:test';
+// test.only('focused', () => {});
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'test-existence' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.equal(
    comments.find((c) => c.kind === 'focused-test'),
    undefined
  );
});

test('buildHeuristicComments detects focused tests (.only) for test skill (no LLM)', () => {
  const diffText = `diff --git a/tests/foo.test.mjs b/tests/foo.test.mjs
index 1111111..2222222 100644
--- a/tests/foo.test.mjs
+++ b/tests/foo.test.mjs
@@ -1,2 +1,3 @@
 import test from 'node:test';
+test.only('focused', () => {});
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'test-existence' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  const focused = comments.find((c) => c.kind === 'focused-test');
  assert.ok(focused, 'expected a focused-test finding');
  assert.equal(focused.file, 'tests/foo.test.mjs');
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
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

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
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 3);
  assert.equal(comments[0].file, 'src/config/keys.ts');
  assert.ok(comments.every((c) => c.kind === 'hardcoded-secret'));
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
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

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
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

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
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

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
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].kind, 'hardcoded-secret');
});

test('buildHeuristicComments detects silent catch for observability skill', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-observability-silent-catch.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'logging-observability' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/services/payments.ts');
  assert.equal(comments[0].kind, 'silent-catch');
  assert.ok(Number.isInteger(comments[0].line));
});

test('buildHeuristicComments detects missing tests for downstream test skills', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/downstream-new-behavior-no-tests.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'test-existence' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/calc.ts');
  assert.equal(comments[0].kind, 'missing-tests');
  assert.ok(Number.isInteger(comments[0].line));
});

test('buildHeuristicComments detects pull_request_target in GitHub Actions workflows', () => {
  const diffText = `diff --git a/.github/workflows/test.yml b/.github/workflows/test.yml
index 1111111..2222222 100644
--- a/.github/workflows/test.yml
+++ b/.github/workflows/test.yml
@@ -1,3 +1,5 @@
 name: Test
 on:
-  push:
+  pull_request_target:
+    branches: [main]
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, '.github/workflows/test.yml');
  assert.equal(comments[0].kind, 'gh-actions-pull-request-target');
  assert.ok(Number.isInteger(comments[0].line));
});

test('buildHeuristicComments detects pull_request_target in array syntax', () => {
  const diffText = `diff --git a/.github/workflows/test.yml b/.github/workflows/test.yml
index 1111111..2222222 100644
--- a/.github/workflows/test.yml
+++ b/.github/workflows/test.yml
@@ -1,2 +1,2 @@
 name: Test
-on: [push, pull_request]
+on: [push, pull_request_target]
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].kind, 'gh-actions-pull-request-target');
});

test('buildHeuristicComments detects excessive permissions in GitHub Actions workflows', () => {
  const diffText = `diff --git a/.github/workflows/test.yml b/.github/workflows/test.yml
index 1111111..2222222 100644
--- a/.github/workflows/test.yml
+++ b/.github/workflows/test.yml
@@ -5,3 +5,5 @@ on:
 jobs:
   test:
     runs-on: ubuntu-latest
+    permissions: write-all
     steps:
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, '.github/workflows/test.yml');
  assert.equal(comments[0].kind, 'gh-actions-excessive-permissions');
  assert.ok(Number.isInteger(comments[0].line));
});

test('buildHeuristicComments detects secrets in run blocks', () => {
  const diffText = `diff --git a/.github/workflows/deploy.yml b/.github/workflows/deploy.yml
index 1111111..2222222 100644
--- a/.github/workflows/deploy.yml
+++ b/.github/workflows/deploy.yml
@@ -10,3 +10,4 @@ jobs:
     steps:
       - uses: actions/checkout@v3
+      - run: echo $\{\{ secrets.API_KEY \}\}
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, '.github/workflows/deploy.yml');
  assert.equal(comments[0].kind, 'gh-actions-secret-in-run');
  assert.ok(Number.isInteger(comments[0].line));
});

test('buildHeuristicComments detects unsanitized user input in run blocks', () => {
  const diffText = `diff --git a/.github/workflows/comment.yml b/.github/workflows/comment.yml
index 1111111..2222222 100644
--- a/.github/workflows/comment.yml
+++ b/.github/workflows/comment.yml
@@ -10,3 +10,4 @@ jobs:
     steps:
       - uses: actions/checkout@v3
+      - run: echo "$\{\{ github.event.issue.title \}\}"
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, '.github/workflows/comment.yml');
  assert.equal(comments[0].kind, 'gh-actions-unsanitized-input');
  assert.ok(Number.isInteger(comments[0].line));
});

test('buildHeuristicComments ignores non-workflow YAML files', () => {
  const diffText = `diff --git a/config/settings.yml b/config/settings.yml
index 1111111..2222222 100644
--- a/config/settings.yml
+++ b/config/settings.yml
@@ -1,1 +1,2 @@
 name: test
+permissions: write-all
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});
