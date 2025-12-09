---
id: rr-downstream-test-naming-001
name: Test Naming and Structure
description: Ensure tests use clear naming and cover edge cases with proper describe/it structure.
phase: downstream
applyTo:
  - '**/*.test.ts'
  - '**/*.spec.ts'
tags: [tests, naming, downstream]
severity: minor
inputContext: [tests, diff]
outputKind: [tests, findings, summary]
---

## Rule / ルール

- describe/it/test の命名を一貫させ、期待される振る舞いを明示する
- 正常系だけでなく境界・異常系もテストする
- テストデータの重複を避け、セットアップは共通化する

## Heuristics

- `it('works')` のような曖昧な名前
- 異常系テストや境界値が欠落
- 重複したモックデータやセットアップコード

## Good / Bad Examples

- Good: `it('returns 422 when payload is invalid')`
- Bad: `it('should work')`
- Good: 境界値・例外ケースを含む複数の it ブロック

## Actions / 改善案

- 期待されるステータスや値を含む名前に変更する
- エラーケース・境界値のテストを追加する
- beforeEach/ヘルパーでセットアップを共通化する
