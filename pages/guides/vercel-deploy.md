---
title: Vercel デプロイ運用（main / release）
---

このリポジトリでは、Vercel へのデプロイ頻度を抑えつつ、環境を分けて検証できるように運用します。

## 方針（ブランチと環境）

- `main`: Production（本番）デプロイ
- `Release` または `release/**`: Preview（ステージング相当）デプロイ
- PR / feature ブランチ: Vercel デプロイしない（GitHub Actions 側でトリガーしない）

## GitHub Actions によるデプロイ

ワークフローは `.github/workflows/vercel-deploy.yml` で管理します。

### 必要な Secrets

GitHub の Secrets に次を登録してください。

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

任意:

- `VERCEL_CLI_VERSION`（GitHub Variables）: Vercel CLI のバージョン固定に使用する（未設定なら `latest`）。

取得方法の例:

- `VERCEL_TOKEN`: Vercel の Account Settings > Tokens
- `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`: `vercel link` 実行後の `.vercel/project.json` など

### デプロイ方式（Vercel CLI）

Vercel の推奨フローに合わせ、GitHub Actions 上でビルドし、成果物を `--prebuilt` でアップロードします。

- `vercel pull`（環境変数・設定の取得）
- `vercel build`（ビルド）
- `vercel deploy --prebuilt`（成果物デプロイ）

## 注意: Vercel の Git 連携（自動デプロイ）について

Git 連携が有効なままだと、PR 作成/更新でも Preview デプロイが走り、二重デプロイになります。
本運用（`main` / `Release` / `release/**` のみ）に揃える場合は、次のいずれかで自動デプロイを止めてください。

- Vercel 側で Git 連携の自動デプロイを無効化する
- GitHub 側で Vercel GitHub App をリポジトリから外す（Preview Deployments / Preview Comments も停止）

### GitHub 側で Vercel GitHub App を外す（例）

- GitHub の該当リポジトリ → `Settings`
- `Integrations` → `GitHub Apps`（または `Installed GitHub Apps`）→ `Vercel` を `Configure`
- 対象リポジトリへのアクセスを外す（またはアプリをアンインストールする）
