# Skill Evaluation KPI

River Review の skill / planner / review pipeline がどれだけ「使える」状態かを測定する KPI 集。本 doc は **既に実装されているメトリクスを codify する** ことが目的で、新規メトリクスの追加は別 PR で扱う。

## 計測レイヤ

```text
planner    ── どの skill を選ぶか
   │
   ▼
fixtures   ── 選ばれた skill が期待通り動くか
   │
   ▼
pipeline   ── 全体としてレビューが終わるか
```

## KPI 一覧

### Planner KPIs (`tests/fixtures/planner-dataset/cases.json`)

| KPI                  | 定義                                                                                 | 現在値 (2026-05-07) | 計測コマンド                                            |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------- |
| `cases`              | planner-dataset に登録された case 数                                                 | 41                  | `npm run planner:eval:dataset -- --json \| jq .summary` |
| `coverage`           | `expectedAny` の skill が `selected` に含まれた割合 (per-case 平均)                  | 1.000               | 同上                                                    |
| `top1Match`          | `expectedTop1` を持つ case のうち `selected[0]` が `expectedTop1` 配列に含まれる割合 | 1.000               | 同上                                                    |
| `top1MatchCases`     | `expectedTop1` フィールドを持つ case 数 (top1 ordering 検証の対象)                   | 31                  | 同上                                                    |
| `failuresByCategory` | failure を `routing_miss` / `phase_miss` 等にカテゴライズした集計                    | `{}` (failures = 0) | 同上                                                    |

**目標値**: `coverage = 1.0` を維持。`top1Match >= 0.9` を維持。`top1MatchCases / cases >= 0.7` を目標 (現在 31/41 = 76%)。

### Fixture KPIs (`tests/fixtures/review-eval/cases.json`, `tests/fixtures/repo-wide-eval/`)

| KPI                           | 定義                                                                            | 計測コマンド                |
| ----------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| must_include recall           | fixture で期待トークンが出力に含まれる割合                                      | `npm run eval:fixtures`     |
| false positive rate           | guard case (`expectNoFindings`) で誤検出した割合                                | `npm run eval:fixtures`     |
| evidence attachment rate      | findings に `Evidence:` フィールドが含まれる割合                                | `npm run eval:fixtures`     |
| context-lift (repo-wide eval) | repo-wide context 有無での detection rate 差分（正なら context が検出力に貢献） | `npm run eval:repo-context` |

### Pipeline / meta KPIs

| KPI                   | 定義                                            | 計測コマンド                |
| --------------------- | ----------------------------------------------- | --------------------------- |
| skill schema valid    | `skills/**/SKILL.md` が schema に適合しているか | `npm run skills:validate`   |
| meta consistency      | version / tag / package metadata の整合性       | `npm run meta:validate`     |
| bilingual paired      | `pages/**/*.md` の ja / en pair の充足率        | `npm run check:bilingual`   |
| link health (offline) | `**/*.md` の link 切れ                          | `npm run check:links:local` |

## KPI を上げ下げした PR の責務

[`skill-severity-rubric.md`](./skill-severity-rubric.md) や [`skill-applyto-scoping.md`](./skill-applyto-scoping.md) に基づく変更を行う PR は、本 doc の KPI を **before / after で記録する** ことが推奨される。

最低限:

- `npm run planner:eval:dataset` の `cases / coverage / top1Match / top1MatchCases` を before / after で PR 本文に記載
- 変更が `tests/fixtures/review-eval/` を touch するなら `npm run eval:fixtures` の must_include recall / FP rate も記載

## 既知の制約 / 改善ロードマップ

| 項目                                           | 状態   | 詳細 / 次のアクション                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KPI の history 自動記録 (per-run)              | 実装済 | `evaluate-all.mjs --append-ledger` で `artifacts/evals/results.jsonl` に追記。`.github/workflows/nightly-eval.yml` が毎日実行し、artifact として 90 日保管。                                                                                                                                                                                                                                                      |
| KPI の cross-run 比較                          | 実装済 | `npm run eval:compare` (`scripts/compare-eval-ledger.mjs`) で ledger 内の最後 2 entry を比較し、回帰時 exit 1。nightly 跨ぎは #1820 で自動化済みで、`nightly-eval.yml` の `Restore eval ledger from previous run` が安定名 artifact `nightly-eval-ledger` を前 run から復元する。復元できない場合（初回 run、または 90 日で全コピーが失効した場合）のみ、90-day artifact を手でダウンロードしてローカル比較する。 |
| Planner-dataset の baseline 比較               | 実装済 | `npm run planner:eval:dataset -- --compare <baseline.json>` で任意 baseline と比較。                                                                                                                                                                                                                                                                                                                              |
| 90 日超の history persistence                  | 未実装 | データ branch / GitHub Pages / 外部ストレージ等のアーカイブ先を決める必要あり。                                                                                                                                                                                                                                                                                                                                   |
| severity-rubric 適用後の severity 分布変化追跡 | 未実装 | severity を上下した PR ごとに stream 別分布スナップショットを残す。                                                                                                                                                                                                                                                                                                                                               |
| FP rate の skill 別ブレイクダウン              | 未実装 | per-skill FP rate を artifact に出して history 比較。                                                                                                                                                                                                                                                                                                                                                             |
| Planner top1 stability over time               | 未実装 | top1 が時系列で動いた回数を記録（routing regression detection の感度を上げる）。                                                                                                                                                                                                                                                                                                                                  |

これらは Phase 2/3 (`docs/ai/eos-overview.md` 参照) で順次取り組む。

## eval:compare の使い方

```bash
# baseline を取る (例: main 上で)
git switch main
npm run eval:all -- --append-ledger --description "baseline"

# 変更を検証 (任意のブランチで)
git switch feat/your-branch
npm run eval:all -- --append-ledger --description "candidate: <change>"

# 直近 2 entry を比較
npm run eval:compare
# → markdown delta table が出力される。回帰検出時は exit 1
```

90-day artifact からの比較例:

```bash
gh run download <nightly-run-id> -n nightly-eval-<run-id> -D /tmp/prev
npm run eval:compare -- --ledger /tmp/prev/artifacts/evals/results.jsonl
```

## 参考

- [`docs/ai/eos-overview.md`](../ai/eos-overview.md)—KPI を含む 5-layer EOS の全体像
- [`docs/development/skill-severity-rubric.md`](./skill-severity-rubric.md)—severity 設計の policy
- [`docs/development/skill-applyto-scoping.md`](./skill-applyto-scoping.md)—applyTo の policy
- [`tests/fixtures/planner-dataset/README.md`](../../tests/fixtures/planner-dataset/README.md)—planner-eval fixture の構造
- [`scripts/evaluate-planner-dataset.mjs`](../../scripts/evaluate-planner-dataset.mjs)—planner KPI の計算実装
