---
name: code-quality
description: 可読性と保守性を中心に、コード品質の基本的な劣化を検知する。
license: Apache-2.0
compatibility: Requires access to repository files and unit tests.
metadata:
  author: river-reviewer
  version: '0.1.0'
allowed-tools:
  - Read
---

## Goal

局所的な実装の複雑化や曖昧な意図を早期に拾い、レビューの再現性を高める。

## When to use

- 条件分岐やデータ構造が増えたとき
- 例外処理やエラーハンドリングが変更されたとき
- 同種のロジックが複数箇所に増殖しているとき

## Steps

1. 変更点の責務が明確か、関数名/変数名で伝わるか確認する。
2. 条件分岐や早期 return の構造が読みやすいか確認する。
3. エラーハンドリングとログが一貫しているか確認する。

## References

- 詳細チェックリスト: `references/code-quality-checklist.md`

## Examples

入力: 複数条件の分岐と新しい例外処理を含む PR  
出力: 読みやすさ、責務の分離、例外処理の方針に関する指摘

## Edge cases

- プロジェクト固有の命名規約がある場合は、それを優先して指摘する。
