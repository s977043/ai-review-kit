# Skill Planner の評価と最適化のためのミニガイド

## 目的

- Planner の出力品質を可視化し、改善のベースラインを作る。
- LLM プロンプトやヒューリスティックを変えた際に、差分を簡易評価できるようにする。

## 評価の単位

- ケースごとの期待順序（`expectedOrder`）と、Planner 出力（`plan` または LLM 応答）を比較。
- メトリクス（簡易版）:
  - `exactMatch`: 期待順序と完全一致の割合
  - `top1Match`: 先頭要素が一致する割合
- `coverage`: 期待リストに含まれる ID のうち、出力へ含まれる割合
  - `MRR`: 期待先頭 ID の平均逆順位（Mean Reciprocal Rank）

## 使い方

1. 評価ケースを用意  
   `tests/fixtures/planner-eval-cases.json` に、`skills` / `context` / `plan` / `expectedOrder` を記述する。  
   ※ `plan` が未指定なら `expectedOrder` をそのまま LLM 応答として使う（オフライン評価用）。

2. 評価を実行

   ```bash
   npm run planner:eval  # デフォルトで上記フィクスチャを評価
   # または任意のフィクスチャを指定
   node scripts/evaluate-planner.mjs path/to/your-cases.json
   ```

3. 出力
   - サマリ（件数、exactMatch/top1/coverage/MRR）と各ケースの詳細を標準出力する。

## 実装メモ

- コア: `src/lib/planner-eval.mjs`（`planSkills` を呼び出してメトリクスを算出）
- CLI: `scripts/evaluate-planner.mjs`
- サンプル: `tests/fixtures/planner-eval-cases.json`
- テスト: `tests/planner-eval.test.mjs`（メトリクス計算の妥当性を確認）

## 改善アイデア（今後）

- 評価メトリクスの拡充（Normalized DCG など）
- 実際の LLM 応答をキャプチャして再生する仕組み
- 代表 PR / diff セットを固定し、スナップショット的に比較する仕組み
