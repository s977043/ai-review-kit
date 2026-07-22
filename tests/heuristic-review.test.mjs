import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseUnifiedDiff } from '../src/lib/diff-processor.mjs';
import {
  buildHeuristicComments,
  SKILL_HEURISTIC_MAP,
  HEURISTIC_SKILL_IDS,
  HEURISTIC_KIND_PRESENTATIONS,
} from '../src/lib/heuristic-review.mjs';

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

test('buildHeuristicComments detects a caller special-case for altitude-generalization', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-altitude-caller-special-case.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'altitude-generalization' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/lib/finding-formatter.mjs');
  assert.equal(comments[0].line, 51);
  assert.equal(comments[0].kind, 'caller-special-case');
});

test('caller special-case is quiet on a host opt-in public option (FP canary)', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-altitude-host-optin.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'altitude-generalization' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('caller special-case is quiet when the only branch is a single added one', () => {
  const diffText = `diff --git a/src/lib/format.mjs b/src/lib/format.mjs
index 1111111..2222222 100644
--- a/src/lib/format.mjs
+++ b/src/lib/format.mjs
@@ -1,2 +1,5 @@
 export function format(x, options = {}) {
+  if (options.caller === 'cli') {
+    x = x.trim();
+  }
 }
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'altitude-generalization' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('caller special-case ignores comment-only mentions of a caller branch', () => {
  const diffText = `diff --git a/src/lib/format.mjs b/src/lib/format.mjs
index 1111111..2222222 100644
--- a/src/lib/format.mjs
+++ b/src/lib/format.mjs
@@ -1,3 +1,5 @@
 export function format(x, options = {}) {
   if (options.caller === 'cli') {
+  // TODO: remove if (options.caller === 'exporter') { someday
+  // if (options.caller === 'exporter') { legacy branch }
 }
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'altitude-generalization' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('buildHeuristicComments detects closure scope retention on a lazy singleton', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-closure-scope-retention.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'closure-scope-retention' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/lib/skill-cache.mjs');
  assert.equal(comments[0].line, 18);
  assert.equal(comments[0].kind, 'closure-scope-retention');
});

test('closure scope retention is quiet on immediate reduce-and-release (FP canary)', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-closure-immediate-reduce.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'closure-scope-retention' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('closure scope retention is quiet when the cached object has no methods over large data', () => {
  const diffText = `diff --git a/src/lib/config-cache.mjs b/src/lib/config-cache.mjs
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/lib/config-cache.mjs
@@ -0,0 +1,10 @@
+import { readFile } from 'node:fs/promises';
+
+let cachedConfig = null;
+
+export async function getConfig(path) {
+  if (cachedConfig) return cachedConfig;
+  const rawText = await readFile(path, 'utf8');
+  cachedConfig = { port: Number(JSON.parse(rawText).port) };
+  return cachedConfig;
+}
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'closure-scope-retention' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('new simplify heuristics are quiet when their skills are not selected', () => {
  const diffText = fs.readFileSync(
    'tests/fixtures/planner-dataset/diffs/midstream-closure-scope-retention.diff',
    'utf8'
  );
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'altitude-generalization' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('caller special-case does not add up across unrelated hunks (per-hunk counting)', () => {
  const diffText = `diff --git a/src/lib/format.mjs b/src/lib/format.mjs
index 1111111..2222222 100644
--- a/src/lib/format.mjs
+++ b/src/lib/format.mjs
@@ -10,3 +10,6 @@ export function formatA(x, options = {}) {
 export function formatA(x, options = {}) {
+  if (options.caller === 'cli') {
+    x = trim(x);
+  }
 }
@@ -40,3 +43,6 @@ export function formatB(y, options = {}) {
 export function formatB(y, options = {}) {
+  if (options.caller === 'exporter') {
+    y = pad(y);
+  }
 }
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'altitude-generalization' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 0);
});

test('closure scope retention fires when the slot declaration is outside the diff', () => {
  const diffText = `diff --git a/src/lib/registry-cache.mjs b/src/lib/registry-cache.mjs
index 1111111..2222222 100644
--- a/src/lib/registry-cache.mjs
+++ b/src/lib/registry-cache.mjs
@@ -5,4 +5,13 @@ let cachedLookup = null;
 export async function getLookup(registryPath) {
   if (cachedLookup) return cachedLookup;
+  const rawText = await readFile(registryPath, 'utf8');
+  const entries = parseAllDocuments(rawText).flatMap((doc) => doc.toJS()?.skills ?? []);
+  cachedLookup = {
+    severityOf(id) {
+      const entry = entries.find((e) => e.id === id);
+      return entry ? entry.severity : 'major';
+    },
+  };
   return cachedLookup;
 }
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'closure-scope-retention' } }] };

  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });

  assert.equal(comments.length, 1);
  assert.equal(comments[0].file, 'src/lib/registry-cache.mjs');
  assert.equal(comments[0].kind, 'closure-scope-retention');
});

// --- 単一レジストリ（SSoT）の不変条件 -------------------------------------
// detector の追加は heuristic-review.mjs の HEURISTIC_REGISTRY 1 箇所で完結し、
// SKILL_HEURISTIC_MAP / HEURISTIC_SKILL_IDS / HEURISTIC_KIND_PRESENTATIONS は
// すべてそこから導出される。以下はその導出契約を固定する回帰テスト。
test('registry derives HEURISTIC_SKILL_IDS from SKILL_HEURISTIC_MAP keys', () => {
  assert.deepEqual(HEURISTIC_SKILL_IDS, Object.keys(SKILL_HEURISTIC_MAP));
  // dry-run フィルタと review-runner が依存する既知スキル ID の集合。
  assert.deepEqual([...HEURISTIC_SKILL_IDS].sort(), [
    'altitude-generalization',
    'closure-scope-retention',
    'coverage-gap',
    'invisible-unicode-injection',
    'logging-observability',
    'security-basic',
    'test-existence',
    'typescript-strict',
  ]);
});

test('SKILL_HEURISTIC_MAP values are non-empty detector-name arrays', () => {
  for (const [skillId, names] of Object.entries(SKILL_HEURISTIC_MAP)) {
    assert.ok(Array.isArray(names) && names.length > 0, `${skillId} has detectors`);
    for (const name of names) {
      assert.match(name, /^find[A-Z]/, `${name} looks like a detector function name`);
    }
  }
});

test('every registry kind has a fully-specified presentation (no drift)', () => {
  const SEVERITIES = new Set(['blocker', 'warning', 'nit']);
  const CONFIDENCES = new Set(['high', 'medium', 'low']);
  assert.ok(HEURISTIC_KIND_PRESENTATIONS.size >= 18, 'covers all known kinds');
  for (const [kind, preset] of HEURISTIC_KIND_PRESENTATIONS) {
    for (const field of ['finding', 'evidence', 'impact', 'fix']) {
      assert.equal(typeof preset[field], 'string', `${kind}.${field} is a string`);
      assert.ok(preset[field].length > 0, `${kind}.${field} non-empty`);
    }
    assert.ok(SEVERITIES.has(preset.severity), `${kind}.severity in vocab`);
    assert.ok(CONFIDENCES.has(preset.confidence), `${kind}.confidence in vocab`);
  }
});

test('buildHeuristicComments emits only kinds known to the presentation registry', () => {
  // security-basic のすべての detector を発火させる差分。emit された kind が
  // すべて HEURISTIC_KIND_PRESENTATIONS に存在すれば、review-engine 側の
  // default フォールバックに落ちる orphan kind が無いことを示す。
  const diffText = `--- a/src/app.js
+++ b/src/app.js
@@ -1,0 +1,3 @@
+const API_KEY = "ghp_0123456789012345678901234567890123456";
+eval(userInput);
+const h = createHash('md5');
`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'security-basic' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.ok(comments.length > 0, 'at least one detector fired');
  for (const c of comments) {
    assert.ok(HEURISTIC_KIND_PRESENTATIONS.has(c.kind), `kind ${c.kind} has a presentation`);
  }
});

// ---- Invisible / dangerous Unicode injection (GlassWorm-type, #1631) ----
// Payloads are built with String.fromCodePoint so this test file stays pure
// ASCII on disk (no raw invisible bytes for tooling to mangle). The detector is
// deterministic; these positive + negative (canary) cases pin its behavior so a
// once-fixed false positive cannot silently regress (.claude/rules/review-core
// #1070).
const IU_PLAN = { selected: [{ metadata: { id: 'invisible-unicode-injection' } }] };

function invisibleUnicodeKinds(addedLine, file = 'src/payload.ts') {
  const diffText =
    `diff --git a/${file} b/${file}\n` +
    `--- a/${file}\n+++ b/${file}\n` +
    `@@ -1,1 +1,2 @@\n const a = 1;\n+${addedLine}\n`;
  const parsed = parseUnifiedDiff(diffText);
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan: IU_PLAN });
  return comments.map((c) => c.kind);
}

const CP = (...codes) => String.fromCodePoint(...codes);

test('invisible-unicode: flags bidirectional control (Trojan Source) in code', () => {
  // U+202E RIGHT-TO-LEFT OVERRIDE reorders the visible source (CVE-2021-42574).
  const kinds = invisibleUnicodeKinds(`const isAdmin = ${CP(0x202e)}false; // safe`);
  assert.ok(kinds.includes('bidi-control'), `expected bidi-control, got ${JSON.stringify(kinds)}`);
});

test('invisible-unicode: flags isolate control chars (U+2066-2069)', () => {
  const kinds = invisibleUnicodeKinds(`return ${CP(0x2066)}user${CP(0x2069)};`);
  assert.ok(kinds.includes('bidi-control'));
});

test('invisible-unicode: flags zero-width chars hidden in an identifier', () => {
  // Zero-width space splits a token so two identifiers look identical.
  const kinds = invisibleUnicodeKinds(`const ad${CP(0x200b)}min = grantAccess();`);
  assert.ok(kinds.includes('invisible-unicode'));
});

test('invisible-unicode: flags a word joiner (U+2060)', () => {
  assert.ok(invisibleUnicodeKinds(`let a${CP(0x2060)}b = 1;`).includes('invisible-unicode'));
});

test('invisible-unicode: flags a variation selector on a non-emoji base (GlassWorm)', () => {
  // GlassWorm encodes payload bytes into invisible variation selectors attached
  // to ordinary characters.
  const kinds = invisibleUnicodeKinds(`const x${CP(0xfe0f)} = loadPlugin();`);
  assert.ok(kinds.includes('invisible-unicode'));
});

test('invisible-unicode: flags a chained run of variation selectors', () => {
  const kinds = invisibleUnicodeKinds(`const q = "A${CP(0xfe00, 0xfe01, 0xfe02)}";`);
  assert.ok(kinds.includes('invisible-unicode'));
});

test('invisible-unicode: flags a non-leading BOM / zero-width no-break space', () => {
  const kinds = invisibleUnicodeKinds(`const a = 1;${CP(0xfeff)}const b = 2;`);
  assert.ok(kinds.includes('invisible-unicode'));
});

test('invisible-unicode: flags a bare zero-width joiner in an identifier', () => {
  assert.ok(invisibleUnicodeKinds(`let x${CP(0x200d)}y = 1;`).includes('invisible-unicode'));
});

test('invisible-unicode: flags confusable whitespace (NBSP) outside a string', () => {
  const kinds = invisibleUnicodeKinds(`const${CP(0x00a0)}y = compute();`);
  assert.ok(kinds.includes('confusable-whitespace'));
});

test('invisible-unicode: flags ideographic space (U+3000) outside a string', () => {
  assert.ok(invisibleUnicodeKinds(`if (a)${CP(0x3000)}return;`).includes('confusable-whitespace'));
});

// ---- Canary: known-legitimate patterns that must NOT be flagged ----

test('invisible-unicode canary: emoji ZWJ family sequence in a string is not flagged', () => {
  // man+ZWJ+woman: the ZWJ is a legitimate emoji joiner.
  const kinds = invisibleUnicodeKinds(`const label = "${CP(0x1f468, 0x200d, 0x1f469)}";`);
  assert.deepEqual(kinds, []);
});

test('invisible-unicode canary: emoji with VS16 (heart) in a string is not flagged', () => {
  const kinds = invisibleUnicodeKinds(`const heart = "${CP(0x2764, 0xfe0f)}";`);
  assert.deepEqual(kinds, []);
});

test('invisible-unicode canary: keycap sequence is not flagged', () => {
  const kinds = invisibleUnicodeKinds(`const one = "${CP(0x31, 0xfe0f, 0x20e3)}";`);
  assert.deepEqual(kinds, []);
});

test('invisible-unicode canary: NBSP inside a string literal (i18n) is not flagged', () => {
  const kinds = invisibleUnicodeKinds(`const s = "caf${CP(0x00a0)}e au lait";`);
  assert.deepEqual(kinds, []);
});

test('invisible-unicode canary: a leading BOM only is not flagged', () => {
  const kinds = invisibleUnicodeKinds(`${CP(0xfeff)}import fs from 'node:fs';`);
  assert.deepEqual(kinds, []);
});

test('invisible-unicode canary: plain ASCII code is not flagged', () => {
  assert.deepEqual(invisibleUnicodeKinds('const total = a + b;'), []);
});

test('invisible-unicode canary: documentation files (.md) are out of scope', () => {
  // Docs legitimately use zero-width joiners / emoji; a zero-width char here
  // must not fire (issue #1631 restricts scope to source code).
  const kinds = invisibleUnicodeKinds(`text with a ${CP(0x200b)} zero width`, 'docs/guide.md');
  assert.deepEqual(kinds, []);
});

test('invisible-unicode canary: quiet when the skill is not selected', () => {
  const diffText =
    'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n' +
    `@@ -1,1 +1,2 @@\n const a = 1;\n+const ad${CP(0x200b)}min = 1;\n`;
  const parsed = parseUnifiedDiff(diffText);
  const plan = { selected: [{ metadata: { id: 'typescript-strict' } }] };
  const comments = buildHeuristicComments({ diff: { files: parsed.files }, plan });
  assert.deepEqual(comments, []);
});
