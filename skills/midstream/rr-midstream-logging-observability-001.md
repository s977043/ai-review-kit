---
id: rr-midstream-logging-observability-001
name: Logging and Observability Guard
description: Ensure code changes keep logs/metrics/traces useful for debugging failures and regressions.
phase: midstream
applyTo:
  - 'src/**/*'
  - 'lib/**/*'
  - '**/*.js'
  - '**/*.mjs'
  - '**/*.ts'
  - '**/*.tsx'
tags: [observability, logging, reliability, midstream]
severity: minor
inputContext: [diff]
outputKind: [findings, actions]
modelHint: balanced
dependencies: [tracing, code_search]
---

## Goal / 目的

- 障害時に原因が追えるよう、差分で観測性が失われないことを担保する（特に例外の握りつぶしを防ぐ）。

## Non-goals / 扱わないこと

- ログ基盤の選定や、メトリクス設計の是非などの設計批評。
- PII を含むログの推奨（入力の要約は最小化し、秘匿情報は含めない）。

## False-positive guards / 黙る条件

- `catch` 内でログがある、または `throw` / `return Promise.reject(...)` 等で上位へ伝播している場合。
- 明確に意図された無視であることが差分から読み取れる場合（ただし、理由のコメントがある場合に限る）。

## Rule / ルール

- 失敗時に原因が追えるログ/メトリクス/トレースが残ること（過不足なく、PII を含めない）。
- 例外を握りつぶさず、エラー文脈（requestId、入力の要約、外部依存の種別）を付与する。
- 重要な分岐（フォールバック、リトライ、キャッシュヒット/ミス）を観測できること。

## Heuristics / 判定の手がかり

- `catch` でエラーを握りつぶしている、またはログが無い（silent failure）。
- ログが「固定文言のみ」で、どのリクエスト/入力が原因か追えない。
- 失敗時にスタックトレースやエラーコードが残らず、再現が困難。
- 新しいリトライ/フォールバック/キャッシュが入ったのに、観測ポイントが無い。

## Actions / 改善案

- 失敗ログに `requestId`（相関ID）と、入力の最小要約（サイズ/件数/キー）を追加する。
- 例外は `cause` を保持し、上位へ伝播するか、適切にラップして意味を残す。
- 重大な分岐にメトリクス（成功/失敗/リトライ回数）や span 属性を追加する。

## Output / 出力

- `Finding:` / `Evidence:` / `Impact:` / `Fix:` / `Severity:` / `Confidence:` を含む短いメッセージにする。
- `Fix` は複数案を許容する（例: ログ+再throw、上位へ伝播、無視するなら理由コメント+計測）。
