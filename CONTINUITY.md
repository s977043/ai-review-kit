Goal (success criteria included):

- 復旧不能な 404 になっている /docs を再公開できる構成とし、ビルド時にリンク不整合を検知できるようにする。

Constraints / Assumptions:

- レポジトリの AGENTS.md ルールに従う（npm test / npm run lint など実行）。
- 変更は Docusaurus ドキュメント基盤と関連設定に限定し、秘密情報は扱わない。
- Ledger を主要イベント前後で更新する。

Key decisions:

- Vercel デプロイでは `DOCS_BASE_URL=/docs/` と `DOCS_ROUTE_BASE_PATH=/` を使い、GitHub Pages などでは従来の `/river-reviewer/` ベースを維持する。

State:
Done:

- Docusaurus の baseUrl/trailingSlash を環境変数で切り替え可能にし、onBrokenMarkdownLinks を throw に設定。
- `/docs/` リライト用の `vercel.json` と、アプリ側 rewrite 手順のガイドを追加。
- `/docs/` ルート重複を避けるためトップページ slug を `/home` に変更し、Redirect を環境設定に追従させた。
- リンクチェッカーが失敗したら CI を fail させるステップを追加。
- `npm test`, `npm run lint`, `DOCS_BASE_URL=/docs/ DOCS_ROUTE_BASE_PATH=/ npm run build` を実行。
  Now:
- 変更内容をコミットし、PR 用メッセージを準備する。
  Next:
- 変更をコミットして make_pr を実行する。

Open questions:

- アプリ側（Next.js 側）の rewrite 適用状況は別リポジトリ管理のため不明（UNCONFIRMED）。

Working set (files / ids / commands):

- CONTINUITY.md, docusaurus.config.js, src/pages/index.js, pages/index.md, pages/guides/deploy-docs-vercel.md, sidebars.js, vercel.json, .github/workflows/link-check.yml
- Commands executed: npm test; npm run lint; DOCS_BASE_URL=/docs/ DOCS_ROUTE_BASE_PATH=/ npm run build
