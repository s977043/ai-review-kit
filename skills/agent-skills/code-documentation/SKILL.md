---
name: code-documentation
description: コードやAPIの意図を短時間で共有できるドキュメントの書き方をガイドする。
license: MIT
compatibility: Requires repository context and target audience definition.
metadata:
  author: river-reviewer
  version: '0.1.0'
allowed-tools:
  - Read
---

## Goal

変更意図・使い方・前提条件を短時間で伝えられるドキュメントを整備する。

## When to use

- README や API 仕様、サンプルコードを追加・更新するとき
- 変更点をレビューアや利用者へ確実に伝えたいとき
- エラーハンドリングや制約を明記し、利用ミスを減らしたいとき

## Steps

1. 誰向けかを明確化する（開発者/オペレーター/利用者）。
2. README 構成の最小セットを埋める。
   - 目的・前提（バージョン/依存関係/環境変数）
   - セットアップ手順と実行例（コマンドは検証済みのものだけ）
   - 主要ユースケースのサンプルコードや API 呼び出し例
3. API 仕様は機械可読フォーマットを優先する。
   - コードには JSDoc/TSDoc を付与し、例外・副作用も記載
   - OpenAPI などのスキーマを更新し、返却値/エラーケースを揃える
4. 変更箇所と整合するテストやログ出力があるか確認し、リンクを貼る。
5. レビュー観点をそろえるためにチェックリストを使う。
   - 用語の一貫性、期待値/前提の明記、更新日・バージョンの記載

## References

- ドキュメント整備チェックリスト: `references/documentation-checklist.md`

## Edge cases

- 実行できないコード例は載せない。環境依存の手順には代替（Docker/CI コマンド）を提示する。
- 外部公開する場合は秘密情報が含まれないことをダブルチェックする。
- サンプルのレスポンスやログはフェイクデータに置き換える。
