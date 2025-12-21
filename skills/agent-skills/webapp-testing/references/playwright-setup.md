# Playwright セットアップと運用メモ

## インストールと初期化

1. `npm create playwright@latest` でプロジェクトを初期化し、ブラウザはデフォルトで `$HOME/.cache/ms-playwright` にインストールされる。
2. `playwright.config.ts` に `baseURL`、タイムアウト、スクリーンショット・トレースの保存先を設定する。
3. CI でキャッシュする場合は、`$HOME/.cache/ms-playwright` を保存して再利用する。

## 環境変数とシークレット

- アプリ URL や認証情報は環境変数（例: `APP_URL`, `TEST_EMAIL`, `TEST_PASSWORD`）で注入する。リポジトリに平文を置かない。
- CI では OpenID Connect やシークレットスキャンを活用し、最小権限のトークンだけを渡す。

## CI 実行の例（GitHub Actions）

```yaml
name: e2e-tests
on:
  pull_request:
    paths:
      - 'packages/web/**'
      - '.github/workflows/e2e-tests.yml'
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install Playwright
        run: |
          npm ci
          npx playwright install --with-deps
      - name: Run Playwright tests
        env:
          APP_URL: ${{ secrets.APP_URL }}
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
        run: npx playwright test --reporter=line
```

## 安定化とデバッグ

- 動的要素や遅延が多い UI では、`await expect(locator).toBeVisible()` などの明示的待機を徹底し、`waitForTimeout` の固定待ちは避ける。
- テストが長時間化する場合は、`projects` を分割して並列化し、`retries` を設定する。
- フレーク時は `npx playwright show-trace path/to/trace.zip` で取得済みトレースを確認する。

## River Reviewer への組み込みポイント

- スキル出力に含めるスクリーンショットやトレースの保存先を Runner に渡し、レビューコメントの根拠として参照できるようにする。
- 主要フロー（認証・主要ダッシュボード・主要 CRUD）を優先し、パフォーマンスに影響するテストは別ジョブに分離する。
- フィードバックは日本語でまとめ、重大度（`critical`/`major`/`minor`/`info`）を付けて返す。
