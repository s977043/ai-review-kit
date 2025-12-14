---
id: rr-downstream-test-existence-001
name: Test Presence for Changed Code
description: Check whether changed code paths have corresponding tests and suggest minimal coverage.
phase: downstream
applyTo:
  - 'src/**/*'
  - 'lib/**/*'
  - '**/*.test.*'
  - '**/*.spec.*'
tags: [tests, coverage, downstream]
severity: major
inputContext: [diff]
outputKind: [tests, findings, actions]
modelHint: balanced
dependencies: [test_runner, coverage_report]
---

## Goal / 目的

- 差分で挙動が増えたのにテストが追従していないケースを拾い、最小のテスト観点を提案する。

## Non-goals / 扱わないこと

- テストフレームワークの宗教論争（Jest/Vitest など）。
- 網羅的なテストケース列挙（提案は最大3点までに絞る）。
- テスト差分がすでにある場合の追加要求（原則として黙る）。

## False-positive guards / 黙る条件

- 差分にテストファイル（`*.test.*` / `*.spec.*`）が含まれている場合。
- 挙動変更のシグナル（新しい分岐、例外、バリデーション）が差分から読み取れない場合。

## Rule / ルール

- 変更されたコード（関数/メソッド/エンドポイント）に対して対応するテストが存在するか確認する。
- クリティカルパス（認証、課金、データ保存など）にテストが無い場合は優先して補う。
- テストファイルが存在しない/未更新なら、最小の正常系・異常系を提案する。

## Heuristics / 判定の手がかり

- 変更ファイルに対する `*.test.*` / `*.spec.*` が無い、または差分がゼロ。
- 変更された公開 API/handler に対応するリクエスト/レスポンス検証が無い。
- 例外パス（throw/reject/return error）が追加されたのに失敗系テストが無い。

## Good / Bad Examples

- Good: 新規ハンドラに対して 200/4xx/5xx を分けたテストを追加。
- Bad: 大きなリファクタに対してテスト差分がゼロ。
- Good: coverage_report を確認し、変更ファイルのブランチカバレッジを補強。

## Actions / 改善案

- 変更された関数/エンドポイントごとに「正常系 + 代表的な異常系（認可/バリデーション/例外）」のテストを追加する。
- 例外/エラー戻りのメッセージやステータスを検証する。
- `coverage_report` を参照し、変更ファイルのステートメント/ブランチカバレッジが上がる具体的なテストケースを提案する。

## Output / 出力

- `Finding:` / `Evidence:` / `Impact:` / `Fix:` / `Severity:` / `Confidence:` を含む短いメッセージにする。
- `Fix` は 1〜3 件のテスト観点に絞る（例: 新分岐、例外、境界）。
