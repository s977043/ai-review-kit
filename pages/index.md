---
slug: /
---

# River Review docs

英語版は [index-en](/index-en) を参照してください（日本語がソース・オブ・トゥルースです）。

River Review のドキュメントは、日本語を基本言語として提供し、
[Diátaxis ドキュメントフレームワーク](https://diataxis.fr/) に基づいて構成しています。
同じ内容の英語版がある場合は `.en.md` を付けたファイル名で管理し、差分がある場合は日本語版を真実として扱います。

ドキュメントは次の 4 種類に分類されます。

- Tutorials（チュートリアル）: 学習志向。最初の成功体験を届けるステップバイステップ。
- Guides（ハウツーガイド）: タスク志向。特定のゴールを達成するための手順。
- Reference（リファレンス）: 仕様・API・スキーマなどの事実の一覧。
- Explanation（解説）: 背景・設計判断・概念の説明。

`pages/` 配下を Diátaxis で分け、言語はファイル名で表します（`/docs` に配信）。
リポジトリの `docs/` は内部向けメモ/補助資料です（公式ドキュメントではありません）。

- `tutorials/getting-started.md`（日本語） / `tutorials/getting-started.en.md`（英語）
- `guides/quickstart.md` / `guides/quickstart.en.md`
- `reference/skill-schema-reference.md` / `reference/skill-schema-reference.en.md`
- `explanation/riverbed-memory.md` / `explanation/riverbed-memory.en.md`

## コンセプトを知る

- [コンセプト（レビューを、組織の判断資産へ）](./explanation/concept.md) — 課題認識、コアモデル、レビュー対象、責任境界、目指さないものをまとめたコンセプトの解説。
- [River Review へようこそ](./explanation/intro.md) — はじめての方向けの短い導入。
- [River Review とは](./explanation/what-is-river-review.md) — 機能・利用方法・実行モデルを含むプロダクト概要。

## はじめる

- [River Review をはじめる](/tutorials/getting-started)
- [クイックスタート](/guides/quickstart)

## 高度な使い方

- [W チェック（二重レビュー）](/guides/w-check) — 他の AI レビュアーや人間レビュアーの結果を渡して再点検し、指摘の実在性を検証する機能。
- [リポジトリ全体レビュー](/guides/repo-wide-review) — PR 差分だけでなく変更ファイル周辺のリポジトリ文脈を踏まえたレビューの導入とチューニング手順。
- [コスト見積もりと最適化](/guides/cost-estimation) — `--estimate` と `--max-cost` を使った月額コストの試算と実測値による検証方法。
- [エージェントワークフロー（`--reviewers auto`）](/guides/agent-workflow) — AI エージェントから River Review を呼び出す各エントリポイント（CLI・サブエージェント・`/review-local`）の使い分け。
- [独立レビュー統合](/guides/use-independent-review-synthesis) — 複数の AI・人間レビュー結果を統合してマージ判断を支援する synthesis パターン。
