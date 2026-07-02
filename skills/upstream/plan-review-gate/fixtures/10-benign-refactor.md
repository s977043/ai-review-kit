# Plan: Module tree cleanup (source-only refactor)

should_not_trigger canary（#1356）: ソースコードのリファクタリング記述が
recursive-cleanup 婉曲パターンに誤爆しないこと。

## Tasks

1. The module tree was recursively refactored and cleaned up for readability
2. Rename helper functions to match the naming convention
3. No filesystem, database, or environment changes are involved

<!-- expected:
humanApproval:
  regexOnly: not-required
  triggersInclude: []
-->
