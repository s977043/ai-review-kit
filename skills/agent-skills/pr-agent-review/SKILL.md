---
name: pr-agent-review
description: qodo-ai/pr-agent を用いて PR の要約・指摘・自動コメント生成を行うスキル。
license: AGPL-3.0-only
compatibility: GitHub リポジトリへのアクセス権と GitHub App/トークンを持つ CI 環境で利用する。
metadata:
  author: river-reviewer
  version: '0.1.0'
  upstream: https://github.com/qodo-ai/pr-agent
allowed-tools:
  - Read
---

## Goal

PR 差分を自動解析し、River Reviewer のチェックリストと整合した要約と改善提案を返す。

## When to use

- GitHub 上の PR に対して自動コメントを生成したいとき
- Reviewer が付く前に大きなリスクを洗い出したいとき
- GitHub Actions でレビューを自動化し、再現性を高めたいとき

## Steps

1. pr-agent の設定ファイル（`pr_agent/settings.yaml`）でレビュー粒度やコメントテンプレートを River Reviewer 仕様に合わせる。
2. GitHub Actions から pr-agent を起動し、差分とメタデータ（タイトル・説明・ラベル）を取得する。
3. 出力コメントを Critical / Major / Minor に分類し、冗長な提案をフィルタする。
4. 最終コメントを River Reviewer のトーン（日本語推奨・根拠付き提案）で整形して投稿する。

## Output format

- Summary: 変更概要と主要リスク
- critical: **ファイル:行** 重大な欠陥と修正案
- major: **ファイル:行** 性能/品質/テストの不足
- minor: **ファイル:行** 軽微な改善提案やコメント

## Edge cases

- AGPL 依存のため、クローズド環境への組み込みはライセンスポリシーを必ず確認する。
- 変更が極端に大きい PR では要約が冗長化するため、対象ファイルや行数を制限するオプションを有効にする。
- 自動コメントが多すぎる場合は、重大度フィルタやコメント上限を設定する。

## References

- `references/pr-agent-actions.md`
