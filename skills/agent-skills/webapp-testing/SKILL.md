---
name: webapp-testing
description: Playwright でローカル/プレビュー環境の Web アプリを操作・検証するための手順をまとめる。
license: Apache-2.0
compatibility: Playwright とテスト対象の URL・認証情報を利用できる環境で使う。
metadata:
  author: river-reviewer
  version: '0.1.0'
allowed-tools:
  - Read
---

## Goal

UI から主要フローを自動操作し、機能・UX・回帰の問題を早期に見つける。

## When to use

- UI のスモーク/回帰テストを走らせたいとき
- バグ再現やデバッグでブラウザ操作を自動化したいとき
- 新しいユーザーフローを追加し、E2E テストを拡充するとき

## Steps

1. セットアップ
   - `npm create playwright@latest` でプロジェクトを初期化し、ブラウザをインストール。
   - `playwright.config.ts` に `baseURL`（例: `process.env.APP_URL`）や `testDir` を設定する。
2. テストを書く
   - 主要フローごとにシナリオを分割し、`getByRole` や `getByTestId` で安定したセレクタを使う。
   - ログインなど繰り返し処理はヘルパー/fixture に切り出す。
   - 例:

     ```typescript
     test('ログインしてダッシュボードを表示', async ({ page }) => {
       await page.goto('/');
       await page.getByLabel('メールアドレス').fill(process.env.TEST_EMAIL ?? 'user@example.com');
       await page.getByLabel('パスワード').fill(process.env.TEST_PASSWORD ?? 'dummy-password');
       await page.getByRole('button', { name: 'ログイン' }).click();
       await expect(page).toHaveURL(/dashboard/);
     });
     ```

3. 実行とデバッグ
   - `npx playwright test --headed` で目視確認、`--ui` でテスト選択、`--debug` でステップ実行。
   - フレーク調査には `npx playwright test --trace on` でトレースを取得する。
4. 待機とモック
   - `await expect(locator).toBeVisible()` などの明示的待機を使い、`waitForTimeout` の固定待ちを避ける。
   - 外部 API 依存が強い場合は `page.route` でレスポンスをモックして安定させる。
5. 回帰スイート化
   - クリティカルなフロー（認証/主要ダッシュボード/CRUD）を 1 スイートにまとめ、CI で定期実行する。
   - テストデータは作成・削除をセットで用意し、汚染を残さない。

## Edge cases

- 認証情報やトークンは環境変数で注入し、リポジトリに平文で置かない（例示はダミー値で）。
- アニメーションや時刻依存の UI は、テスト用のフラグやモックを使って安定化する。
- スクリーンショット/スナップショットを使う場合、動的要素やローカライズ差異に配慮する。
