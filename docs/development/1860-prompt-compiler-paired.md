# legacy と compiled の paired 比較導線（ADR-006 / #1860）

> Status: 実装。設計の出典は [`docs/adr/006-model-aware-review-prompt-compiler.md`](../adr/006-model-aware-review-prompt-compiler.md)、突合機構の出典は [`docs/development/1574-p2-paired-replay.md`](./1574-p2-paired-replay.md) です。

## 1. 目的

`review.promptCompiler.mode = 'observe'` で走った run は、`debug.execution.promptCompiler` に観測を残します。本導線はその観測を legacy 側と compiled 側の 2 系統として取り出します。流し込む先は既存の Experiment Manifest（`src/lib/paired-replay.mjs`、#1574 P2）です。

突合と受入基準の評価は P2 が実装済みです。本導線はそれを再実装せず import します。

## 2. 2 系統をどう産むか（実測に基づく設計判断）

observe は 1 回の run で legacy と compiled の**両方の指紋**を同時に記録します。実測でも、保存済み run レコード 1 件が両側の hash と推定長を持つことを確認しました。

```console
$ node -e '...generateReview(observe) → buildRunRecord...'
{
  "promptCompiler": {
    "mode": "observe",
    "sentPrompt": "legacy",
    "compilerVersion": "1",
    "profileId": "openai-review-v1",
    "profileVersion": "1",
    "legacyPromptEstimate": 800,
    "compiledPromptEstimate": 801,
    "legacyPromptHash": "c5e6e71ea03447c2",
    "compiledPromptHash": "c26046546e05e2d6"
  }
}
```

したがってプロンプト水準の比較に 2 回の run は要りません。一方で compiled 側の findings は存在しません。observe は compiled prompt を provider へ送らないためです。

採った案は次のとおりです。

- LLM 応答を要しない指標（プロンプト指紋・推定トークン数）だけを paired へ流す
- 応答を要する指標は観測不可として明示し、`active` の配線（#1861）を解消条件として記録する
- compiled を送るテスト専用経路は作らない。本番経路へ active 相当の副作用が漏れる余地を持ち込まないためである

## 3. 両側に同じ run を置く理由

experiment spec の `baseline.runs` と `candidate.runs` は同じ run レコードです。compiled 側に findings が空のダミー run を置くと「compiled は何も検出しなかった」という、観測していない主張になります。

構成の差は `configId` だけが担います。この形にすると `buildPairedReplay` の activation check が次を返します。

| 判定                   | 値      | 意味                              |
| ---------------------- | ------- | --------------------------------- |
| `configurationDiffers` | `true`  | legacy と compiled は別構成である |
| `observedDifference`   | `false` | 出力差が観測できていない          |
| `verified`             | `false` | 変更経路が発火した証跡が無い      |

既存モジュールの「差分が無い replay を候補の証拠として読ませない」という判定が、そのままこの導線の状態を表します。

acceptance profile は宣言しません。findings 水準を観測できない状態で基準を宣言すると、差分 0 の paired diff が基準を満たしたものとして読まれます。

## 4. ADR-006 受入基準の観測可否

| Metric                      | 観測 | 理由                                              |
| --------------------------- | ---- | ------------------------------------------------- |
| should-detect recall        | 不可 | candidate 側の findings が無い                    |
| should-not-detect precision | 不可 | 同上                                              |
| parse 成功率                | 不可 | compiled への LLM 応答が無い                      |
| Evidence / Fix の充足       | 不可 | candidate 側の findings が無い                    |
| invalid ArtifactRefs        | 不可 | 検査対象が無い                                    |
| duplicate findings          | 不可 | 数える対象が無い                                  |
| critical 回帰               | 不可 | 差分 0 は「回帰が無い」ではなく「観測していない」 |
| token（送信前の推定長）     | 可   | observe が両側の推定長を 1 run で記録する         |
| latency / cost              | 不可 | compiled を送っていない                           |

観測不可の行は、`active` の run を突合できる経路が整った時点で解消します。`active` そのものは #1861 で配線済みですが、本導線は `sentPrompt` が legacy でない run を受け取らないため、その突合は別経路が担います。その別経路が `river evolve prompt-ab`（#1880）です。詳細は [1880-prompt-ab.md](./1880-prompt-ab.md) を参照してください。

## 5. ファイル配置

| ファイル                                | 役割                                                          |
| --------------------------------------- | ------------------------------------------------------------- |
| `src/lib/prompt-compiler-paired.mjs`    | 観測の抽出・spec 生成・観測可否の報告。I/O を持たない純関数群 |
| `src/lib/paired-replay.mjs`             | manifest 生成・突合・受入評価の SSoT。再実装しない            |
| `src/lib/shadow-aggregate.mjs`          | run id 導出の SSoT                                            |
| `src/lib/promotion-candidates.mjs`      | 文字列正規化の SSoT                                           |
| `src/cli/commands/evolve.mjs`           | `river evolve prompt-compare` のハンドラ                      |
| `tests/prompt-compiler-paired.test.mjs` | 本番経路との突合・観測可否・退化ケース・決定論のテスト        |

## 6. CLI

```bash
river evolve prompt-compare [<path>] [--output json|text]
```

読み取り専用です。`.river/runs` の保存済みレコードだけを読み、レビューの再実行も compiled prompt の送信も行いません。

| 状況                                           | exit code |
| ---------------------------------------------- | --------- |
| 正常終了                                       | 0         |
| 観測を持つ run が 0 件                         | 1         |
| profile / provider / model が run ごとに異なる | 1         |
| `sentPrompt` が legacy でない run が混ざる     | 1         |

最後の行は #1861 への安全弁です。compiled を実際に送った run は findings 水準で比較できるため、この導線ではなく `river evolve prompt-ab`（#1880）で扱います。黙って混ぜると、送信済みの run と未送信の run が 1 つの実験に畳まれます。#1880 はこの拒否を緩めず、2 系統を明示的に受け取る別の入口を足す形で解いています。

## 7. 非ゴール

automatic canary、自動 Keep / Rollback、自動昇格は扱いません。`src/lib/paired-replay.mjs` 冒頭が #1574 の採否コメントで確定した非ゴールとして記録しており、ADR-006 もこれを踏襲します。成果物の `decision` は常に `null`、`applied` は常に `false` です。
