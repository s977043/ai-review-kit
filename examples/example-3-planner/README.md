# example-3: planner あり（切替フラグ付き）

planner を有効化して、スキル選択を `planner: order|prune` で切り替えるサンプルです。

## できること

- `planner: order`: LLM が優先度づけ（未参照スキルは後ろに追加）
- `planner: prune`: LLM が選んだスキルだけを実行（絞り込み）

## 必要なもの

- `OPENAI_API_KEY`（または `RIVER_OPENAI_API_KEY`）を GitHub Secrets に設定

## セットアップ

1. このディレクトリを対象リポジトリにコピーします（`.github/workflows/` を含む）
2. Secrets に `OPENAI_API_KEY` を設定します
3. PR を作成します

## 補足

- 外部送信を避けたい場合は `dry_run: true` にしてください（planner/LLM はスキップされます）。
- この例は `planner` 入力が必要なため、現状は `@main` を参照しています。実運用ではリリースタグへピン留めしてください。
