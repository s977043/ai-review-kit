---
id: security-model
title: River Review のセキュリティモデル
sidebar_label: セキュリティモデル
description: River Review 自身がなぜ設計上安全かをまとめます。スキルは実行コードではなく、レビューは読み取り専用で、出力はコメントのみ、最終判断は人間が持ちます。
keywords:
  - security model
  - AIコードレビュー 安全性
  - prompt injection
  - human-in-the-loop
  - River Review
---

River Review 自身が「なぜ設計上安全か」をまとめます。脆弱性の報告手順は [SECURITY.md](https://github.com/s977043/river-review/blob/main/SECURITY.md) を参照してください。

## スキルは実行コードではない

River Review のスキルは、フロントマターとプロンプト本文からなる Markdown ファイルです。`skills/` 配下に `scripts/` ディレクトリは無く、スキルがシェルやコードを実行することはありません。

スキルの「実行」とは、そのプロンプトと差分を LLM に渡してレビュー文を得ることを指します。パイプラインは `eval` / `vm` / 動的 `require` を用いず、差分を受け取るコード実行の sink もありません。決定論的な検出器は正規表現の照合のみで、`git` / `rg` の呼び出しは配列引数の `execFile` でシェルを介しません。

## レビューは読み取り専用

レビューの出力は `<file>:<line>: <message>` 形式の指摘です。形式に合わない出力は破棄され、フォールバックは決定論的なヒューリスティックに限られます。River Review はコードを変更せず、指摘と判定を材料として提示するだけです。

## 最終判断は人間が持つ（human-in-the-loop）

- GitHub Action は既定で `dry_run: true` である。
- PR への投稿はコメント（`COMMENT`）のみで、承認や自動マージの経路は存在しない。
- 決定論的なゲートは「人間レビューへのエスカレーション」しかできず、GO 側へ判定を押し込む手段を持たない。

つまり、いかなる指摘も自動で承認・マージ・コード変更を引き起こしません。

## 信頼できない差分の扱い

差分は信頼できない入力としてプロンプトに含まれます。これは LLM ベースのレビュー全般に共通する prompt injection の接点であり、River Review 固有の欠陥ではありません。悪意ある差分がなし得る最悪のケースは、人間が読む「誤ったレビューコメント」までに限定されます。理由は次のとおりです。

- 出力はコメントのみで、注入によってマージや承認を起こせない。
- 指摘はフォーマット検証を通り、自由記述の注入文は破棄される。
- 検証器は、差分に存在しないファイルを根拠にする指摘を棄却する（[verifier](https://github.com/s977043/river-review/blob/main/src/lib/verifier.mjs)）。
- レビュー規約は、差分外への推測に基づく指摘を禁止している。
- シークレット冗長化を入力と出力の両方に適用する。
- 動的なコード実行・デシリアライズを行わないため、RCE 型の「悪意あるペイロード」は成立しない。

## よくある誤解

- **「大規模変更 → 全スキル実行」はコード実行ではない**。これは全レビュー観点（テスト網羅性・命名・フレーキー等）を適用する、という意味である。特権操作やシェル実行を伴わない。
- **静的解析の置き換えではない**。構文・型・既知パターンの決定論的検査は専用ツールに任せ、River Review は意味的な整合性を補完する。

## 関連ドキュメント

- [SECURITY.md（脆弱性の報告）](https://github.com/s977043/river-review/blob/main/SECURITY.md)
- [Human Judgment Focus](./human-judgment-focus.md)
- [River Review とは](./what-is-river-review.md)
