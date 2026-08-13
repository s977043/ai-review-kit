# Dogfooding run artifacts

このディレクトリは、River Review で River Review 自身の変更をレビューした**実際の実行結果**を蓄積する場所です。ここに置かれた実行成果物は `npm run dashboard:generate` に集計され、ドキュメントサイトの[ダッシュボード](../../../pages/dashboard.md)に反映されます。

## なぜあるか

ダッシュボードの運用系メトリクス（レビュー回数・コメント数・コスト推移）は、**実際の LLM レビュー実行**からしか正しく得られません。合成した見かけのデータは載せません。実行成果物が 1 件も無い間、ダッシュボードは登録スキルと決定論的な検出器のカバレッジ（オフラインで再現可能な実データ）のみを表示し、運用系は正直に空表示になります。

## 実行成果物の形式

1 実行 = 1 つの JSON ファイル（`YYYY-MM-DD-<topic>.json`）。`generate-dashboard-data.js` が読む最小フィールド:

```json
{
  "date": "2026-07-04",
  "phase": "midstream",
  "filesReviewed": 8,
  "costUsd": 0.0312,
  "tokens": 41000,
  "findings": [
    {
      "skill": "security-basic",
      "severity": "major",
      "file": "src/example.mjs",
      "line": 42,
      "message": "…",
      "disposition": "accepted"
    }
  ]
}
```

- `findings[].disposition`（`accepted` / `dismissed`）は人間の最終判断を記録する。River Review は人間の判断を置き換えず補助する（human-in-the-loop）ため、指摘の採否は必ず人間が付ける。
- `costUsd` / `tokens` は実行時の実測値。オフライン（`--offline` / rules-only）実行はコストが発生しないため `0` を記録する。

## 実行結果の追加手順（メンテナ）

1. API キーを設定して実レビューを実行し、JSON を出力する（例: `river run . --output-format json`）。
2. 上記フォーマットに整形し、人間の `disposition` を付けてこのディレクトリにコミットする。
3. `npm run dashboard:generate` を実行して `docs/data/dashboard-stats.json` を更新する。
