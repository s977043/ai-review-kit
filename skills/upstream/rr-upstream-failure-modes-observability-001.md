---
id: rr-upstream-failure-modes-observability-001
name: Failure Modes & Observability in Design
description: Ensure designs specify failure modes, timeouts, error contracts, and observability for critical flows.
phase: upstream
applyTo:
  - '**/api/**'
  - '**/routes/**'
  - 'docs/**/*'
  - 'pages/**/*'
tags: [reliability, observability, api, design, upstream]
severity: major
inputContext: [diff, adr]
outputKind: [findings, actions, questions, summary]
modelHint: balanced
dependencies: [repo_metadata, tracing]
---

## Rule / ルール

- クリティカルフロー（認証、課金、データ保存など）の**失敗モード**（タイムアウト、リトライ、フォールバック、外部障害、権限不備）を明示する。
- エラー応答（ステータス、エラーコード、message/detail）の**契約**を一貫させ、クライアントが判断できる形にする。
- SLO/監視、ログ、メトリクス、トレースなどの**観測性**を設計に含める。

## Heuristics / 判定の手がかり

- 外部依存（DB/HTTP/Queue）の失敗時に「何が起きるか」が仕様に無い（例: リトライ方針、タイムアウト、冪等性）。
- 4xx/5xx の使い分け、エラー構造がエンドポイントごとに不揃い。
- Rate limit / backoff / circuit breaker の前提があるのに、設計/ADR で触れられていない。
- 障害時の切り分けに必要なログ（相関ID、requestId、重要な属性）やメトリクスの設計が無い。

## Questions / 確認質問（不明な場合は質問として出す）

- 代表的な失敗モード（タイムアウト、外部 5xx、バリデーション、権限、競合）はどれですか？
- 冪等性キーやリトライ可否の判断はどこで担保しますか？
- 監視対象（SLO、エラーバジェット、アラート条件）はありますか？

## Actions / 改善案

- タイムアウト値、リトライ回数、バックオフ、フォールバックを ADR/設計に追記する。
- エラー応答の共通スキーマ（code/message/detail/requestId など）を定義し、例を載せる。
- クリティカルフローに相関IDを付与し、ログ/トレースのキーを設計に含める。
