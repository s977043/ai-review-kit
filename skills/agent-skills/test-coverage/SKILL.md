---
name: test-coverage
description: 変更に対するテスト不足を検知し、最低限の補完方針を提示する。
license: Apache-2.0
compatibility: Requires access to repository files and test directories.
metadata:
  author: river-reviewer
  version: '0.1.0'
allowed-tools:
  - Read
---

## Goal

仕様変更や機能追加に対するテストの抜け漏れを早期に見つける。

## When to use

- 新機能が追加されたとき
- 既存ロジックの分岐が増えたとき
- バグ修正が入ったとき

## Steps

1. 変更された振る舞いを 1 行で要約する。
2. 対応するテストが存在するか探す。
3. テスト不足なら、最小限のテスト観点を提示する。

## References

- 詳細チェックリスト: `references/test-coverage-checklist.md`

## Examples

入力: 新しい分岐と入力バリデーションが追加された PR  
出力: 未カバーの分岐や異常系テストの不足を指摘

## Edge cases

- 既に E2E や統合テストで担保されている場合は、その事実を確認して黙る。
