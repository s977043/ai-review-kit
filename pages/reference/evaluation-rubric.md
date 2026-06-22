# 評価ルーブリック（多次元スコアリング）

River Review の評価フレームワークは、レビュー品質を多次元で定量化するルーブリックを提供します。各次元は独立したスコアを持ち、加重合計により総合スコアを算出します。

> **Status**: 本書は仕様であり、ランタイム統合（`scripts/evaluate-review-fixtures.mjs` / `src/lib/review-fixtures-eval.mjs` への `dimensionScores` 生成ロジックの組み込み）は（別途追跡中）。現時点ではスキーマ・ルーブリック定義と整合性テスト（`tests/eval-rubric.test.mjs`）のみが実装済みです。

## 次元一覧

| ID                    | 名前               | 説明                                     | Weight | スコアリング方式 | Direction        | 自動化 |
| --------------------- | ------------------ | ---------------------------------------- | ------ | ---------------- | ---------------- | ------ |
| `detection_accuracy`  | 検出精度           | レビューが期待された問題を検出できたか   | 0.25   | ratio            | higher_is_better | Yes    |
| `false_positive_rate` | 偽陽性率           | guard case で誤って指摘を出した割合      | 0.20   | ratio            | lower_is_better  | Yes    |
| `evidence_quality`    | エビデンス品質     | 指摘に Evidence ラベルが含まれているか   | 0.15   | ratio            | higher_is_better | Yes    |
| `severity_alignment`  | 重要度適切性       | 付与された severity が期待値と一致するか | 0.15   | ratio            | higher_is_better | Yes    |
| `phase_consistency`   | フェーズ一貫性     | 指摘がレビューフェーズと一貫しているか   | 0.10   | binary           | higher_is_better | Yes    |
| `actionability`       | アクショナビリティ | 指摘が実行可能な改善提案を含むか         | 0.10   | manual           | higher_is_better | No     |
| `token_efficiency`    | トークン効率       | Context Budget に対する出力の効率        | 0.05   | ratio            | higher_is_better | Yes    |

Weight 合計は 1.0 です（`tests/eval-rubric.test.mjs` で検証）。

## Direction（方向補正）

各次元は `direction` フィールドで「高いほど良い」か「低いほど良い」かを明示します。加重合計を計算する際、`lower_is_better` の次元は `(1 - score)` に変換してから合計する必要があります。

- `higher_is_better`（デフォルト）: スコアが高いほど良い
- `lower_is_better`: スコアが低いほど良い（例: `false_positive_rate`）

## スコアリング方式

### binary

- 条件を満たせば 1、満たさなければ 0
- 例: `phase_consistency` — 指摘のフェーズが期待フェーズと一致するかどうか

### ratio

- 0.0〜1.0 の連続値
- 例: `detection_accuracy` — 期待された問題のうち検出された割合

### manual

- 人間による評価を前提とするスコア
- 自動化不可（`automatable: false`）
- 例: `actionability` — 指摘の実行可能性は主観的判断が必要

## スキーマ

- 次元定義: `schemas/eval-rubric.schema.json`
- 評価結果記録: `schemas/eval-ledger-entry.schema.json`（`dimensionScores` フィールド）

### dimensionScores の構造

各評価エントリーに `dimensionScores` 配列が追加されました。

```json
{
  "dimensionScores": [
    {
      "dimensionId": "detection_accuracy",
      "score": 0.85,
      "scoringMethod": "ratio",
      "details": "17/20 expected findings detected"
    },
    {
      "dimensionId": "actionability",
      "score": null,
      "scoringMethod": "manual",
      "details": "Pending human review"
    }
  ]
}
```

- `dimensionId`（string, required）: `eval-rubric.schema.json` の `id` と対応
- `score`（number | null, required）: スコア値。manual 未評価時は `null`
- `scoringMethod`（string）: 使用したスコアリング方式（rubric の `scoringMethod` と一致）
- `details`（string）: 補足説明

## 既存フィクスチャとの関係

`docs/eval/rubric.yaml` の `dimensions` セクションは既存の `severity` および `phase` セクションと共存します。フィクスチャ（`tests/fixtures/review-eval/cases.json`）の `mustInclude` や `expectNoFindings` は引き続き有効であり、多次元スコアリングは追加のレイヤーとして機能します。

- フィクスチャの `mustInclude` → 主に `detection_accuracy` と `evidence_quality` の検証に対応
- フィクスチャの `expectNoFindings` → `false_positive_rate` の検証に対応
- フィクスチャの `maxFindings` → `token_efficiency` の間接的な指標

## トレードオフと制限事項

- **Weight の固定値**: 現在の weight はヒューリスティックに設定されており、実データに基づく最適化は未実施である。将来的にベイズ最適化やグリッドサーチで調整する可能性がある。
- **manual 次元のスケーラビリティ**: `actionability` は人間の評価が必要であり、大規模な CI 実行ではボトルネックとなる。中期的には LLM-as-a-Judge による代替を検討する。
- **binary の粒度**: `phase_consistency` は binary であるが、複数フェーズにまたがるケースでは部分的な一致を表現できない。ratio への移行を検討する余地がある。
- **token_efficiency の基準値**: Context Budget の定義が変更された場合、この次元の計算方法も更新が必要となる。

## 関連ファイル

- `docs/eval/rubric.yaml`
- `schemas/eval-rubric.schema.json`
- `schemas/eval-ledger-entry.schema.json`
- `pages/reference/evaluation-fixture-format.md`
