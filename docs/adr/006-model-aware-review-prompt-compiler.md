# ADR-006: Model-Aware Review Prompt Compiler—Review Judgment と Prompt Rendering の分離

## Status

Accepted—レビュー用プロンプトの組み立てを「何を判断するか」と「選ばれたモデルへどう頼むか」の 2 層に分ける設計と、その初回導入範囲を記録します。

## Context

現行のレビュー用プロンプトは [`src/lib/review-engine.mjs`](../../src/lib/review-engine.mjs) の `buildPrompt`（`:180`）に集約されています。単一のテンプレート文字列であり、呼び出し箇所は同ファイル `:417` の直前 1 箇所だけです。出力契約・severity 語彙・証跡の必須項目・件数上限が、すべて同じ文字列の中に並んでいます。

このため次の 2 つが構造的に分離できていません。

- レビュー判断そのもの（どのスキルで何を見るか、どの severity で扱うか）
- 選ばれたモデルへの依頼形式（節の順序、指示の粒度、system と user の切り分け）

モデルや provider を変えたときに調整したいのは後者だけですが、現状はテンプレート全体を触ることになり、判断側へ意図せず影響が及ぶ余地があります。

### provider の現状

`resolveOpenAIConfig`（`src/lib/review-engine.mjs:80`）は `config.model.provider` を読み、既定値を `openai` としています。設定スキーマ側（[`src/config/schema.mjs`](../../src/config/schema.mjs) `:5`）は `google` / `openai` / `anthropic` の 3 値を受け付けます。

ただしレビュー実行経路は `openai` 以外を受け付けません。`src/lib/review-engine.mjs:463-464` が `provider ... is not supported yet` として明示的に退避します。送信先も OpenAI 互換の chat completions エンドポイント 1 系統に固定されています。

multi-provider のクライアント実装（`GeminiClient` / `OpenAIClient` / `AnthropicClient`）は [`src/ai/factory.mjs`](../../src/ai/factory.mjs) に存在しますが、これを使うのは `src/core/skill-dispatcher.mjs` だけであり、レビュー実行経路とは別系統です。[`src/lib/llm-pipeline.mjs`](../../src/lib/llm-pipeline.mjs) `:12-16` も、この factory を統合対象外として明示的に線を引いています。

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
- 採否は「プロンプトが短くなったか」ではなく、recall / precision / parse 成功率 / 証跡の充足 / critical 回帰ゼロで判定する
- legacy と compiled の突合には、既存の Experiment Manifest（`src/lib/paired-replay.mjs`）を使う。突合と受入基準の評価は実装済みであり、追加で必要なのは同条件の run を 2 本産む導線だけである
- `src/prompt/**` は `runners/github-action/src/index.mjs` から `src/cli.mjs` 経由で辿られるため dist にバンドルされる。実装 PR では `npm run build:action` による dist 再ビルドが必要である
- `active` を既定にしません。既定は `off` のままとし、受入基準を満たした場合にのみ opt-in で有効化します

### 再参入条件

Anthropic / Google の profile は、次が成立した時点で追加を検討します。

1. レビュー実行経路が `openai` 以外の provider を実際に呼べる状態になっている
2. その provider について、legacy と compiled の paired 比較を同一 fixture で実施できる

## 関連

- #1574—Review Evolution Cycle（paired replay と受入基準の受け皿）
- #1760—Reviewer Identity（provider / model / profile / prompt version の来歴との接続候補）
