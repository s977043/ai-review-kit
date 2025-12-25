# Vercel で /docs/ を安定公開する

Next.js と Docusaurus を同じ Vercel プロジェクトに置くと、`/docs/*` が 404 になることがあります。Docs を別プロジェクトに分け、アプリ側で `/docs/*` を rewrite する構成にすると安定します。

## 前提とゴール

- 公開 URL は `https://<app-domain>/docs/...` のまま維持する。
- Docs プロジェクトは Docusaurus をビルドして配信する。
- 404 やリンク切れはビルド・CI で検知して落とす。

## Docs プロジェクト（Vercel）

1. このリポジトリを Vercel の別プロジェクト（例: `river-reviewer-docs`）として追加する。
2. Build Command: `npm run build`、Output Directory: `build` を設定する。
3. 環境変数を追加する。
   - `DOCS_SITE_URL=https://<docs-domain>` （例: `https://river-reviewer-docs.vercel.app`）
   - `DOCS_BASE_URL=/docs/`
   - `DOCS_ROUTE_BASE_PATH=/`
4. ルートへのアクセスを `/docs/` にリダイレクトする。リポジトリ直下の `vercel.json` は次のように設定済み。

```json
{
  "trailingSlash": true,
  "redirects": [
    { "source": "/", "destination": "/docs/", "permanent": false },
    { "source": "/docs", "destination": "/docs/", "permanent": false }
  ]
}
```

GitHub Pages 向けに `DOCS_BASE_URL` を指定しない場合は、従来どおり `/river-reviewer/docs/` 配信でビルドされます。

## アプリ側（`ai-review-kit.vercel.app` など）

アプリの `vercel.json` に rewrite を追加し、ドキュメントドメインへ転送します。

```json
{
  "rewrites": [
    { "source": "/docs", "destination": "https://<docs-domain>/docs/" },
    { "source": "/docs/:path*", "destination": "https://<docs-domain>/docs/:path*" }
  ]
}
```

## 品質ゲート

- `onBrokenLinks` と `onBrokenMarkdownLinks` は `throw` 設定。壊れた内部リンクや Markdown 内リンクをビルドで検知する。
- `npm run build`（必要に応じて `DOCS_BASE_URL=/docs/ DOCS_ROUTE_BASE_PATH=/` を指定）で `/docs/` 配信をローカル確認できる。
- リンクチェッカーのワークフローで外部リンク切れも検出し、失敗時は PR をブロックする。
