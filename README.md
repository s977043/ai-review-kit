# AI Review Kit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AIによるコードレビューを導入・運用するためのフレームワークとナレッジベースをまとめたオープンソースプロジェクトです。Docusaurus 上で公開するドキュメントに、AI支援型TDDや自律エージェント運用のベストプラクティスを体系化しています。

## 📘 このリポジトリが扱うテーマ
- AIレビュー導入の背景と設計指針（`docs/overview`, `docs/framework`）
- 失敗を減らすチェックリストとセキュリティガントレット（`docs/framework/checklist.md`, `docs/framework/security-gauntlet.md`, `coding-review-checklist.md`）
- GitHub Actions を中心としたセットアップ手順（`docs/setup`）
- コントリビューションポリシーと運営ルール（`docs/governance`, `CONTRIBUTING.md`）

## 🚀 クイックスタート: GitHub Actions で導入する
1. リポジトリの Secrets もしくは GitHub App で `OPENAI_API_KEY` など必要な認証情報を設定します。
2. `.github/workflows/ai-review.yml` を新規作成し、以下の最小構成を追加します。

> **⚠️ 重要**: フォークされたリポジトリからのPRでは、GitHub がセキュリティ上の理由でリポジトリのsecretsを公開しません。外部コントリビューターからのPRでレビューを実行する場合は、`pull_request_target` イベントの使用を検討するか、適切な権限スコープを設定してください。詳細は [GitHub Docs](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions) を参照してください。

```yaml
name: AI Review Kit
on:
  pull_request:
  push:
    branches: [main]
jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run AI Review Kit
        # ⚠️ Note: Replace with your actual action reference
        # Example: your-org/your-action@v1
        uses: s977043/ai-review-kit-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

3. PR を作成してレビューコメントやサマリーログを確認します。詳細は `docs/setup/quickstart.md` と `docs/setup/github-actions.md` を参照してください。

## 🛠️ ドキュメントの編集・検証
- Node.js 20.x 以上を推奨します（`node --version` で確認できます）。
- 依存導入: `npm install`
- 開発サーバー: `npm run dev`（http://localhost:3000）
- 本番ビルド: `npm run build`
- 文章Lint: `npm run lint`（Markdownlint + textlint）

ビルド成果物は `build/` に出力されます。CI やリンクチェックなどの追加フローはプロジェクト要件に合わせて拡張してください。

## 📁 主なディレクトリ
- `docs/` — Docusaurus 用ドキュメント。各章にガイド・リファレンス・ガバナンスを配置しています。
- `coding-review-checklist.md` — レビュー観点のクイックリファレンス。
- `AGENTS.md` — AIエージェント向けの作業ガイドライン。
- `docusaurus.config.js`, `sidebars.js` — ドキュメントサイトの設定ファイル。

## 🤝 コントリビューション
- 変更提案の前に [`CONTRIBUTING.md`](CONTRIBUTING.md) と `docs/governance/CONTRIBUTING.md` を確認してください。
- 作業範囲や禁止事項は `AGENTS.md` に記載されています。編集前に必ず確認してください。
- 文章や設定の改善、チェックリストの拡充など小さな変更も歓迎です。PR では実行したコマンドや検証ログを共有してください。

## 📜 ライセンス
このプロジェクトは MIT ライセンスの下で公開されています。詳細は [`LICENSE`](LICENSE) を参照してください。
