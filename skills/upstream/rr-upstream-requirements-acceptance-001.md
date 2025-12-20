---
id: rr-upstream-requirements-acceptance-001
name: Requirements Clarity & Acceptance Criteria
description: Ensure requirement docs define scope, terminology, acceptance criteria, edge cases, and non-functional requirements.
phase: upstream
applyTo:
  - 'docs/**/*'
  - 'pages/**/*'
  - '**/*prd*.md'
  - '**/*requirements*.md'
  - '**/*user-story*.md'
  - '**/*spec*.md'
tags: [requirements, product, specification, upstream]
severity: major
inputContext: [diff]
outputKind: [summary, findings, actions, questions]
modelHint: balanced
dependencies: [repo_metadata]
---

## Goal / 目的

- 要件/仕様ドキュメントの差分から、実装ブレや炎上の原因になりやすい「曖昧さ・抜け」を早期に潰す。

## Non-goals / 扱わないこと

- UI/実装の最適解を断定しない（要件としての決定事項・受け入れ条件に絞る）。
- 仕様が未確定な点を欠陥と断定しない（未決なら “未決の明示” を促す）。

## False-positive guards / 抑制条件

- 変更が表記ゆれ/誤字/段落整理のみの場合は指摘しない（`NO_ISSUES`）。
- 差分外の既存仕様まで掘り返して問題視しない（今回の変更と直結する範囲に限定）。

## Rule / ルール

- まず「この文書で何を決めたか/何が未決か」を 1 行で要約する。
- 指摘は最大 8 件まで。優先度の高いもの（実装ブレ・運用事故・テスト不能）を先に出す。
- 可能な限り “質問” ではなく “追記してほしい項目 + 例文（貼れる形）” を出す。

## Checklist / 観点チェックリスト

- 用語とスコープ
  - 用語の定義（ユーザー/権限/対象データ/対象外）が明示されているか。
  - イン/アウトの境界（何をやらないか、既存仕様との違い）が明確か。
- 受け入れ条件
  - Given-When-Then などでテスト可能な受け入れ条件があるか。
  - 正常系だけでなく、代表的な例外系（権限なし/入力不備/データなし/タイムアウト/競合）があるか。
- 非機能
  - 期待性能（レイテンシ/スループット/上限）・可用性/SLO・コスト前提があるか。
  - 監査/ログ/データ保持/プライバシー（PII）などの要求があるか。
- 依存とリスク
  - 外部依存/前提条件（別チーム/既存API/データ整備）が明記されているか。
  - リスクと未決事項（決める期限/意思決定者/判断材料）が書かれているか。

## Output / 出力フォーマット

すべて日本語。`<file>:<line>: <message>` 形式で出力する。

- 先頭に要約を 1 行: `(summary):1: <この文書が決めたこと/未決の要点>`
- 以降は指摘（最大 8 件）:
  - `<message>` に `[severity=critical|major|minor|info]` を含める（原則: major 以上を優先）。
  - “追記案” を 1 行で付ける（貼れる短文）。

例:

- `(summary):1: 目的と対象ユーザーは明確だが、受け入れ条件と例外系が未定義。`
- `docs/prd.md:42: [severity=major] 受け入れ条件がテスト可能な形で不足。追記案: Given <前提>, When <操作>, Then <期待結果> を 3〜5 本追加。`

## 評価指標（Evaluation）

- 合格基準: 差分に紐づく曖昧さ/抜けを、優先度付きで短く指摘し、貼れる追記案が付いている。
- 不合格基準: 差分と無関係な一般論、根拠のない断定、指摘の洪水。

## 人間に返す条件（Human Handoff）

- ビジネス判断（優先順位/範囲/コスト）に踏み込む必要がある場合は人間レビューへ返す。
