# CLI Architecture

> 内部資料: River Review リポジトリには 2 系統の CLI が並立している。本ドキュメントはコントリビュータ向けに、各系統の責務・対象ユーザー・サブコマンドの境界を整理する。

## 2 系統の CLI

| 系統           | 実体                                                     | npm bin                                             | サブコマンド                                                 | 対象ユーザー                                               |
| -------------- | -------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| **メイン CLI** | `src/cli.mjs`                                            | `river` / `river-review` (`package.json#bin`)       | `run`, `skills` (`import`/`export`/`list`), `doctor`, `eval` | エンドユーザー、GitHub Action runner                       |
| **Runner CLI** | `runners/cli/src/index.mjs` (`@river-review/cli-runner`) | パッケージ内 `bin/river` のみ (private、npm 未公開) | `review`, `eval`, `create`                                   | リポジトリ内ツール、スキル開発者向け実験的インターフェース |

`runners/cli/package.json` は `"private": true` ではないが、`runners/` 配下の独立 npm package として `commander` ベースで実装されており、ルートの `package.json#bin` からは引き出されていない。実行は `node runners/cli/bin/river …` で行う。

## なぜ並立しているのか

- メイン CLI (`src/cli.mjs`) は GitHub Action 経由で `node ${GITHUB_ACTION_PATH}/dist/index.mjs run <repo>` の形で呼ばれる本番経路 (`runners/github-action/action.yml` L72)。`runners/github-action/dist/index.mjs` は `runners/github-action/src/index.mjs` (これが `src/cli.mjs` を import するシム) を ncc でバンドルした成果物。GitHub Action 入力 (`phase` / `dry_run` / `debug` / `--planner` / `--max-cost` / `--output`) との 1:1 対応が要件。
- Runner CLI (`runners/cli/`) は v0.2 系で導入されたスキル開発者向けの新インターフェース (`review` / `eval` / `create`)。`commander` を採用し、`@inquirer/prompts` でインタラクティブに `create skill` などを提供。GitHub Action 経路には載せていない。

両者は併用前提で、置き換え計画は無い (2026-04 時点)。

## サブコマンド対応表

| 用途                                | メイン CLI                                                                | Runner CLI                             |
| ----------------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| ローカル差分のレビュー実行          | `river run <path>`                                                        | `river review [files...]` (簡易確認用) |
| スキル一覧表示                      | `river skills list` (RR + Agent Skills 一覧)                              | (なし)                                 |
| スキルファイル単体の検証            | `npm run skills:validate` (リポジトリ全体、`scripts/validate-skills.mjs`) | `river eval <skill>`                   |
| 全スキル評価                        | `npm run eval:all` (`scripts/evaluate-all.mjs`)                           | `river eval --all`                     |
| 新規スキルの雛形生成                | `npm run create:skill` (`scripts/create-skill.mjs`)                       | `river create skill` (interactive)     |
| Agent Skills の入出力               | `river skills import` / `river skills export`                             | (なし)                                 |
| 設定診断                            | `river doctor <path>`                                                     | (なし)                                 |
| Fixtures eval (must_include checks) | `river eval --cases <path>`                                               | (なし)                                 |

「同じ名前で別物」なサブコマンド (`eval`) があるため、ドキュメントでは必ずどちらの CLI かを明示する。

`npm install` で PATH に入る `river` は **メイン CLI (`src/cli.mjs`)** である (`package.json` の `bin`)。Runner CLI は公開されない (`runners/cli/package.json` が `private: true`) ため、`node runners/cli/bin/river <subcommand>` として起動するか `npm link runners/cli` でリンクする。したがって上表の Runner CLI 列のコマンド (`river eval --all` など) を PATH の `river` にそのまま渡すと、メイン CLI 側の未知オプションとして exit 1 になる (#1709)。

## どちらを使うべきか

- **GitHub Action / 本番ローカル実行 / リリース前検証**: メイン CLI (`river run` / `river skills` / `river doctor`)。`runners/github-action` も内部でこれを呼ぶ。
- **スキルを書く / インタラクティブな雛形生成 / 単発の eval プロトタイプ**: Runner CLI (`river review` / `river eval` / `river create skill`)。
- **CI でのスキーマ検証**: `npm run skills:validate` / `npm run agents:validate` (どちらの CLI も経由しない直接スクリプト)。

## ドキュメント側の参照

- メイン CLI のオプション仕様: `pages/reference/stable-interfaces.md` § "CLI (`river`) リファレンス（最小）"
- Runner CLI のヘルプ: `runners/cli/README.md`
- スキーマ検証コマンド (Python ランナー / `npm run *:validate`): `pages/reference/runner-cli-reference.md`。タイトルは「Runner CLI リファレンス」である。だが内容は本ドキュメントで言う「Runner CLI = `runners/cli/`」とは別物である。Python 製のスキーマ検証スクリプト群を扱う。
- 新スキル作成手順: `pages/guides/add-new-skill.md`

## 既知の境界 / 注意点

- ルートの `package.json#bin` がメイン CLI (`src/cli.mjs`) にしか登録されていないため、`npx river review …` は **Runner CLI ではなくメイン CLI** に解釈される。メイン CLI には `review` コマンドが無いので unknown command エラーになる。Runner CLI を呼ぶ場合は `node runners/cli/bin/river …` あるいは `runners/cli` 内で `npm exec river …` を使う。
- GitHub Action は `runners/github-action/dist/` 配下のバンドル済み JavaScript を実行する。そのため、`runners/github-action/src/**` を変更した場合は注意が必要である。`npm run build:action` で `dist/` を再生成しないと CI の "Action dist freshness" が落ちる (`docs/development/dist-check-rebuild-guide.md` 参照)。
- 両 CLI ともデフォルト `phase` は `midstream`。`RIVER_PHASE` / `RIVER_PLANNER_MODE` / `RIVER_AVAILABLE_CONTEXTS` / `RIVER_AVAILABLE_DEPENDENCIES` などの `RIVER_*` 環境変数はメイン CLI でのみ参照される。Runner CLI は対応する `--phase` / `--context` / `--dependency` オプションでの明示が必要である。
- Runner CLI は `commander` の自動 help を使うため、メイン CLI の `printHelp()` (`src/cli.mjs`) と書式が揃っていない。両ヘルプを同期する責務は今のところ無い。

## Thin adapter 原則（GitHub Action / 各エージェント連携）

GitHub Action をはじめとする各実行面は、レビュー判断を持たない **thin adapter** として設計する（#1045 §4）。

- **正規実行面はメイン CLI**（`src/cli.mjs`）である。skill / pack の解決、gate 判定、selection の解釈、出力スキーマはすべて CLI 側に置く
- GitHub Action の責務は次の 3 点に限定する
  1. repository / PR コンテキストの収集（イベントペイロード、ラベル、PR 本文）
  2. CLI の実行（`dist/index.mjs run <repo>`—`src/cli.mjs` の ncc バンドル）
  3. 結果（JSON / findings）の PR コメント・summary への変換
- Claude Code / Codex プラグイン、Codex skill、shell 連携も同様に「CLI（または同一の skill 定義）を呼ぶ薄い層」とし、Action や plugin 側へレビュー方針・skill 解決ロジックを複製しない
- adapter 側に判断を足したくなった場合は、CLI のフラグ / config（`.river-review.json` / `.yaml`）へ昇格させてから adapter で透過させる

この原則により、`river skills resolve` 等での選択結果と実際の実行結果が、どの実行面でも一致することを保証する。

なお本節の「正規実行面はメイン CLI」は、判断ロジックの置き場と自動化経路の実行面を指します。エンドユーザー向けの配布面の順位は [`docs/adr/009-plugin-first-product-and-runtime-contract.md`](./adr/009-plugin-first-product-and-runtime-contract.md) が定めており、そちらでは Claude Code / Codex Plugin を第一級としています。
