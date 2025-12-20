---
id: rr-upstream-bounded-context-language-001
name: 'Bounded Context & Ubiquitous Language'
description: 'Ensure architecture docs define bounded contexts, ownership, and a consistent ubiquitous language to prevent domain drift and coupling.'
phase: upstream
applyTo:
  - 'docs/**/*design*.md'
  - 'docs/**/*architecture*.md'
  - 'docs/adr/**/*'
  - 'docs/architecture/**/*'
  - 'pages/**/*design*.md'
  - 'pages/**/*architecture*.md'
  - '**/*.adr'
tags: [architecture, domain, boundaries, language, upstream]
severity: major
inputContext: [diff, adr]
outputKind: [summary, findings, actions, questions]
modelHint: balanced
dependencies: [repo_metadata]
---

## Goal / 目的

- 設計ドキュメントの差分から、境界（Bounded Context）や用語（Ubiquitous Language）の揺れを抑え、責務の混線とドメインドリフトを減らす。

## Non-goals / 扱わないこと

- 用語の好みや命名規則の押し付け（差分に紐づく “混乱コスト” の指摘に限定）。
- 実装レベルの名前付け（変数名/関数名）レビュー。

## False-positive guards / 抑制条件

- 変更が誤字修正や表記ゆれ修正のみの場合は指摘しない（`NO_ISSUES`）。
- ドメイン用語集が別途あり、差分が参照更新のみの場合は重複指摘しない。

## Rule / ルール

- 先頭に要約を 1 行出す（境界/用語/責務の変更点）。
- 指摘は最大 8 件まで。境界の曖昧さ、責務混在、用語の重複/同義語乱立を優先。
- 可能なら “追記案（貼れる形）” を付ける。

## Checklist / 観点チェックリスト

- Bounded Context（境界）
  - 主要な境界（サービス/ドメイン/モジュール）が列挙され、責務が説明されているか。
  - 境界の Owner（チーム/担当）が明確か。
  - 境界の Non-goals が明記されているか（何をしないか）。
- Ubiquitous Language（共通言語）
  - 重要用語（例: User/Account/Tenant 等）の定義があるか。
  - 文書内/文書間で同じ概念が別名で呼ばれていないか（同義語乱立）。
  - 逆に同じ語が別概念で使われていないか（多義語）。
- 境界横断
  - 境界を跨ぐ場合の翻訳（DTO/イベント/契約）や責任境界が明記されているか。
  - “共有モデル” が必要な場合、共有範囲と変更手続きがあるか。

## Output / 出力フォーマット

すべて日本語。`<file>:<line>: <message>` 形式で出力する。

- 先頭に要約を 1 行: `(summary):1: <境界/用語/責務の要点>`
- 以降は指摘（最大 8 件）:
  - `<message>` に `[severity=critical|major|minor|info]` を含める。
  - 可能なら “追記案” を 1 行付ける（例: `用語集: <用語>=<定義> を追加`）。

## 評価指標（Evaluation）

- 合格基準: 差分に紐づく境界/用語の曖昧さが指摘され、貼れる追記案がある。
- 不合格基準: 差分と無関係な一般論、根拠のない断定、指摘過多。

## 人間に返す条件（Human Handoff）

- 境界再編が組織やロードマップに影響する場合は人間の設計レビューへ返す。
