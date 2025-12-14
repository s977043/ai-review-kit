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
