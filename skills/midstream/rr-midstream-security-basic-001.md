---
id: rr-midstream-security-basic-001
name: Baseline Security Checks
description: Check common security risks in application code (SQLi, XSS, secrets).
phase: midstream
applyTo:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/*.js'
  - '**/*.jsx'
tags: [security, midstream, web]
severity: major
inputContext: [diff, fullFile]
outputKind: [findings, actions]
dependencies: [code_search]
---

## Rule / ルール

- SQL/コマンドインジェクションを防ぐためプレースホルダや ORM のクエリビルダを使用する
- XSS を防ぐためエスケープ/サニタイズを行い、`dangerouslySetInnerHTML` 等を慎重に扱う
- ハードコードされた秘密情報・トークンを含めない

## Heuristics / 判定の手がかり

- 文字列連結でクエリを構築している (`SELECT ... ${userInput}`)
- `innerHTML` / `dangerouslySetInnerHTML` / `DOMParser` などで外部入力を未エスケープで出力
- `.env` で管理すべき値がコードに直書きされている（キー、パスワード、トークン）

## Good / Bad Examples

- Good: `db.query('SELECT * FROM users WHERE id = ?', [id])`
- Bad: ``db.query(`SELECT * FROM users WHERE id = ${id}`)``
- Good: `sanitize(userInput)` before injecting into HTML
- Bad: `<div dangerouslySetInnerHTML={{ __html: userInput }}>`

## Actions / 改善案

- プレースホルダ/バインドパラメータを使用し、文字列連結を避ける
- HTML 出力前にサニタイズまたは適切な UI コンポーネントを使用する
- 秘密情報は環境変数経由にし、`.gitignore` により管理する
