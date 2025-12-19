---
id: rr-downstream-coverage-gap-001
name: Coverage and Failure Path Gaps
description: Find missing tests for critical paths, edge cases, and failure handling in changed code.
phase: downstream
applyTo:
  - 'src/**/*'
  - 'lib/**/*'
  - '**/*.test.*'
  - '**/*.spec.*'
tags: [tests, coverage, reliability, downstream]
severity: major
inputContext: [diff]
outputKind: [tests, findings, actions, summary]
modelHint: balanced
dependencies: [test_runner, coverage_report]
---

## Rule / ルール

- 主要フローと失敗フローの両方にテストがあることを確認する。
- 例外系・タイムアウト・リトライなどのエラーハンドリングをテストする。
- 変更によって追加/変更された分岐・境界値・フォールバックをカバーする。

## Heuristics / 判定の手がかり

- 新しい条件分岐・ガードが追加されたのに対応するテストがない。
- 例外処理やエラーリターンに対するアサーションが見当たらない。
- 大きな refactor でテストの網羅対象が変わっているのに、テスト差分が少ない。
- クリティカルパス（認証/課金/データ保存など）にテストが不足。
- `coverage_report` でステートメント/ブランチ/ラインの低下が確認できるのに差分テストが増えていない。

## Good / Bad Examples

- Good: 成功・失敗・境界を分けた `describe` / `it` を追加し、エラーメッセージも検証。
- Bad: `happy path` のみのテストで、例外時や空入力時の検証がない。
- Good: `coverage_report` を確認し、差分ファイルのステートメント/ブランチカバレッジを改善。

## Actions / 改善案

- 新規/変更分岐ごとに正常系・異常系テストを追加する（例外メッセージも含めて検証）。
- タイムアウト/リトライ/フォールバックをモックし、意図した失敗動作を確認する。
- クリティカルパスのカバレッジを `coverage_report` ベースで確認し、不足を埋めるテストを提案する。
- 差分ファイルの各分岐・ガードに対して「期待される成功/失敗シナリオ + 入力例」を列挙し、テストケースとして提示する。

## Non-goals / 扱わないこと

- 既存テストの全面的な書き換えやリファクタリング。
- 実行環境や外部サービスの障害注入（カオス試験）の設計。
- プロダクション監視の網羅性評価。

## False-positive guards / 黙る条件

- 変更がコメントやドキュメントのみで、実行経路に影響しない。
- 既存テストが同等の失敗経路を十分にカバーしている。
- テスト対象が外部 API の仕様変更のみで、社内コードに実行分岐が増えていない。
