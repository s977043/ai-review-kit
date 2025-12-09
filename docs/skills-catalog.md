# Skills Catalog

River Reviewer に同梱されているスキル一覧です。フェーズ別に分類しています。

## upstream

### rr-upstream-architecture-sample-001
- 名前: Sample Architecture Consistency Review
- 概要: Checks design/ADR docs for consistency and missing decisions.
- 対象: docs/architecture/**/*.md, docs/adr/**/*.md
- 重要度: minor
- タグ: design, architecture, upstream
- 依存関係: none
- 適用条件: phase=upstream, inputContext=none

チェック項目の例:
- findings

### rr-upstream-review-policy-standard-001
- 名前: Standard Review Policy for Upstream
- 概要: Applies standard AI review policy guidelines for upstream (design) phase reviews.
- 対象: **/*.md, **/*.adr, **/docs/**/*, **/design/**/*
- 重要度: info
- タグ: policy, upstream, design, architecture
- 依存関係: none
- 適用条件: phase=upstream, inputContext=diff

チェック項目の例:
- findings, summary


## midstream

### rr-midstream-code-quality-sample-001
- 名前: Sample Code Quality Pass
- 概要: Checks common code quality and maintainability risks.
- 対象: src/**/*.ts, src/**/*.js, src/**/*.py
- 重要度: minor
- タグ: style, maintainability, midstream
- 依存関係: code_search
- 適用条件: phase=midstream, inputContext=diff

チェック項目の例:
- findings, actions

### rr-midstream-review-policy-standard-001
- 名前: Standard Review Policy for Midstream
- 概要: Applies standard AI review policy guidelines for midstream (implementation) phase reviews.
- 対象: src/**/*.ts, src/**/*.js, src/**/*.py, src/**/*.go, src/**/*.java, src/**/*.rb, lib/**/*, app/**/*
- 重要度: info
- タグ: policy, midstream, implementation, code-quality
- 依存関係: code_search
- 適用条件: phase=midstream, inputContext=diff, fullFile

チェック項目の例:
- findings, summary, actions


## downstream

### rr-downstream-review-policy-standard-001
- 名前: Standard Review Policy for Downstream
- 概要: Applies standard AI review policy guidelines for downstream (test/QA) phase reviews.
- 対象: test/**/*, tests/**/*, **/*.test.ts, **/*.test.js, **/*.test.py, **/*.spec.ts, **/*.spec.js, **/__tests__/**/*
- 重要度: info
- タグ: policy, downstream, testing, qa
- 依存関係: test_runner, coverage_report
- 適用条件: phase=downstream, inputContext=diff, tests

チェック項目の例:
- findings, summary, tests

### rr-downstream-test-review-sample-001
- 名前: Sample Test Coverage Review
- 概要: Evaluates downstream tests for coverage and edge cases.
- 対象: tests/**/*.ts, tests/**/*.js, tests/**/*.py
- 重要度: major
- タグ: tests, coverage, downstream
- 依存関係: none
- 適用条件: phase=downstream, inputContext=none

チェック項目の例:
- findings

