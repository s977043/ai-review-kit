# #1880 active の run を受け取る paired 比較経路（`river evolve prompt-ab`）

ADR-006 段 2 の残件のうち、実装で解ける 1 件です。legacy prompt を送った run と compiled prompt を送った run を 2 系統として受け取り、findings 水準の突合を成立させます。

出典: [ADR-006](../adr/006-model-aware-review-prompt-compiler.md) / [1860-prompt-compiler-paired.md](./1860-prompt-compiler-paired.md)

## 1. なぜ既存の `prompt-compare` を拡張しないのか

`observe` の run は legacy と compiled の**両方の指紋を 1 レコードに**持ちます。両側が同一レコードから導出されるため、そこへ「compiled を実際に送った run」を混ぜると `legacyPromptHash` の指す対象が run ごとに変わり、paired diff の意味が壊れます。

`src/lib/prompt-compiler-paired.mjs` の `sentPrompt !== 'legacy'` 拒否は #1860 が意図して置いた安全弁です。本経路はこれを緩めません。検査を外すと、比較しているものが何なのか分からないまま数字だけが出ます。それは欠測より悪い状態です。欠測は「測っていない」と分かりますが、壊れた比較は「測った」ように見えます。

したがって #1880 は拒否の回避ではなく、**2 系統を明示的に受け取る別の入口**として成立させています。

## 2. 取り違え防止

観測経路と A/B 経路の成果物は、次の 3 点で機械的に区別できます。

| 項目                    | `prompt-compare`              | `prompt-ab`              |
| ----------------------- | ----------------------------- | ------------------------ |
| `mode`                  | `prompt-compiler-paired`      | `prompt-compiler-ab`     |
| `route`                 | `river evolve prompt-compare` | `river evolve prompt-ab` |
| `sameRecordOnBothSides` | `true`                        | `false`                  |

加えて、dataset 側でも取り違えを止めます。

- `prompt-ab` は `sentPrompt: 'compiled'` の run が 0 件の dataset を受理しません（observe だけの集合を A/B として報告しない）
- `prompt-ab` は `sentPrompt: 'legacy'` の run が 0 件の dataset も受理しません（baseline の無い比較は candidate 単独の観測でしかない）
- `prompt-compare` は従来どおり compiled を送った run が 1 件でも混ざれば拒否する

## 2.1 LLM 応答の有無（findings 水準が観測できる条件）

`sentPrompt: 'compiled'` は「compiled を送った」を意味しません。[`src/prompt/compiler-stage.mjs`](../../src/prompt/compiler-stage.mjs) のコメントが明示するとおり、この値は mode から決まります。`src/lib/review-engine.mjs` の `skipReason` は dryRun / offline / provider 非対応 / API キー未設定で LLM 呼び出しを丸ごと飛ばします。その結果、`sentPrompt: 'compiled'` かつ応答が 1 バイトも無い run が正規経路から生まれます。

実測（保存済みレコードを読み直したもの）は次のとおりです。

```text
run-skipped {"llmUsed":false,"llmSkipped":"dry-run enabled","sentPrompt":"compiled"}
run-used    {"llmUsed":true,"llmSkipped":null,"sentPrompt":"compiled"}
```

したがって findings 水準の観測可否は `sentPrompt` ではなく `debug.llmUsed` で決めます。条件は「**両側とも** `llmUsed === true` の run を持つ case が 1 件以上あること」です。片側だけ応答がある case は数えません。差分が構成の違いではなく、応答の有無そのものになるためです。

`llmUsed` を持たない古いレコードは `false`（応答が無かった）と区別して `llmUnknownRunCount` に数えます。未取得を「応答があった」とは読みません。

充足度は `llmResponseCoverage` として成果物と Markdown の冒頭に出します。応答が無い場合は次のようになります。

- `findingComparison.observable` が `false`
- `criticalRegressionCount` / `criticalRegressionZero` が `null`（`0` でも `false` でもない）
- `PROMPT_AB_ACCEPTANCE_COVERAGE` の `critical 回帰` 行も `observable: false` へ下がる

`token（送信前のプロンプト推定長）` は応答が無くても測れるので下げません。全面拒否にすると測れる部分まで捨てることになります。

なお `isLlmlessEmptyReview`（`src/cli/render.mjs`）は再利用していません。あれは (a) runner の result 形を取り、(b) `llmSkipped` が `/not set/i` に一致する「API キー未設定」だけを対象にし、(c) findings 0 件との複合判定です。dryRun / offline の run では `false` を返すため、ここで必要な判定とは意味論が異なります。新しい述語も足さず、review-engine が書いた `llmUsed` をそのまま読みます。

## 3. 2 系統の対応付け

`deriveCaseKey`（`src/lib/paired-replay.mjs`）を再利用します。新しい導出は書きません。case key は明示 `caseId`、無ければ `reviewedTarget@mergeBase` です。両側の case key の交差が空なら受理しません。

## 4. Experiment Manifest が pin する条件

`buildExperimentManifest`（契約3）へそのまま流します。run ごとに値が割れる場合は受理せず、割れた項目名を挙げて止めます。

| 条件         | pin の方法                                  |
| ------------ | ------------------------------------------- |
| 同一 fixture | case key の交差 + `dataset.datasetHash`     |
| 同一モデル   | `provider` / `model` の単一値検査           |
| 同一 profile | `profileId` / `profileVersion` の単一値検査 |
| 同一 context | `phase` / `reviewMode` の単一値検査         |
| compiler 版  | `compilerVersion` の単一値検査              |

pin できない条件は成果物の `unpinnedConditions` に出します。選択された skill の一覧は run レコードに保存されていないため、同一性は phase / reviewMode と case key から間接的にしか担保できません。

推定長の合計は `pairedCaseKeys` に属する run だけを足します（`promptMetrics.estimateScope: 'paired-case'`）。両側の run 数が違う集合で全 run を足すと、差はプロンプト長の差ではなく母集団サイズの差になります。対になった run 数が両側で一致しない場合は `estimateDeltaTotal` を `null` にし、`estimateDeltaUnavailableReason` に理由を入れます。

## 5. 何が測れて何が測れないか

`PROMPT_AB_ACCEPTANCE_COVERAGE` が ADR-006 の 9 指標を 1 行ずつ持ちます。2 系統が揃っても、この経路だけで測れるのは 2 行です。

| Metric                              | 観測 | 残る条件                      |
| ----------------------------------- | ---- | ----------------------------- |
| `critical 回帰`                     | 可   | —                             |
| `token（送信前のプロンプト推定長）` | 可   | —                             |
| `should-detect recall`              | 不可 | ラベル付き fixture dataset    |
| `should-not-detect precision`       | 不可 | ラベル付き fixture dataset    |
| `parse 成功率`                      | 不可 | run レコードへの parse 結果   |
| `Evidence / Fix の充足`             | 不可 | findings 品質の評価器         |
| `invalid ArtifactRefs`              | 不可 | findings 品質の評価器         |
| `duplicate findings`                | 不可 | findings 品質の評価器         |
| `latency / cost`                    | 不可 | run レコードへの latency 記録 |

観測 `可` の 2 行を根拠に「段 2 を満たした」とは書けません。測っていない基準を満たしたものとして読ませないために、表を落とさず残しています。

`critical 回帰` の `可` は dataset 依存です。両側に LLM 応答を持つ run が揃った case を欠く dataset では、`resolveAbAcceptanceCoverage()` が `不可` へ下げます。`token` の行は応答の有無に依存しません。

## 6. CLI

```bash
river evolve prompt-ab [<path>] [--output json|text]
```

読み取り専用です。`.river/runs` の保存済みレコードだけを読みます。レビューの再実行と provider 呼び出しは行いません。

| 状況                                                        | exit code |
| ----------------------------------------------------------- | --------- |
| 正常終了（critical 回帰を観測した場合も含む）               | 0         |
| 観測を持つ run が 0 件                                      | 1         |
| compiled を送った run が 0 件 / legacy を送った run が 0 件 | 1         |
| provider / model / profile / phase / reviewMode が割れる    | 1         |
| 両側に共通の case が無い                                    | 1         |
| パスが存在しない                                            | 1         |

critical 回帰を観測しても exit 0 です。本経路は人の判断材料を出すだけであり、gate ではありません。

## 7. 非ゴール

automatic canary、自動 Keep / Rollback、自動昇格は扱いません。`src/lib/paired-replay.mjs` 冒頭が #1574 の採否コメントで確定した非ゴールとして記録しており、#1880 はこれを変更しません。成果物の `decision` は常に `null`、`applied` は常に `false` です。

## 8. ファイル配置

| ファイル                             | 役割                                                     |
| ------------------------------------ | -------------------------------------------------------- |
| `src/lib/prompt-compiler-paired.mjs` | 2 系統の切り分け・spec 生成・観測可否の報告（純関数群）  |
| `src/lib/paired-replay.mjs`          | manifest 生成・突合・受入評価の SSoT。再実装しない       |
| `src/cli/commands/evolve.mjs`        | `river evolve prompt-ab` のハンドラ                      |
| `tests/prompt-compiler-ab.test.mjs`  | 2 系統の組成・取り違え防止・manifest pin・決定論のテスト |
