---
slug: /
---

# River Reviewer docs

英語版は [index-en](/index-en) を参照してください（日本語がソース・オブ・トゥルースです）。

River Reviewer のドキュメントは、日本語を基本言語として提供し、
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
