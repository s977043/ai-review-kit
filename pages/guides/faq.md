---
title: FAQ（よくある失敗）
---

起きがちで致命になりやすい失敗を、症状→原因→対処→確認コマンドの形でまとめます。

## 1) PR でレビューが実行されない（fork PR で secrets が使えない）

- 症状:
  - PR にコメントが投稿されない
  - `OPENAI_API_KEY` を設定しているはずなのに LLM が使われない
- 原因:
  - fork からの PR では GitHub の仕様で secrets が渡らない（安全のため）
- 対処:
  - 外部コントリビューターの PR で実行したい場合は、イベント（`pull_request_target` など）と権限設計を見直す（注: `pull_request_target` はセキュリティリスクを伴うため慎重に利用してください）
  - まずは `dry_run: true` で「動線だけ」確認する
- 確認コマンド:
  - `river doctor .`

## 2) 差分が検出されない（merge-base が取れない / fetch-depth 不足）

- 症状:
- `No changes to review compared to main.` のように表示される
  - Actions でも差分が空扱いになる
- 原因:
  - `actions/checkout` の `fetch-depth` が浅いと merge-base が安定して取れない
- 対処:
  - `actions/checkout` に `fetch-depth: 0` を設定する
- 確認コマンド:
  - `git fetch --all --tags`
- `git merge-base HEAD origin/main`

## 3) planner を指定したのにスキップされる

- 症状:
  - `Planner: order skipped (OPENAI_API_KEY...)` のように表示される
- 原因:
  - `OPENAI_API_KEY`（または `RIVER_OPENAI_API_KEY`）が未設定
  - `dry_run: true`（外部呼び出し抑止）
- 対処:
  - `dry_run: false` にして secrets を設定する
  - まずは `planner: off` で決定論の経路が安定しているか確認する
- 確認コマンド:
  - `river run . --planner order --debug`

## 4) スキルが選ばれない / ほとんどスキップされる

- 症状:
  - `Selected skills (0)` になる
  - スキップ理由に `missing inputContext` / `missing dependencies` が出る
- 原因:
  - `RIVER_AVAILABLE_CONTEXTS` / `RIVER_AVAILABLE_DEPENDENCIES` が不足している
  - フェーズ（`--phase` / `phase`）や `applyTo` が差分に合っていない
- 対処:
  - 必要な context/dependency を宣言する（またはスタブを有効化する）
  - `--phase` を見直す
- 確認コマンド:
  - `river run . --debug`
  - `RIVER_DEPENDENCY_STUBS=1 river run . --debug`

## 5) PR へのコメント投稿が失敗する（権限不足）

- 症状:
  - Actions のログに権限エラーが出る
  - コメントが投稿されない
- 原因:
  - workflow の `permissions` が不足している（例: `pull-requests: write` / `issues: write`）
- 対処:
  - workflow に必要な `permissions` を追加する
- 確認コマンド:
  - `gh workflow view`（権限設定の確認）
