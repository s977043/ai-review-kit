# ADR-006: Model-Aware Review Prompt Compiler—Review Judgment と Prompt Rendering の分離

## Status

Accepted—レビュー用プロンプトの組み立てを「何を判断するか」と「選ばれたモデルへどう頼むか」の 2 層に分ける設計と、その初回導入範囲を記録します。

## Context

現行のレビュー用プロンプトは [`src/lib/review-engine.mjs`](../../src/lib/review-engine.mjs) の `buildPrompt`（`:180`）に集約されています。単一のテンプレート文字列であり、呼び出し箇所は同ファイル `:403` の 1 箇所だけです。出力契約・severity 語彙・証跡の必須項目・件数上限が、すべて同じ文字列の中に並んでいます。

このため次の 2 つが構造的に分離できていません。

- レビュー判断そのもの（どのスキルで何を見るか、どの severity で扱うか）
- 選ばれたモデルへの依頼形式（節の順序、指示の粒度、system と user の切り分け）

モデルや provider を変えたときに調整したいのは後者だけであるものの、現状はテンプレート全体を触ることになり、判断側へ意図せず影響が及ぶ余地は残ります。

### provider の現状

`resolveOpenAIConfig`（`src/lib/review-engine.mjs:80`）は `config.model.provider` を読み、既定値を `openai` としています。設定スキーマ側（[`src/config/schema.mjs`](../../src/config/schema.mjs) `:5`）は `google` / `openai` / `anthropic` の 3 値を受け付けます。

ただしレビュー実行経路は `openai` 以外を受け付けません。`src/lib/review-engine.mjs:463-464` が `provider ... is not supported yet` として明示的に退避します。送信先も OpenAI 互換の chat completions エンドポイント 1 系統に固定されています。

multi-provider のクライアント実装（`GeminiClient` / `OpenAIClient` / `AnthropicClient`）は [`src/ai/factory.mjs`](../../src/ai/factory.mjs) に存在します。ただし、これを使うのは `src/core/skill-dispatcher.mjs` だけであり、レビュー実行経路とは別系統です。[`src/lib/llm-pipeline.mjs`](../../src/lib/llm-pipeline.mjs) `:12-16` も、この factory を統合対象外として明示的に線を引いています。

### modelHint との関係

スキルメタデータの `modelHint` は「どの程度強いモデルが必要か」を表し、スキルの決定論的な並べ替え（[`runners/core/review-runner.mjs`](../../runners/core/review-runner.mjs) `:174-209`）に使われます。本 ADR が扱うのは「選ばれたモデルへどう依頼するか」であり、両者は置き換え関係ではなく補完関係です。

## Decision

Review Request IR を挟み、モデル非依存の依頼内容と、モデル別の描画を分離します。

### 責務境界

| 層              | 責務                       |
| --------------- | -------------------------- |
| Skill           | 何を判断するか             |
| Context Engine  | どの証跡を渡すか           |
| Prompt Compiler | どう依頼するか             |
| Model Profile   | そのモデルがどう受け取るか |
| LLM Runtime     | provider をどう呼ぶか      |
| Review Artifact | 何が起きたか               |
| Eval            | 改善したか                 |

### Review Request IR

モデル非依存の内部契約として導入します。安定した公開 API とはしません。

保持する要素は次のとおりです。

- `subject`—phase / revision / changedFiles
- `judgment`—skillIds / severity
- `context`—diff / projectRules / memory / adrs / repoContext / prDescription
- `constraints`—maxFindings / evidenceRequired / fixRequired / noFabricatedRefs
- `outputContract`—format / language
- `execution`—provider / model / modelHint

### 不変条件

**Model Profile は Review Judgment を変更してはならない。** severity、GO / NO-GO、スキル選択、チームポリシーを profile 側に持たせません。

この条件は散文の申し合わせではなく、profile モジュールが判断系の値へ触れていないことを検証する不変条件テストで機械保証します。

### 実行モード

設定キーは `review.promptCompiler.mode` とし、値は `off` / `observe` / `active` の 3 値です。

| モード    | 挙動                                                                             |
| --------- | -------------------------------------------------------------------------------- |
| `off`     | 現行と完全に同一である                                                           |
| `observe` | 既存プロンプトで LLM を実行する。compiled 側は生成するが送信せず、計測値だけ残す |
| `active`  | compiled プロンプトで LLM を実行する                                             |

`shadow` という語は採用しません。[`src/lib/shadow-aggregate.mjs`](../../src/lib/shadow-aggregate.mjs) `:1` が「複数 Run の読み取り専用集約」を指す語として既に使っており、二義になるためです。

`observe` の不変条件は次のとおりです。

- 追加の LLM 呼び出しを発生させない
- candidate プロンプトを provider へ送らない
- 記録するのは hash と推定長と profile の来歴だけである
- diff 全文を debug へ複製しない

記録先は `debug.execution.promptCompiler` です。[`schemas/review-artifact.schema.json`](../../schemas/review-artifact.schema.json) の `debug.execution` は `additionalProperties` が真であるため、追記は互換であり Artifact の version を上げる必要はありません。

なお `debug.promptPreview`（`src/lib/review-engine.mjs:441`）は既に、`redactText` を通した先頭 N 文字を保存しています。本 ADR は新たな禁止を課すのではなく、compiler 側の記録もこの既存の扱いに揃えます。

### 初回導入範囲

初回は `generic` と OpenAI 互換の 2 profile に限定します。Anthropic / Google の profile は作りません。

理由は Context のとおり、レビュー実行経路が `openai` 以外を拒否するためです。いま 4 profile を用意しても、2 つは到達不能なコードになります。

### 受入基準の二段構成

受入基準は、送信前に測れるものと、LLM の応答を要するものへ明示的に分けます。

分けない場合、採否条件の充足が `active` の前提となり、`active` の稼働がその充足の前提にもなります。この循環は #1861 で実際に着手を止めました。

段の振り分けは散文の申し合わせではありません。出典は [`src/lib/prompt-compiler-paired.mjs`](../../src/lib/prompt-compiler-paired.mjs) の `ACCEPTANCE_COVERAGE`（`:106-165`）であり、全 9 行のうち `observable: true` の 1 行を段 1、`observable: false` の 8 行を段 2 とします。指標名も同配列の `metric` をそのまま使います。

#### 段 1—送信前に測れる（`observe` で足りる）

| Metric（`ACCEPTANCE_COVERAGE` の `metric`） | 観測経路                                                       |
| ------------------------------------------- | -------------------------------------------------------------- |
| `token（送信前のプロンプト推定長）`         | `observe` が legacy / compiled 双方の推定長を 1 run で記録する |

段 1 の判定条件は次のとおりです。

- `river evolve prompt-compare` が成功し、`promptMetrics` へ両側の推定長と差分が載ることである
- 推定長が増えた場合、その増分を profile の描画差として説明できることである
- 推定長が減った事実そのものは採用理由にならない（`promptMetrics.note` と同じ扱いである）

2 番目を閾値にしない理由は実測にあります。[`docs/development/1860-prompt-compiler-paired.md`](../development/1860-prompt-compiler-paired.md) `:24-27` の観測では、`legacyPromptEstimate` 800 に対し `compiledPromptEstimate` は 801 でした。差分ゼロを機械的な合格線にすると、この程度の描画差でも段 1 を通せません。

段 1 を満たした時点で、`active` を opt-in で有効化する作業へ進めるものとします。既定は `off` のままです。

#### 段 2—LLM の応答を要する（`active` 稼働後に測る）

| Metric（`ACCEPTANCE_COVERAGE` の `metric`） | 現時点で測れない理由                             |
| ------------------------------------------- | ------------------------------------------------ |
| `should-detect recall`                      | candidate 側の findings が存在しない             |
| `should-not-detect precision`               | candidate 側の findings が存在しない             |
| `parse 成功率`                              | compiled prompt に対する LLM 応答が無い          |
| `Evidence / Fix の充足`                     | 充足度を数える対象が存在しない                   |
| `invalid ArtifactRefs`                      | ArtifactRef の検査対象が存在しない               |
| `duplicate findings`                        | 重複を数える対象が存在しない                     |
| `critical 回帰`                             | 両側の run が同一のため差分 0 は未観測を意味する |
| `latency / cost`                            | compiled prompt を送っておらず計測対象が無い     |

段 2 を満たすまで、既定を `off` から動かしません。

#### 段 2 を測るために揃えるもの

段 2 は「いつか測る」ではなく、次の 4 つが揃った時点で測れます。

1. provider の API キーが repo secret へ登録されていることである。これは代行できない人間作業であり、現時点で未完了である
2. `active` が opt-in で配線され、`sentPrompt` が compiled の run を保存できることである（#1861 で完了。既定は `off` のままである）
3. 同一 fixture・同一モデル・同一 context で legacy 側の run が並存することである
4. その 2 系統を受け取る比較経路が存在することである（#1880 で `river evolve prompt-ab` として実装済み）。`river evolve prompt-compare` は従来どおり `sentPrompt` が legacy でない run を拒否するため、active の run は `prompt-ab` 側で扱う

1 が未完了である間、段 2 の評価は開始できません。2 と 4 は実装済みであり、残るのは 1 と、3 のデータを揃える運用です。

`prompt-ab` が観測できる範囲は `PROMPT_AB_ACCEPTANCE_COVERAGE`（同ファイル）が 1 行ずつ持ちます。2 系統が揃っても、この経路だけで測れるのは `critical 回帰` と `token（送信前のプロンプト推定長）` の 2 行です。残る 7 行には別の条件が要ります。recall / precision には正解ラベル付きの fixture dataset が必要です。parse 成功率・Evidence 充足・invalid ArtifactRefs・duplicate findings には findings 個々の評価器が必要です。latency / cost には run レコードへの記録が必要です。

## Non-goals

- 汎用のプロンプト最適化器
- モデルセレクタの置き換え
- LLM provider ランタイムの統合（別 Epic とする）
- 最新モデルの自動追従と既定値の自動更新
- Review Artifact v2 の導入
- 自動承認と自動マージ
- **canary と自動 rollback**

最後の項目は本 ADR で新たに除外するものではありません。[`src/lib/paired-replay.mjs`](../../src/lib/paired-replay.mjs) `:14-18` が、automatic canary / 自動 Keep-Rollback / 自動昇格を #1574 の採否コメントで確定した非ゴールとして記録しています。Prompt Compiler の導入はこの決定を変更しません。

## Consequences

- プロンプトの調整対象が profile に閉じるため、判断側へ波及しない
- 採否は「プロンプトが短くなったか」ではなく、recall / precision / parse 成功率 / 証跡の充足 / critical 回帰ゼロで判定する。これらは前掲の段 2 にあたる
- legacy と compiled の突合には、既存の Experiment Manifest（`src/lib/paired-replay.mjs`）を使う。突合と受入基準の評価は実装済みであり、追加で必要なのは同条件の run を 2 本産む導線だけである
- `src/prompt/**` は `runners/github-action/src/index.mjs` から `src/cli.mjs` 経由で辿られるため dist にバンドルされる。実装 PR では `npm run build:action` による dist 再ビルドが必要である
- `active` を既定にしない。既定は `off` のままとし、段 2 を満たした場合にのみ既定への昇格を検討する
- `active` の着手条件は「全 9 指標の充足」ではなく「段 1 の充足」へ変わる。#1861 は基準未充足を理由に止めず、opt-in の配線として着手できる
- 二段に分けても順序は逆転しない。段 2 の評価は `active` の稼働後であり、既定 `off` の解除条件も段 2 のままである

### 再参入条件

Anthropic / Google の profile は、次が成立した時点で追加を検討します。

1. レビュー実行経路が `openai` 以外の provider を実際に呼べる状態になっている
2. その provider について、legacy と compiled の paired 比較を同一 fixture で実施できる

## 関連

- #1574—Review Evolution Cycle（paired replay と受入基準の受け皿）
- #1760—Reviewer Identity（provider / model / profile / prompt version の来歴との接続候補）
