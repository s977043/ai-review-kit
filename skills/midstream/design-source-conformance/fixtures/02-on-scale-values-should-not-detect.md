# Fixture 02 — New UI values stay on the defined scale (False-Positive Guard)

## Description

Both Pre-execution Gate conditions hold: a design definition exists
(`tailwind.config.js` theme, findable by `code_search`) and the diff changes UI
values (色・余白) under `src/**`. The gate therefore passes and the skill runs.
Every new value is a member of the defined scale (`spacing.3 = 12px`,
`brand.primary = #2563eb`), so the False-positive guard "定義済みスケールに
含まれる値は指摘しない" suppresses the finding.

## Input Diff

```diff
diff --git a/src/components/PromoBanner.tsx b/src/components/PromoBanner.tsx
--- a/src/components/PromoBanner.tsx
+++ b/src/components/PromoBanner.tsx
@@ -1,10 +1,10 @@
 export function PromoBanner({ label }: { label: string }) {
   return (
     <div
       style={{
-        padding: '8px',
-        backgroundColor: '#2563eb',
+        padding: '12px',
+        backgroundColor: 'var(--brand-primary)',
       }}
     >
       {label}
     </div>
   );
 }
```

Design definition already in the repository (unchanged, found by `code_search`):

```js
// tailwind.config.js:8
theme: {
  spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px' },
  colors: { brand: { primary: '#2563eb' } },
}
```

## Expected Behavior

- `findings: []`.
- `12px` is `spacing.3` and `var(--brand-primary)` resolves to the defined
  `brand.primary`, so neither value is off-scale.
- Switching a literal hex to the token variable is a conformance improvement and
  must not be reported as a change worth reviewing.
- No 生値ハードコード指摘 either — that belongs to `design-token-enforcement`
  per the Non-goals section.

<!-- expected:
findings: []
reason: Pre-execution Gate は成立するが、新規値がいずれも定義済みスケール（spacing.3 = 12px / brand.primary）に含まれるため False-positive guard「定義済みスケールに含まれる値は指摘しない」に該当する
-->
