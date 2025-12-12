# minimal-js

最小の JavaScript プロジェクト例です。

## 含まれるもの

- Node.js の最小コード（`src/`）
- `node --test` の最小テスト
- River Reviewer を組み込む GitHub Actions の例（`.github/workflows/river-reviewer.yml`）

## 使い方（手元で試す）

```bash
npm install
npm test
```

## GitHub Actions への組み込み

このディレクトリの `.github/workflows/river-reviewer.yml` を、対象リポジトリの `.github/workflows/` にコピーしてください。

- `actions/checkout` は `fetch-depth: 0` を推奨（merge-base を安定取得）
- `OPENAI_API_KEY` は Secrets に設定
- Action はリリースタグにピン留め（例: `@v0.1.0`）。必要なら `@v0` のようなエイリアスタグ運用も可能
