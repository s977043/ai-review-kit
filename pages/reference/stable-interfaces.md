---
title: 安定インターフェース（CLI / GitHub Actions）
---

River Review は OSS として成長中であり、内部実装は変更される可能性があります。一方で、利用者が安心して導入できるように **安定した契約（stable contract）** を定義します。

破壊的変更（breaking change）は原則として **major version bump** が必要です。

## 安定した契約（Stable Contract）

次の要素は「外部に公開されたインターフェース」として扱います。

- スキル定義（`schemas/skill.schema.json`）と、その意味論（severity/confidence など）
- GitHub Actions（`runners/github-action/action.yml`）のinputs / outputsと動作
- CLI（`river` / `river-review`）のコマンド/オプションと終了コード
- PR コメントの idempotent 更新方式（marker）

## コンポーネント安定性ラベル

各サーフェスの現在の安定性レベルを示します。

| ラベル           | 定義                                                              |
| ---------------- | ----------------------------------------------------------------- |
| **Stable**       | 破壊的変更にはメジャーバンプが必要。本番利用推奨                  |
| **Beta**         | マイナーバージョンで API が変わる可能性がある。非推奨化は事前通知 |
| **Experimental** | 予告なく変更・削除される可能性がある。評価目的での利用を推奨      |

| サーフェス                                 | ラベル       | 備考                                                                 |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------- |
| GitHub Action                              | Beta         | v0.x のため breaking changes の可能性あり                            |
| CLI (`river` コマンド)                     | Beta         | 下記の安定インターフェースは維持                                     |
| Skill Schema (`schemas/skill.schema.json`) | Beta         | CI バリデーション済み、フィールド拡張の可能性あり                    |
| Node API (`runners/node-api/`)             | Experimental | `private: true`、npm 未公開                                          |
| Agent Skills bridge                        | Experimental | v0.9.0 で追加、成熟途上                                              |
| Riverbed Memory                            | Experimental | 設計フェーズ — 安定化は未定。利用前に最新の Issue を確認してください |

## CLI（`river`）リファレンス（最小）

### コマンド

- `river run <path>`: ローカルでレビューを実行する
- `river doctor <path>`: 設定/前提を診断し、ヒントを出す
- `river skills <path>`: skill ベースのレビューを実行する（サブコマンド `river skills import` / `river skills export` / `river skills list` で Agent Skills と相互変換）
- `river review plan`: 上流アーティファクトを解決して Review Artifact を出力する（[仕様](./cli-review-plan-spec.md)）
- `river runs list`: 保存済みレビュー実行（`.river/runs/`）の一覧を表示する
- `river runs diff <id1> <id2> [<id3>...]`: 保存済みレビュー実行の差分を表示する（3 件以上指定すると振動検知も行う）
- `river runs summary`: 保存済みレビュー実行の集計を表示する
- `river suppression add`: Riverbed Memory の suppression エントリを作成する
- `river eval`: レビュー fixtures の評価を実行する

### 主なオプション

- `--phase <upstream|midstream|downstream>`: レビューフェーズ（デフォルト: `midstream`）
- `--planner <off|order|prune>`: Planner モード（デフォルト: `off`）
- `--dry-run`: 外部 API を呼ばずに実行する
- `--offline`（別名 `--rules-only`）: API キーが設定されていても AI を呼ばず、決定論的な機械的チェックのみでレビューする（CI 不可用時に Auto-approve 判定をローカル再現する用途）
- `--debug`: デバッグ情報を出す
- `--explain`: 採用された skill / gate / config tier を人間可読で出す（stderr）
- `--estimate`: コスト見積もりのみ（レビューは実行しない）
- `--max-cost <usd>`: 見積もりが上限を超える場合に中断する
- `--output <text|markdown|json|yaml|html>`: 出力形式（GitHub Actions は `markdown` を使用、`yaml` は [YAML 出力](./output-format-yaml.md) を参照、`html` は自己完結型 HTML レポート）
- `--context <list>`: 利用可能なコンテキスト（例: `diff,fullFile`）
- `--dependency <list>`: 利用可能な依存（例: `code_search,test_runner`）
- `--baseline <path>`: 過去のレビュー JSON（findings 配列）と比較して回帰を表示する
- `--save`: レビュー実行をプロジェクトの result store（`.river/runs/`）に保存する
- `--reviewers <roles|auto>`: レビュアーロールをカンマ区切りで指定、または `auto` でシグナルに基づく自動選択（詳細: [runner-cli-reference.md の `--reviewers` セクション](./runner-cli-reference.md#--reviewers-フラグ)）

### 終了コード

exit code は `--fail-on` / `--warn-on` を指定した場合のみ 0 以外になります。**`--fail-on` を指定しない場合は常に `0` を返します（findings の有無にかかわらず）。**

| exit code | 条件                                                                    | 説明                             |
| --------- | ----------------------------------------------------------------------- | -------------------------------- |
| `0`       | `--fail-on` 未指定 / `--advisory-only` / max severity < warn rank       | pass（常に 0）                   |
| `1`       | `--fail-on <sev>` 指定かつ max severity ≥ fail rank                     | fail（ブロック閾値以上）         |
| `2`       | `--warn-on <sev>` 指定かつ max severity ≥ warn rank かつ fail rank 未満 | warn（warn 閾値以上、fail 未満） |
| `1`       | 入力不正 / git 差分取得失敗 / スキル検証失敗 / `--max-cost` 超過など    | エラー終了                       |

severity の rank（低→高）: `info`=0 / `minor`=1 / `major`=2 / `critical`=3

自己修正ループでの停止条件・発散ガード・振動検知を含む詳細な利用契約は [ループ収束コントラクト](./loop-convergence-contract.md) を参照してください。

## GitHub Actions（`river-review`）リファレンス（最小）

### inputs（安定）

定義は `runners/github-action/action.yml` を参照してください。

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

- `<!-- river-review -->` marker を含むコメントを **更新** し、なければ新規作成する。
- コメント本文が長すぎる場合は末尾を切り詰める（上限あり）。

## バージョニング（破壊的変更の扱い）

次を変更する場合は、破壊的変更として major version bump を必要とします。

- `river` CLI のオプション名/意味の変更・削除
- Action inputs / outputs の変更・削除
- スキルスキーマの必須フィールド変更、既存フィールドの意味変更

Action は安定動作のため、`@main` ではなく **リリースタグへピン留め**することを推奨します（例: `@v1.14.0`）。

## スキーマのバージョニングポリシー

`schemas/` 配下の JSON Schema は `version` フィールド（例: `review-artifact.schema.json` の `"version": { "const": "1" }`）でバージョンを表します。

- 後方互換な追加（任意フィールドの追加、`enum` 値の追加など）は同一スキーマファイル内で行う。
- 破壊的変更（必須フィールド追加、既存フィールドの型/意味変更、`enum` 値の削除など）は次のいずれかの方針で行う。
  1. 新しいスキーマファイルとして作成する（例: `review-artifact.v2.schema.json`）。`version: const "2"` を割り当て、旧スキーマは最低 1 メジャーバージョン以上残置する。
  2. 既存スキーマで `oneOf` を用いて新旧バージョンを共存させる。`version` フィールドの値で分岐させ、消費者が単一の `$ref` で複数バージョンを処理できるようにする。

新スキーマを追加した場合は、対応するドキュメント（`pages/reference/_meta.json` 等）も更新してください。
