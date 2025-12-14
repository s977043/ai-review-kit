---
title: 安定インターフェース（CLI / GitHub Actions）
---

River Reviewer は OSS として成長中であり、内部実装は変更される可能性があります。一方で、利用者が安心して導入できるように **安定した契約（stable contract）** を定義します。

破壊的変更（breaking change）は原則として **major version bump** が必要です。

## 安定した契約（Stable Contract）

次の要素は「外部に公開されたインターフェース」として扱います。

- スキル定義（`schemas/skill.schema.json`）と、その意味論（severity/confidence など）
- GitHub Actions（`.github/actions/river-reviewer/action.yml`）の inputs / outputs と動作
- CLI（`river` / `river-reviewer`）のコマンド/オプションと終了コード
- PR コメントの idempotent 更新方式（marker）

## CLI（`river`）リファレンス（最小）

### コマンド

- `river run <path>`: ローカルでレビューを実行する
- `river doctor <path>`: 設定/前提を診断し、ヒントを出す

### 主なオプション

- `--phase <upstream|midstream|downstream>`: レビューフェーズ（デフォルト: `midstream`）
- `--planner <off|order|prune>`: Planner モード（デフォルト: `off`）
- `--dry-run`: 外部 API を呼ばずに実行する
- `--debug`: デバッグ情報を出す
- `--estimate`: コスト見積もりのみ（レビューは実行しない）
- `--max-cost <usd>`: 見積もりが上限を超える場合に中断する
- `--output <text|markdown>`: 出力形式（GitHub Actions は `markdown` を使用）
- `--context <list>`: 利用可能なコンテキスト（例: `diff,fullFile`）
- `--dependency <list>`: 利用可能な依存（例: `code_search,test_runner`）

### 終了コード

- `0`: 成功（レビュー/診断/見積もりが完了）
- `1`: 失敗（入力不正、git 差分取得失敗、スキル検証失敗、`--max-cost` 超過など）

## GitHub Actions（`river-reviewer`）リファレンス（最小）

### inputs（安定）

定義は `.github/actions/river-reviewer/action.yml` を参照してください。

- `phase`: `upstream|midstream|downstream`
- `planner`: `off|order|prune`
- `target`: レビュー対象のリポジトリパス
- `comment`: PR コメントを投稿するか（`pull_request` のみ）
- `dry_run`: 外部 API を呼ばずに実行するか
- `debug`: デバッグ情報を出すか
- `estimate`: コスト見積もりのみ実行するか
- `max_cost`: 見積もりが上限を超える場合に中断する
- `node_version`: Action 実行に用いる Node.js バージョン

### outputs（安定）

- `comment_path`: Actions runner の一時領域に出力した Markdown のパス（PR コメント投稿で使用）

### PR コメントの契約（idempotent）

- `<!-- river-reviewer -->` marker を含むコメントを **更新** し、なければ新規作成する。
- コメント本文が長すぎる場合は末尾を切り詰める（上限あり）。

## バージョニング（破壊的変更の扱い）

次を変更する場合は、破壊的変更として major version bump を必要とします。

- `river` CLI のオプション名/意味の変更・削除
- Action inputs / outputs の変更・削除
- スキルスキーマの必須フィールド変更、既存フィールドの意味変更

Action は安定動作のため、`@main` ではなく **リリースタグへピン留め**することを推奨します（例: `@v0.1.1`）。
