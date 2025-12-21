---
name: agentcheck-code-review
description: AgentCheck ベースでローカルリポジトリを走査し、PR 前のコードレビューを実行するスキル。
license: MIT
compatibility: Node.js 20+ とローカルリポジトリへの読み取り権限がある環境で利用する。
metadata:
  author: river-reviewer
  version: '0.1.0'
  upstream: https://github.com/devlyai/AgentCheck
allowed-tools:
  - Read
---

## Goal

ローカルでリポジトリ全体を走査し、River Reviewer の midstream/downstream フェーズに合う粒度で指摘を返す。

## When to use

- PR 作成前にセルフレビューを行いたいとき
- 既存ルール（lint 以外）を補完する静的レビューを手元で走らせたいとき
- CI に乗せる前に AgentCheck の挙動を検証したいとき

## Steps

1. AgentCheck の設定ファイルとルールセットを読み込み、対象リポジトリをインデックスする。
2. 差分に関わらず、影響範囲が広いファイルは優先してスキャンする。
3. 重大度を Critical / Major / Minor に分類し、Why と Fix を添えて出力する。
4. River Reviewer の出力スキーマに沿うよう、ファイルパスと行番号を明示したコメントを返す。

## Output format

- Critical: **ファイル:行** 重大な欠陥と修正案（セキュリティ・クラッシュなど）
- Major: **ファイル:行** 品質/性能/テストの不足を伴う指摘
- Minor: **ファイル:行** 可読性や軽微な改善提案

## Edge cases

- 大規模リポジトリではインデックスに時間がかかるため、対象ディレクトリを限定する。
- プロジェクト固有ルールを追加する場合は、AgentCheck のルールファイルに追記してから実行する。

## References

- `references/agentcheck-setup.md`
