# ADR-007: Semantic Precision Pass—Finding Adjudicator の責務境界

## Status

Accepted—High-Recall で集めた candidate finding を意味判断で絞る層について、責務境界と語彙と fail-safe を実装着手前に確定させます。実装は #1857 の Phase 1 以降で行います。

## Context

現行のレビュー主経路は、reviewer が出した candidate finding を決定論の検査で削り、残りをそのまま Gate へ渡す形になっています。「契約を満たすか」は検査していますが、「今回の変更で本当に止めるべきか」を独立に判定する層はありません。

### finding が落ちる 6 段

`main` `686b4d19` の実装で、finding は次の 6 段で減ります。

| #   | 段                                    | 実装位置                                                                              | 観測フィールド                             |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | フォーマット検証                      | [`src/lib/review-engine.mjs`](../../src/lib/review-engine.mjs) `:511-533`             | `debug.droppedInvalidFindings`             |
| 2   | ロール間 dedupe（`--reviewers` 経路） | [`src/lib/reviewer-orchestrator.mjs`](../../src/lib/reviewer-orchestrator.mjs) `:774` | `debug.deduplicatedCount`（`:847` で算出） |
| 3   | Verifier                              | [`src/lib/verifier.mjs`](../../src/lib/verifier.mjs) `:270`                           | `verifierStats` / `verifierRejected`       |
| 4   | 生成物パス除外                        | `src/lib/review-engine.mjs` `:706-721`                                                | `debug.suppressedGeneratedPathFindings`    |
| 5   | `classifyFindings`                    | [`src/lib/finding-factory.mjs`](../../src/lib/finding-factory.mjs) `:443-495`         | `classified.suppressed[].suppressReason`   |
| 6   | Riverbed Memory suppression           | [`src/lib/suppression-apply.mjs`](../../src/lib/suppression-apply.mjs) `:88`          | `debug.suppressionsApplied`                |

段 2 は理由コードを持たず、件数だけを記録します。

### 段 5 の抑制は Gate に効いていない

Issue #1857 本文の Gap 図は `classifyFindings / dedupe` を Gate の上流に置いていますが、Gate 入力という意味では実態と異なります。

`deriveRunGate` が読むのは `result.findings`（`src/lib/run-gate.mjs:76`）であり、`blockingFindings` はそこから critical と major を数えた値です（`:84-86`）。その `result.findings` は [`src/lib/local-runner.mjs`](../../src/lib/local-runner.mjs) `:634` の `keptFindings` であり、`applySuppressions`（`:575`）を通した集合、すなわち**段 6 だけを引いた集合**です。

段 5 の結果は `:636` の `classified` として別に返され、消費先は描画と run record にとどまります。生成側も同じ形で、`generateReview` は分類前の `findings` と `classified` を並べて返します（`src/lib/review-engine.mjs:764-769`）。

つまり段 5 は表示上の抑制であって、Gate 判定からは何も引いていません。Phase 1 で `prefilterFindings` と `rankFindingsForOutput` へ分ける方針は、この実態と整合します。

### 現行の抑制理由と提案 reasonCode の対応

`SUPPRESS_REASONS`（`src/lib/finding-factory.mjs:34-40`）は 5 値です。#1857 が提案した reasonCode 語彙との対応は次のとおりで、対応が付かない方向が両側にあります。

| 提案 reasonCode             | 現行の対応物                                                        | 判定                             |
| --------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| `confirmed_material_risk`   | なし（「残った」ことを表す肯定コードが無い）                        | なし                             |
| `valid_but_advisory`        | なし                                                                | なし                             |
| `duplicate`                 | `SUPPRESS_REASONS.DUPLICATE` / `mergeFindings`（無名）              | 一部（2 経路に分散、1 つは無名） |
| `out_of_scope`              | `scope: 'pre-existing'` / `isGeneratedArtifactPath` / feedback の値 | 一部（3 系統に分裂）             |
| `already_handled`           | なし                                                                | なし                             |
| `style_preference`          | `SUPPRESS_REASONS.STYLE_ONLY`                                       | 対応                             |
| `insufficient_evidence`     | `SUPPRESS_REASONS.INSUFFICIENT_EVIDENCE` / verifier の証跡検査      | 対応（2 段に分散）               |
| `low_actionability`         | verifier の `suggestionActionable`                                  | 一部（suppress でなく reject）   |
| `pre_existing_non_blocking` | `scope` は算出するが抑制も減点もしない（`verifier.mjs:305-306`）    | 一部（観測のみ）                 |
| `static_analysis_candidate` | なし                                                                | なし                             |

逆向き、つまり現行にあって提案語彙に無いものが 2 件あります。

- `SUPPRESS_REASONS.LOW_CONFIDENCE`（`finding-factory.mjs:452` で付与）に対応する提案コードが無い
- 表示上限の超過（`finding-factory.mjs:490`）に対応する提案コードが無い

後者は `COVERED_BY_HIGHER_LEVEL` が担っていますが、同じコードが「同一 ruleId の重複だから落とした」（`:485`）と「overview の表示上限に溢れた」（`:490`）の 2 つを表しています。現状この 2 つは分離できません。

### `reasonCode` という名前は先約がある

`reasonCode` はフラット名がすでに Gate 判定で使われています（`src/lib/gate-decision.mjs:307`、`src/lib/deterministic-command-executor.mjs:45-51`）。さらに [`src/lib/runs-digest.mjs`](../../src/lib/runs-digest.mjs) `:54` が `r.gate.reasonCode` を集計しています。finding へ直接 `reasonCode` を生やす案は採れません。

### 実データの状況

保存済みの run は 6 件で、`debug` を持つものは 0 件、`gate` を持つものも 0 件です。findings は合計 6 件で、いずれも `LLM: dry-run enabled` または `LLM: offline (rules-only) mode enabled` を証跡に持つ fallback です。LLM を通った finding は 0 件でした。

feedback は 43 件で、内訳は `accepted` 30、`false_positive` 9、`out_of_scope` 3、`not_actionable` 1 です。`findingFingerprint` が非 null のものは 1 件、`review_run_id` に相当するキーを持つものは 0 件で、run と join できる行はありません。語彙自体は 8 値が実在します（[`src/lib/feedback.mjs`](../../src/lib/feedback.mjs) `:12-25`）。

## Decision

### 責務境界

Semantic Precision Pass は Judge であり、Reviewer ではありません。3 つの軸を混ぜません。

| 軸            | 意味                             | 決める主体                  |
| ------------- | -------------------------------- | --------------------------- |
| `severity`    | 問題が存在した場合の影響の大きさ | Reviewer と Verifier        |
| `confidence`  | 問題が存在する確からしさ         | Reviewer                    |
| `disposition` | レビューシステムとしてどう扱うか | 決定論の prefilter と Judge |

`Must` / `More` / `Skip` のような第 4 の語彙を持ち込みません。

### Judge は新規 finding を生成しない

入力の `findings[N]` に対し `judgments[N]` を返します。ID の追加、削除、併合を Judge には許しません。未知の finding ID を含む応答、および件数が一致しない応答は schema 不正として扱います。

Reviewer が発見し、Judge が判定する。この分業を v1 の不変条件とします。

### reasonCode は閉じた語彙とし、産出者を分ける

語彙は列挙値に固定し、自由文の rationale を Gate の判定条件にしません。そのうえで、前掲の「逆向きの欠落 2 件」を次のように扱います。

- **`low_confidence` は語彙へ追加する。ただし決定論の prefilter 専用コードとし、Judge には出させない。** confidence は Judge が判定する軸ではなく、Judge に出させると severity / confidence / disposition の分離が崩れます。既存の `SUPPRESS_REASONS.LOW_CONFIDENCE` を 1 対 1 で移送できる利点も残ります。`insufficient_evidence` へ寄せる案は採りません。証跡が短いことと確信度が低いことは別の事実であり、現行も別コードで区別しています。
- **表示上限の超過には reasonCode を与えない。** これは disposition ではなく ranking の結果です。したがって `COVERED_BY_HIGHER_LEVEL` は Phase 1 で 2 つに割り、重複側だけを `duplicate` へ寄せ、上限側は `rankFindingsForOutput` の出力として表現します。

各コードは、決定論の prefilter と Judge のどちらか一方だけが産出できるものとします。同じコードを両者が出せる状態にすると、監査時にどちらの層が落としたのかを追えなくなります。

### critical を LLM 単独で suppressed にしない

- critical から `blocking` への判定は許可します。
- critical から `advisory` への判定は許可しますが、human-review の対象として残します。
- **critical から `suppressed` への判定を、Judge の出力だけを根拠に成立させません。**

critical の抑制が成立するのは、次の監査可能な根拠がある場合に限ります。いずれも決定論で再現でき、Judge の応答が無くても同じ結論になるものです。

1. 決定論の重複判定（`mergeFindings` および `deduplicateWithinPR` / `deduplicateWithinFile` の結果）
2. 決定論のスコープ除外（`isGeneratedArtifactPath` による生成物パスの除外）
3. リポジトリに明示された suppression（Riverbed Memory の `applySuppressions`）

### Judge 失敗時は legacy findings をそのまま Gate へ渡す

provider の失敗、タイムアウト、schema 不正、未知の finding ID、judgment の欠落のいずれでも、findings を空にしません。Judge が結論を出せなかった場合の既定は「判定しなかった」であり、「問題なし」ではありません。

Precision Pass の障害が review bypass になってはならない、という制約を Gate 側の不変条件として置きます。fallback が発生した run は、その事実を記録したうえで Judge 導入前と同じ入力で Gate を通します。

### mode の語彙

設定キーは `review.adjudication.mode` とし、値は `off` / `observe` / `annotate` / `active` の 4 値です。既定は `off` です。

| モード     | 挙動                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| `off`      | Judge を呼ばない。現行と完全に同一である                                       |
| `observe`  | Judge を呼び、結果を `debug` へ記録する。emitted findings と Gate は不変である |
| `annotate` | judgment を Review Artifact と表示へ出す。Gate の判定方式は現行のままである    |
| `active`   | disposition を Gate の入力に用いる                                             |

**`shadow` は採りません。** ADR-006（[`docs/adr/006-model-aware-review-prompt-compiler.md`](./006-model-aware-review-prompt-compiler.md)）が `src/lib/shadow-aggregate.mjs` との二義を理由に不採用としており、その決定は `src/config/schema.mjs:51` の `z.enum(['off', 'observe', 'active'])` に理由コメント付きで固定されています。`review.*.mode` という同じ名前空間で同じ語に別の意味を与えることになります。

3 値ではなく 4 値にする理由は、#1857 の Phase 4 と Phase 5 が別の段だからです。judgment を出力に載せる段と、Gate の入力に使う段を 1 つの語で表せません。

第 3 の値を `advisory` と呼ぶ案は採りません。`advisory` は disposition の値としてすでに使う語であり、しかも `mode: advisory` は「すべての disposition を advisory へ降格する」ことを意味しません。`suppressed` の finding もこのモードでは出力に残るからです。同一機能の中で同じ語が 2 つの意味を持つことになり、ADR-006 が `shadow` を退けたのと同じ理由で退けます。`annotate` は「判定を注記として付けるが Gate は触らない」という挙動をそのまま表します。

`observe` の意味は ADR-006 と揃えますが、不変条件のうち「追加の LLM 呼び出しを発生させない」は本 ADR では成り立ちません。Prompt Compiler の候補プロンプトは送信せずに生成できるのに対し、Judge の判定は呼び出さなければ得られないためです。共有するのは「emitted findings と Gate と verdict へ影響しない」という点であり、コスト面での無害さは共有しません。この差は `observe` を有効化する判断の前提として扱います。

### 出力の置き場所

judgment は finding の下へネストします。

```json
{
  "id": "rr-17",
  "severity": "major",
  "confidence": "high",
  "judgment": {
    "disposition": "advisory",
    "reasonCode": "valid_but_advisory",
    "judge": "semantic-precision-pass"
  }
}
```

フラットな `finding.reasonCode` は採りません。前掲のとおり `gate.reasonCode` と衝突して読み取り側を誤らせます。

feedback へ同じ値を複製保存しません。既存の `review_run_id` と fingerprint から導出できる設計を優先します。

## Non-goals

- **Judge が新しい finding を発見すること。** 発見は Reviewer と Lens の責務であり、#1545 の範囲です。
- **fingerprint 仕様への変更。** fingerprint v1 / v2、feedback matching、近接行コメントの統合は #1823 の責務であり、本 ADR は触れません。
- **Review Artifact の version 変更。** `findings[]` への additive な追加にとどめ、v2 は導入しません。
- 新しい review framework 全体の追加。
- Context Collector の再実装。
- Reviewer と Lens の数を増やすこと。
- multi-run の集約、paired replay、canary、keep / roll-back / retire。これらは #1574 の範囲であり、本 ADR は単一 run 内の Precision Pass に限ります。
- Lens 単位の effectiveness 指標の再実装（#1667）。

## Consequences

- **Phase 0 のベースライン数値は、現時点の保存データからは計算できません。** 理由は 3 つあり、いずれも実測済みです。第一に LLM を通った finding が 0 件で、母数が fallback だけです。第二に run record 6 件のいずれにも `debug` が無く、`verifierStats` が保存されていません。第三に feedback と finding が join できず、precision と false-block と missed issue を原理的に算出できません。したがって Phase 0 の成果物は数値のベースラインではなく、指標定義と抽出コード、および母集団を作るための収集条件になります。
- **token と cost は「新 DB を作らない」方針を維持できません。** 保存先の問題ではなく取得コードが無いためです。`src/lib/llm-pipeline.mjs:121` は `json.choices?.[0]?.message?.content` だけを返し、provider が返す `usage` を破棄します。この 2 指標を観測するには `usage` の保持と呼び出し側の変更が要り、これは挙動変更なしという Phase 0 の前提を厳密には破ります。なお `finalSummary.tokenEstimate` は provider の実トークンではありません。suppressed / gate / feedback の分布については、既存の run record と feedback JSONL の読み取りで足ります。
- **`findings[]` へ `judgment` を足すには schema 変更が必須です。** [`schemas/review-artifact.schema.json`](../../schemas/review-artifact.schema.json) の `$defs.finding` は `additionalProperties: false` です（`:354`）。ADR-006 が使った `debug.execution` は `additionalProperties: true` でしたが、finding には同じ手が使えません。additive ではあるものの no-op ではなく、schema の更新を伴う PR が必要です。
- 段 5 が Gate に効いていない以上、Judge を Gate へ接続する段では「これまで表示上抑制されていた finding が Gate に載る」方向の変化が起こり得ます。`active` の評価では、Judge の精度とは別に、この経路差そのものを回帰として観測します。
- `low_confidence` を prefilter 専用コードとしたため、Judge の語彙と決定論の語彙は同じ列挙の部分集合になります。どちらの層が産出したのかを記録に残す必要があり、`judgment.judge` に加えて産出層を識別できる情報が要ります。
- 既定を `off` から動かしません。`annotate` と `active` は opt-in です。

### 着手条件と再参入条件

段を進める条件を、検証可能な形で次のように置きます。

**`observe` を有効化する条件**

1. provider の API キーが登録され、LLM を通った run を産めることです。**これは代行できない人間作業であり、現時点で未完了です。** この 1 点が未達である間、`observe` 以降のすべての評価は開始できません。
2. run record に `debug` が保存される経路が確認できていることです。現状 6 件すべてに `debug` が無く、記録しても読めない状態です。
3. `covered_by_higher_level_finding` が重複と表示上限に分離されていることです。分離前は suppressed の内訳を数えても 2 つの事象が混ざります。

**`annotate` へ進む条件**

1. `schemas/review-artifact.schema.json` の `$defs.finding` へ `judgment` が追加され、既存 Artifact が引き続き検証を通ることです。
2. `observe` の run で、Judge が `findings[N]` と同数の judgment を返したことを確認できることです。件数不一致と未知 ID の 2 つの失敗形が、fallback として記録されることを含みます。
3. critical に対する `suppressed` が、決定論の 3 根拠を伴わない形で 1 件も出ていないことです。

**`active` へ進む条件**

1. feedback と finding が join できることです。現状 43 件中 0 件であり、`--fingerprint` と run id の記録が運用として定着している必要があります。
2. 1 が満たされたうえで、blocking precision と false-block rate を同一母集団で算出できることです。
3. critical の false-negative が 0 であることを、`must-not-suppress` の fixture で機械的に確認できることです。
4. fallback 率が測れており、Judge の失敗時に legacy findings が Gate へ渡ることを回帰テストで固定してあることです。

`active` を既定にすることは、上記を満たしたうえで別途検討します。本 ADR では決めません。

## 関連

- #1857—Semantic Precision Pass / Finding Adjudicator（本 ADR の起点）
- #1545—Reviewer Lens Architecture（発見側の責務）
- #1568—Judgment Promotion Loop（反復する judgment の昇格先）
- #1574—Review Evolution Cycle（multi-run の集約と受入基準）
- #1823—fingerprint follow-up（本 ADR では変更しない）
- ADR-006—Model-Aware Review Prompt Compiler（`mode` 語彙と二段の受入基準の先例）
