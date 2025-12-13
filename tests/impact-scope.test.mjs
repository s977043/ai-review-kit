import assert from 'node:assert/strict';
import test from 'node:test';
import { inferImpactTags } from '../src/lib/impact-scope.mjs';

test('inferImpactTags detects typescript, api, and security signals', () => {
  const tags = inferImpactTags(['src/api/user.ts', 'src/auth/session.ts', 'src/config/env.ts']);
  assert.ok(tags.includes('typescript'));
  assert.ok(tags.includes('api'));
  assert.ok(tags.includes('security'));
});

test('inferImpactTags detects tests', () => {
  const tags = inferImpactTags(['tests/user.test.ts', 'src/app.ts']);
  assert.ok(tags.includes('tests'));
  assert.ok(tags.includes('typescript'));
});

test('inferImpactTags detects observability and reliability', () => {
  const tags = inferImpactTags(['src/logger.ts', 'src/tracing/otel.ts']);
  assert.ok(tags.includes('observability'));
  assert.ok(tags.includes('reliability'));
});

test('inferImpactTags detects observability from diff text with silent return', () => {
  const diffText = `
diff --git a/src/services/payments.ts b/src/services/payments.ts
index 1111111..2222222 100644
--- a/src/services/payments.ts
+++ b/src/services/payments.ts
@@ -1,10 +1,16 @@
 export async function charge(cardToken, amount) {
   try {
     await gateway.charge(cardToken, amount);
   } catch (err) {
+    return; // silent return
   }
 }
`;
  const tags = inferImpactTags(['src/services/payments.ts'], { diffText });
  assert.ok(tags.includes('observability'));
  assert.ok(tags.includes('reliability'));
});
