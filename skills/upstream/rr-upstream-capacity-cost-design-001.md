---
id: rr-upstream-capacity-cost-design-001
name: 'Capacity, Performance & Cost Assumptions'
description: 'Ensure architecture/design docs state traffic assumptions, performance budgets, resource limits, and cost risks for critical paths.'
phase: upstream
applyTo:
  - 'docs/**/*performance*.md'
  - 'docs/**/*capacity*.md'
  - 'docs/**/*scal*.md'
  - 'docs/**/*cost*.md'
  - 'docs/**/*design*.md'
  - 'pages/**/*performance*.md'
  - 'pages/**/*capacity*.md'
  - 'pages/**/*scal*.md'
  - 'pages/**/*cost*.md'
tags: [architecture, performance, capacity, cost, upstream]
severity: major
inputContext: [diff, adr]
outputKind: [summary, findings, actions, questions]
modelHint: balanced
dependencies: [repo_metadata]
---

## Goal / 目的

- 設計の差分から、性能/容量/コストの前提不足により “本番で初めて詰む” リスクを減らす。

## Non-goals / 扱わないこと

- 具体的なインフラ構成やクラウドサービスの最適解を断定しない。
- 実装レベルのチューニング（クエリ改善やキャッシュ実装など）。

## False-positive guards / 抑制条件

- 変更が誤字/文言整理のみで、前提や要件が変わらない場合は指摘しない（`NO_ISSUES`）。
- PoC/運用対象外と明記されている場合は、必須要件としては扱わず “確認” に留める。

## Rule / ルール

- 先頭に要約を 1 行出す（クリティカルパスと前提の変更点）。
- 指摘は最大 8 件まで。性能予算/上限制約/コスト爆発のリスクを優先。
- “追記テンプレ” を付けて、文書に落とせる形にする。

## Checklist / 観点チェックリスト

- トラフィック前提
  - 想定 QPS/ピーク、データ量、同時接続などの前提があるか。
  - 増加率（成長）と期間の前提があるか。
- 性能予算（Budget）
  - 重要フローのレイテンシ目標（p95/p99）と内訳があるか。
  - タイムアウト/リトライで “増幅” しない前提になっているか。
- ボトルネックと限界
  - 依存（外部 API/DB/キュー）の上限と、劣化時のふるまいがあるか。
  - Backpressure（キュー溢れ、レート制限）と、落としどころがあるか。
- コスト
  - コストドライバー（データ転送、ストレージ、ログ、外部 API 課金）が列挙されているか。
  - コスト上限/監視/アラートの前提があるか。

## Output / 出力フォーマット

すべて日本語。`<file>:<line>: <message>` 形式で出力する。

- 先頭に要約を 1 行: `(summary):1: <重要フローと前提/予算の要点>`
- 以降は指摘（最大 8 件）:
  - `<message>` に `[severity=critical|major|minor|info]` を含める。
  - 可能なら “追記テンプレ” を 1 行付ける。

追記テンプレ例:

- `前提: peakQPS=<>, payload=<>, dataGrowth=<>, 期間=<>`
- `性能: p95=<ms>, p99=<ms>, timeout=<ms>, retry=<回数>`
- `コスト: ドライバー=<>, 上限=<>, 監視=<メトリクス>`

## 評価指標（Evaluation）

- 合格基準: 差分に紐づく前提/予算/上限の抜けが優先度付きで指摘され、追記案がある。
- 不合格基準: 推測の断定、差分と無関係な一般論、指摘過多。

## 人間に返す条件（Human Handoff）

- コスト上限や性能目標がビジネス判断に跨る場合は人間（PM/Tech Lead）へ返す。
