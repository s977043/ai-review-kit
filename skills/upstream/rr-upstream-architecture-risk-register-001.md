---
id: rr-upstream-architecture-risk-register-001
name: 'Architecture Risks, Assumptions & Open Questions'
description: 'Ensure design docs explicitly capture risks, assumptions, and open questions with owners, deadlines, and mitigation plans.'
phase: upstream
applyTo:
  - 'docs/**/*design*.md'
  - 'docs/**/*architecture*.md'
  - 'docs/adr/**/*'
  - 'docs/architecture/**/*'
  - 'pages/**/*design*.md'
  - 'pages/**/*architecture*.md'
  - '**/*.adr'
tags: [architecture, risk, assumptions, upstream]
severity: major
inputContext: [diff, adr]
outputKind: [summary, findings, actions, questions]
modelHint: balanced
dependencies: [repo_metadata]
---

## Goal / 目的

- 設計ドキュメントの差分から、暗黙の前提・未決事項・リスクが “放置される” 状態を減らし、意思決定と実装を前に進める。

## Non-goals / 扱わないこと

- すべての不確実性を欠陥扱いしない（未決なら “未決として管理する” を促す）。
- プロジェクト管理の一般論（タスク管理ツール運用など）に踏み込まない。

## False-positive guards / 抑制条件

- 変更が誤字/リンク/整形のみで、前提や意思決定が増減していない場合は指摘しない（`NO_ISSUES`）。
- 既にリスク/前提/未決が別ドキュメントで管理され、参照が明確な場合は重複指摘しない。

## Rule / ルール

- 先頭に要約を 1 行出す（新規/変更された前提・リスク・未決の要点）。
- 指摘は最大 8 件まで。重大な放置リスク（互換性、移行、セキュリティ、運用）を優先。
- “追記テンプレ” を付けて、ドキュメントに落とせる形にする。

## Checklist / 観点チェックリスト

- Assumptions（前提）
  - 前提（外部依存、データ品質、組織体制、SLO/コスト上限など）が明示されているか。
  - 前提が崩れたときの影響（何が壊れるか）が書かれているか。
- Risks（リスク）
  - 技術リスク/運用リスク/互換性リスクが列挙されているか。
  - 緩和策（mitigation）または検証計画（spike/PoC）があるか。
- Open Questions（未決事項）
  - 未決事項に Owner と期限（または意思決定タイミング）があるか。
  - 判断材料（必要な情報・確認先）が書かれているか。
- Follow-up（追跡）
  - ADR/設計の TODO が、消し込み条件（完了定義）付きで管理されているか。

## Output / 出力フォーマット

すべて日本語。`<file>:<line>: <message>` 形式で出力する。

- 先頭に要約を 1 行: `(summary):1: <前提/リスク/未決の要点>`
- 以降は指摘（最大 8 件）:
  - `<message>` に `[severity=critical|major|minor|info]` を含める。
  - 可能なら “追記テンプレ” を 1 行付ける。

追記テンプレ例:

- `前提: <内容> / 崩れた場合: <影響> / 監視: <兆候>`
- `リスク: <内容> / 影響: <大> / 緩和: <案> / Owner: <役割> / 期限: <日付 or マイルストーン>`
- `未決: <問い> / 判断材料: <必要情報> / Owner: <役割> / 期限: <日付 or マイルストーン>`

## 評価指標（Evaluation）

- 合格基準: 差分に紐づく暗黙の前提や未決が、追記テンプレ付きで可視化されている。
- 不合格基準: 差分と無関係な一般論、根拠のない断定、指摘過多。

## 人間に返す条件（Human Handoff）

- リスク受容（accept）や優先順位付けが必要な場合は人間（TL/PM）へ返す。
