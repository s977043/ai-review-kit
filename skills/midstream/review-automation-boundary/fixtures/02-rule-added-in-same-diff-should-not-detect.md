# Fixture 02 — The lint rule is being added in the same diff (False-Positive Guard)

## Description

The Pre-execution Gate is satisfied: the diff contains a source change under
`src/` and is not a tool-configuration-only change. The residual `console.log`
is therefore visible to the skill. But the same diff adds
`no-console: error` to `.eslintrc.json`, which is exactly the False-positive
guard "差分内に該当ツールの設定ファイル変更が含まれている場合、そのルールは
追加中と判断し指摘しない". Proposing the rule again would duplicate a change
already in flight, which the Non-goals section also excludes
（既に CI に設定が存在するルールへの重複指摘）.

## Input Diff

```diff
diff --git a/.eslintrc.json b/.eslintrc.json
--- a/.eslintrc.json
+++ b/.eslintrc.json
@@ -3,6 +3,7 @@
   "extends": ["eslint:recommended"],
   "rules": {
+    "no-console": "error",
     "eqeqeq": "error"
   }
 }
diff --git a/src/checkout/apply-coupon.ts b/src/checkout/apply-coupon.ts
--- a/src/checkout/apply-coupon.ts
+++ b/src/checkout/apply-coupon.ts
@@ -3,7 +3,7 @@
 export async function applyCoupon(cartId: string, code: string) {
   const coupon = await findCoupon(code);
-  console.log('applyCoupon', cartId, code, coupon);
+  logger.debug({ cartId, code }, 'applyCoupon');
   if (!coupon) {
     return { ok: false as const, reason: 'not_found' as const };
   }
```

## Expected Behavior

- `findings: []`.
- The gate does hold (a real source change is present), so the suppression must
  come from the False-positive guard, not from the gate.
- The `automation_debt` metric is `0` for this diff, matching the Metrics
  section's goal state (チームが CI/lint を整備した結果、指摘が 0 件になる).

<!-- expected:
findings: []
reason: Pre-execution Gate は成立するが、同じ差分で .eslintrc.json に no-console ルールが追加されており、False-positive guard「該当ツールの設定ファイル変更が差分内にある場合は指摘しない」に該当する
-->
