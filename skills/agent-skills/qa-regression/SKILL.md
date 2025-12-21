---
name: qa-regression
description: Playwright を使った回帰テストの設計と実行をガイドする。ログインやダッシュボードなど主要フローの健全性を継続確認する。
license: MIT
compatibility: Playwright を導入済みで、テスト用の認証情報やエンドポイントがある環境で利用する。
metadata:
  author: river-reviewer
  version: '0.1.0'
allowed-tools:
  - Read
---

## Goal

主要ユーザーフローの回帰を自動化し、変更による破壊を早期検知する。

## When to use

- 認証・ダッシュボード・ユーザー CRUD など横断的なフローを守りたいとき
- リリース前のスモーク回帰や毎日定期の回帰を設計するとき

## Steps

1. 前提を確認: Playwright が導入済みか (`npm install playwright @playwright/test && npx playwright install`)。環境変数（`TEST_EMAIL`, `TEST_PASSWORD`, `API_URL`, `ADMIN_TOKEN` など）が用意されているか。
2. テスト構成を決める（例）。

   ```text
   tests/
   ├─ auth/login.spec.ts
   ├─ auth/logout.spec.ts
   ├─ dashboard/load.spec.ts
   ├─ users/create.spec.ts
   └─ regression.spec.ts (スイート実行用)
   ```

3. 共通ヘルパーを用意する。
   - `login(page)` で認証を共通化。
   - テストデータ作成/削除ヘルパーで後片付けを担保。
4. 各シナリオを実装する。
   - 成功ケース: 正常ログイン、ダッシュボード表示、ユーザー作成。
   - 失敗ケース: 認証エラー、バリデーションエラー。
   - 性能のしきい値がある場合は計測し、期待値を明記。
5. `npx playwright test` を実行し、フレークが無いか確認する（`--headed` でデバッグ可）。

## Edge cases

- 外部 API 依存が大きい場合は、ルーティングモックやフェイクデータで安定性を確保する。
- テストデータのクリーンアップを怠ると後続ケースが汚染されるため、`afterEach` での削除を必須にする。
