---
title: Planner評価セット（オフライン評価）
---

River Reviewer の v0.3（Smart Reviewer）に向けて、Planner の「スキル選択・順序付け」の品質を **オフラインで再現評価**するための評価セットです。

## 何を評価するか

- PR差分（diff）から、適切なスキルが選ばれているか
- 期待するスキルが最低限カバーされているか（coverage）
- 「Top1（最初のスキル）」が期待に沿っているか（top1Match：任意）

## データセットの場所

- `tests/fixtures/planner-dataset/`
  - `cases.json`: ケース定義（phase / contexts / dependencies / 期待値）
  - `diffs/*.diff`: 小さな unified diff（`changedFiles` を導出するための入力）

## 実行方法

### 1) テキストで概要を表示

`npm run planner:eval:dataset`

### 1-1) 集計レポートを表示（ミスの傾向を見る）

`npm run planner:eval:dataset -- --report`

### 2) JSONを標準出力

`npm run -s planner:eval:dataset -- --json`

### 3) JSONをファイルに保存

`npm run -s planner:eval:dataset -- --out /tmp/planner-eval.json`

### 4) ベースラインと比較

1. ベースラインを保存（例）
   - `npm run -s planner:eval:dataset -- --out /tmp/planner-baseline.json`
2. 比較して差分を表示
   - `npm run planner:eval:dataset -- --compare /tmp/planner-baseline.json`

## v0.3（Smart Reviewer）に向けた目標（暫定）

この評価は「Plannerなし（決定論的）」経路の品質をまず安定させることを目的にしています。

- `coverage(avg)` は **100% を維持**（期待するスキルが選ばれなくなる退行を防ぐ）
- `top1Match(avg)` は **90%（= 9/10）以上**を目標（Top1を固定したケースのみ対象）

`--report` の mismatch 一覧から「どのケースで Top1 が外れているか」を確認し、改善の優先順位付けに使います。

## 期待値（cases.json）のルール

前提: オフライン評価では、常時ONのサンプル/ポリシー系スキルで結果が汚染されないよう、`tags` に `sample` / `hello` / `policy` / `process` が付いたスキルはデフォルトで除外しています。

### `expectedAny`（必須）

- 「このケースで **選ばれていてほしい** スキルID」を1つ以上列挙する（複数可）。
- coverage は `expectedAny` のうち、`selectedIds` に含まれた割合で計算する。
  - `expectedAny` が空の場合は coverage=1 扱いとする（ノイズケース等に使える）。

### `expectedTop1`（任意）

- 「Top1（最初に選ばれるスキル）」の許容集合である。
- Top1 を固定したいケースだけ設定し、固定しないケースは省略する。
  - `expectedTop1` が空の場合、そのケースは top1Match の集計対象外である。

### 期待値を決める基準（運用）

- **precision over coverage**：迷うときは期待値を増やしすぎない
- スキルIDは **安定した識別子** として扱う（リネームは慎重に）
- `expectedTop1` は「議論が起きやすい」ので、まずは `expectedAny` を優先

## ケース追加・更新の手順

1. `tests/fixtures/planner-dataset/diffs/*.diff` に diff を追加
2. `tests/fixtures/planner-dataset/cases.json` にケースを追加
3. `npm test` と `npm run lint` を実行
4. `npm run planner:eval:dataset` で結果を確認

補足: PRの差分表示では、追加行の行頭 `+` の影響で `+++ b/...` が `++++ b/...` に見えることがあります（実ファイル内容が正しければ問題ありません）。詳細は `tests/fixtures/planner-dataset/README.md` を参照してください。
