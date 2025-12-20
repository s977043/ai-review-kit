---
id: rr-downstream-review-policy-standard-001
name: 'Standard Review Policy for Downstream'
description: 'Applies standard AI review policy guidelines for downstream (test/QA) phase reviews.'
phase: downstream
applyTo:
  - 'test/**/*'
  - 'tests/**/*'
  - '**/*.test.ts'
  - '**/*.test.js'
  - '**/*.test.py'
  - '**/*.spec.ts'
  - '**/*.spec.js'
  - '**/__tests__/**/*'
inputContext:
  - diff
  - tests
outputKind:
  - findings
  - summary
  - tests
modelHint: balanced
dependencies:
  - test_runner
  - coverage_report
tags:
  - policy
  - downstream
  - testing
  - qa
severity: 'info'
---

## Goal / 目的

- テスト/QA フェーズの差分に対して、テスト不足・失敗系の抜け・フレークのリスクを短く指摘する。

## Non-goals / 扱わないこと

- 変更と無関係な “テストを増やすべき” の一般論を言わない。
- プロジェクトのテスト方針（E2E/Unit 比率など）を断定して押し付けない。

## False-positive guards / 黙る条件

- 変更がテストの整形/リネームのみで、意味的な変更がない場合は深入りしない。
- テスト観点が不確実な場合は、欠陥ではなく質問として提示する。

## Rule / ルール

- 指摘は差分に紐づける（根拠は `<file>:<line>`）。
- 優先する観点は「失敗系」「境界」「クリティカルパス」（例: 認証、課金、データ整合性、権限）。
- 可能なら最小の追加テスト案を 1 つ添える（大改造ではなく追加 1 ケース）。

## Evidence / 根拠

- 追加/変更された分岐や例外パスに対して、対応するテスト差分がない点を根拠として示す。

## Output / 出力

- 各指摘を 1 行で出力する: `<file>:<line>: <message>`
- `<message>` は日本語で簡潔に（目安: 200 文字以内）。
- PR の本文（説明）と PR コメント（レビューコメント）は日本語で書く。
- 最大 8 件。指摘がなければ `NO_ISSUES` のみ。

## Heuristics / 判定の手がかり（例）

- 新規/変更された分岐に対するテストが増えていない
- 例外/エラー戻りのアサーションがない（メッセージ、ステータス、code など）
- 時刻/乱数/外部依存でフレークしやすい構造になっている（固定化/モック不足）
- セットアップが重複し、テスト意図が読み取りにくい

## 評価指標（Evaluation）

- 合格基準: 指摘が差分に紐づき、根拠と次アクションが説明されている。
- 不合格基準: 差分と無関係な指摘、根拠のない断定、抑制条件の無視。

## 人間に返す条件（Human Handoff）

- 仕様や意図が不明確で解釈が分かれる場合は質問として返す。
- 影響範囲が広い設計判断やトレードオフは人間レビューへ返す。
