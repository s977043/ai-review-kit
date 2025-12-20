---
id: rr-downstream-test-review-sample-001
name: 'Sample Test Coverage Review'
description: 'Evaluates downstream tests for coverage and edge cases.'
phase: downstream
applyTo:
  - 'tests/**/*.ts'
  - 'tests/**/*.js'
  - 'tests/**/*.py'
tags:
  - sample
  - tests
  - coverage
  - downstream
severity: 'major'
inputContext:
  - diff
  - tests
outputKind:
  - tests
  - findings
  - summary
  - actions
modelHint: balanced
dependencies:
  - test_runner
  - coverage_report
---

## Goal / 目的

- テスト差分から、カバレッジ不足・失敗系の抜け・フレークのリスクを “薄く” 拾うサンプルです。

## Non-goals / 扱わないこと

- 変更と無関係な一般論（「テストを増やすべき」だけ）を言わない。
- 既存のテスト設計方針を断定して押し付けない。

## False-positive guards / 黙る条件

- 変更がテストの整形/リネームのみで意味が変わらない場合は深入りしない。

## Rule / ルール

- 正常系だけでなく、境界・異常系（入力不正、権限、例外、タイムアウト）を優先する。
- フレーク要因（時刻、乱数、外部依存、並列実行）を見つけたら指摘する。
- 指摘は差分に紐づけ、最小の追加テスト案を 1 つ添える。

## Output / 出力

- `<file>:<line>: <message>` 形式で 1 行ずつ（日本語、短く）。

## 評価指標（Evaluation）

- 合格基準: 指摘が差分に紐づき、根拠と次アクションが説明されている。
- 不合格基準: 差分と無関係な指摘、根拠のない断定、抑制条件の無視。

## 人間に返す条件（Human Handoff）

- 仕様や意図が不明確で解釈が分かれる場合は質問として返す。
- 影響範囲が広い設計判断やトレードオフは人間レビューへ返す。
