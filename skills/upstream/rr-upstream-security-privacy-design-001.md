---
id: rr-upstream-security-privacy-design-001
name: 'Security & Privacy Design Review'
description: 'Ensure designs clarify data sensitivity, threat model assumptions, access control, and privacy/compliance requirements.'
phase: upstream
applyTo:
  - 'docs/**/*'
  - 'pages/**/*'
  - '**/*security*.md'
  - '**/*privacy*.md'
  - '**/*threat*.md'
  - '**/*pii*.md'
  - '**/*gdpr*.md'
  - '**/*compliance*.md'
tags: [security, privacy, design, upstream]
severity: critical
inputContext: [diff, adr]
outputKind: [summary, findings, actions, questions]
modelHint: high-accuracy
dependencies: [repo_metadata]
---

## Goal / 目的

- 設計/要件の差分から、セキュリティ・プライバシー事故につながる “前提の抜け” を早期に発見し、文書に追記できる形で返す。

## Non-goals / 扱わないこと

- 脆弱性診断や侵入テストの代替（設計上の要求・前提・契約のレビューに限定）。
- プロダクト固有の法務判断の断定（不明なら質問として返す）。

## False-positive guards / 抑制条件

- 変更が表記ゆれ/リンク/誤字修正のみで、セキュリティ要件の実質が変わらない場合は指摘しない（`NO_ISSUES`）。
- 既に参照先ドキュメント（セキュリティ要件/データ分類）に明記され、差分が参照更新のみの場合は重複指摘しない。

## Rule / ルール

- 先頭に要約を 1 行出す（データ/権限/脅威の変更点）。
- 指摘は最大 8 件まで。`[severity=critical]` は “事故に直結しうる未定義” に限定する。
- “追記してほしい項目 + 例文” を優先し、質問だけで終わらせない。

## Checklist / 観点チェックリスト

- データと分類
  - 取り扱うデータ種別（PII/機微情報/認証情報）と保存期間が明示されているか。
  - 暗号化（保存時/転送時）と鍵管理の前提があるか。
- アクセス制御と権限
  - 認証/認可の方式、権限境界、管理者操作の監査があるか。
  - マルチテナントならテナント分離の前提があるか。
- 脅威モデル（軽量でも可）
  - 想定攻撃（不正アクセス、権限昇格、なりすまし、リプレイ、データ漏えい）と対策の方向性があるか。
  - 依存サービス/第三者連携がある場合の責任境界があるか。
- プライバシー/コンプライアンス
  - 同意/目的外利用/データ削除（退会・忘れられる権利）などの要件があるか。
  - ログ/トレースに個人情報を載せない方針があるか（マスキング/サンプリング含む）。

## Output / 出力フォーマット

すべて日本語。`<file>:<line>: <message>` 形式で出力する。

- 先頭に要約を 1 行: `(summary):1: <データ/権限/脅威の変更点と未決>`
- 以降は指摘（最大 8 件）:
  - `<message>` に `[severity=critical|major|minor|info]` を含める。
  - 可能なら “追記案” を 1 行付ける。

例:

- `(summary):1: 新規に PII を扱う設計だが、データ分類と保存期間、削除要件が未記載。`
- `docs/design.md:88: [severity=critical] 認可境界（誰が何をできるか）が曖昧。追記案: 役割=Admin/User, 操作=閲覧/更新/削除 のマトリクスを追加。`

## 評価指標（Evaluation）

- 合格基準: 差分に紐づくリスクを優先度付きで指摘し、文書に貼れる追記案がある。
- 不合格基準: 根拠のない断定、過度な一般論、指摘の洪水。

## 人間に返す条件（Human Handoff）

- 法務/契約/規制解釈が必要な場合は人間（セキュリティ/法務）レビューへ返す。
