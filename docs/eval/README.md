# Eval artifacts

このディレクトリには評価/採点に関する補助資料を置きます。

## rubric.yaml

- 用途: severity / phase の語彙と、多次元スコアリング用の `dimensions` ルーブリックを統一するためのファイルである。
- 構成: 3 つのトップレベルセクションを持つ。
  - `severity`—severity ラベル（critical / major / minor / notice）の説明とアクション
  - `phase`—レビューフェーズ（design / implementation / test / improve）の説明
  - `dimensions`—多次元スコアリングの定義。各次元は `id` / `name` / `weight` / `scoringMethod` / `direction` / `automatable` を持ち、weight 合計は 1.0
- 参照: 現時点ではコードや CLI から直接読み込まれておらず、運用/設計の参照用である（ランタイム統合は後続 Issue で追跡）。
- 整合性検証: `tests/eval-rubric.test.mjs` が `docs/eval/rubric.yaml` と `schemas/eval-rubric.schema.json` の整合、および weight 合計 = 1.0 を検証する。
- 実行コマンド: rubric.yaml を読む専用コマンドはない。評価ランナーは `npm run eval:fixtures` を利用する。
- 関連ドキュメント: `pages/reference/evaluation-rubric.md`
