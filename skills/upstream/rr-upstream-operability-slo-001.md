---
id: rr-upstream-operability-slo-001
name: 'Operability, SLO & Runbook Readiness'
description: 'Ensure designs define operability basics: SLO/SLI, monitoring, alerting, on-call actions, and incident handling expectations.'
phase: upstream
applyTo:
  - 'docs/**/*'
  - 'pages/**/*'
  - '**/*slo*.md'
  - '**/*sli*.md'
  - '**/*runbook*.md'
  - '**/*operat*.md'
  - '**/*monitor*.md'
  - '**/*alert*.md'
tags: [reliability, sre, operability, upstream]
severity: major
inputContext: [diff, adr]
outputKind: [summary, findings, actions, questions]
modelHint: balanced
dependencies: [repo_metadata]
---

## Goal / 目的

- 設計/要件の差分から、運用不能・障害対応不能になりやすい “観測/手順の抜け” を早期に潰す。

## Non-goals / 扱わないこと

- 監視基盤やツールの選定そのもの（ただし前提が必要なら追記を促す）。
- 全アラート設計の作り込み（設計として必要な最小セットに絞る）。

## False-positive guards / 抑制条件

- 変更がドキュメントの誤字修正のみで、運用対象の仕様が変わらない場合は指摘しない（`NO_ISSUES`）。
- 運用対象外（PoC/ローカルのみ）と明記されている場合は、SLO などの要求を過剰に強制しない。

## Rule / ルール

- 先頭に要約を 1 行出す（運用対象/期待値/観測の変更点）。
- 指摘は最大 8 件まで。障害時に困るもの（切り分け不能/復旧不能）を優先。
- “追記テンプレ” を添えて、ドキュメントに落とせる形にする。

## Checklist / 観点チェックリスト

- SLO/SLI
  - 重要フローの SLI（成功率、レイテンシ等）と SLO（目標値）があるか。
  - 計測の定義（分母/分子、除外条件、期間）が曖昧でないか。
- 監視/アラート
  - リリース直後に見るべきメトリクス/ログ/ダッシュボードがあるか。
  - アラート条件（閾値、継続時間、抑制条件）と当番の初動があるか。
- 切り分け
  - 相関ID、主要属性（tenantId/userId 等）のログ方針があるか（PII には注意）。
  - 外部依存（DB/Queue/外部API）の障害時に、どこまでが責任範囲か明記されているか。
- 障害対応/ロールバック
  - 失敗時の判断（ロールバック/停止/縮退）の基準があるか。
  - Runbook の最小要素（症状、確認手順、復旧手順、エスカレーション先）があるか。

## Output / 出力フォーマット

すべて日本語。`<file>:<line>: <message>` 形式で出力する。

- 先頭に要約を 1 行: `(summary):1: <運用対象/期待値/観測の変更点と未決>`
- 以降は指摘（最大 8 件）:
  - `<message>` に `[severity=critical|major|minor|info]` を含める。
  - 可能なら “追記テンプレ” を 1 行付ける。

追記テンプレ例:

- `SLO: <対象フロー> / SLI=<指標定義> / 目標=<例: 99.9%/30d> / 計測=<どこで測る>`
- `Runbook: 症状=<何が起きる>, 確認=<見るべきダッシュボード/ログ>, 復旧=<操作>, エスカレーション=<連絡先>`

## 評価指標（Evaluation）

- 合格基準: 差分に紐づく運用上の抜けが、優先度付きで短く指摘され、追記案がある。
- 不合格基準: ツール選定の押し付け、差分と無関係な一般論、指摘過多。

## 人間に返す条件（Human Handoff）

- 目標値（SLO）や当番体制が組織判断を伴う場合は人間（SRE/運用責任者）へ返す。
