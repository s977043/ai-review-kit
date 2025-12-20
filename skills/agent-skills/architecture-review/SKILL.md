---
name: architecture-review
description: 変更の全体設計、責務分離、境界の破綻を検知するためのレビュー手順。
license: Apache-2.0
compatibility: Requires access to repository files and design docs (ADR/README).
metadata:
  author: river-reviewer
  version: '0.1.0'
allowed-tools:
  - Read
---

## Goal

変更が既存アーキテクチャの境界や責務に合っているかを判断し、構造的な劣化を防ぐ。

## When to use

- 新しいモジュール/サービス/レイヤーが追加されたとき
- 既存コンポーネントの責務が増えているとき
- 依存関係が増えたり循環の兆候があるとき

## Steps

1. 変更範囲の責務と境界を簡潔にまとめる。
2. 依存の向きが設計意図に沿っているか確認する。
3. 重要な判断が文書化されているか確認する。

## References

- 詳細チェックリスト: `references/architecture-checklist.md`

## Examples

入力: 新しい集約/レイヤーが増える PR  
出力: 境界の理由、依存方向、責務の分離に関する指摘/確認事項

## Edge cases

- 既存の設計指針がリポジトリ内に存在しない場合は「判断材料不足」として質問する。
