---
id: rr-midstream-security-basic-001
name: Baseline Security Checks
description: Check common security risks in application code (SQLi, XSS, secrets).
phase: midstream
applyTo:
  - '**/{api,routes,db,ui,components,auth,security,config}/**/*.{ts,tsx,js,jsx}'
tags: [security, midstream, web]
severity: major
inputContext: [diff]
outputKind: [findings, actions]
dependencies: [code_search]
---

## Goal / 目的

- 差分に含まれる高シグナルのセキュリティリスク（特に secrets の直書き）を検出し、事故を防ぐ。

## Non-goals / 扱わないこと

- 網羅的なセキュリティ監査（リポジトリ全体の棚卸し）。
- 差分外のコードを前提にした断定（コンテキスト不足時は Confidence を下げる）。
- テスト/fixtures のダミー値を secrets として断定する。

## False-positive guards / 抑制条件

- 環境変数参照（`process.env` / `import.meta.env`）で secrets を受け取っている場合。
- `tests/`, `__tests__`, `fixtures` 配下の変更で、明確にテストデータである場合。
- URL や短い文字列など、秘密情報としての確度が低い場合。

## Rule / ルール

- SQL/コマンドインジェクションを防ぐためプレースホルダや ORM のクエリビルダを使用する
- XSS を防ぐためエスケープ/サニタイズを行い、`dangerouslySetInnerHTML` 等を慎重に扱う
- ハードコードされた秘密情報・トークンを含めない
- 外部入力をバリデーションし、例外やエラーコードを一貫して返す（認可/認証/CSRF 含む）

## Heuristics / 判定の手がかり

- 文字列連結でクエリを構築している (`SELECT ... ${userInput}`)
- `innerHTML` / `dangerouslySetInnerHTML` / `DOMParser` などで外部入力を未エスケープで出力
- ORM/raw クエリでプレースホルダを使わずに外部入力を埋め込んでいる（`prisma.$queryRawUnsafe` など）
- `.env` で管理すべき値がコードに直書きされている（キー、パスワード、トークン）
- 外部 API/リクエストボディ/URL パラメータのバリデーションや認可チェックが無い
- 例外時のレスポンスが漏洩（スタックトレースや詳細エラーメッセージを返している）

## Good / Bad Examples

- Good: `db.query('SELECT * FROM users WHERE id = ?', [id])`
- Bad: ``db.query(`SELECT * FROM users WHERE id = ${id}`)``
- Good: `sanitize(userInput)` before injecting into HTML
- Bad: `<div dangerouslySetInnerHTML={{ __html: userInput }}>`
- Good: `zod`/`yup` などで入力スキーマを検証し、401/403/422 を明示的に返す

## Actions / 改善案

- プレースホルダ/バインドパラメータを使用し、文字列連結を避ける
- HTML 出力前にサニタイズまたは適切な UI コンポーネントを使用する
- 秘密情報は環境変数経由にし、`.gitignore` により管理する
- 外部入力をスキーマバリデーションし、認可/認証の欠落を補う
- 例外レスポンスをユーザーフレンドリーかつ漏洩のない形に統一する（スタックトレースを返さない）

## Output / 出力

- `Finding:` / `Evidence:` / `Impact:` / `Fix:` / `Severity:` / `Confidence:` を含む短いメッセージにする。
- secrets 検出の場合、Evidence に値そのものを再掲しない（必要ならマスクする）。

## 評価指標（Evaluation）

- 合格基準: 指摘が差分に紐づき、根拠と次アクションが説明されている。
- 不合格基準: 差分と無関係な指摘、根拠のない断定、抑制条件の無視。

## 人間に返す条件（Human Handoff）

- 仕様や意図が不明確で解釈が分かれる場合は質問として返す。
- 影響範囲が広い設計判断やトレードオフは人間レビューへ返す。
