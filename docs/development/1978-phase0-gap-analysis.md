# #1978 Phase 0—Gap Analysis / 責務境界の棚卸し

本ノートは Issue #1978（Evidence-Grounded Adversarial Review）の Phase 0 チェックリスト 6 項目に、実測で答えたものです。設計判断は下しません。判断に必要な事実を揃えることだけを目的とします。

コードは 1 行も変更していません。読んだ対象は次のとおりです。

- `src/lib/reviewer-orchestrator.mjs` / `src/lib/verifier.mjs` / `src/lib/review-engine.mjs`
- `src/lib/finding-factory.mjs` / `src/lib/result-store.mjs`
- `schemas/review-artifact.schema.json` / `schemas/output.schema.json`
- `skills/midstream/independent-review-synthesis/SKILL.md`
- `skills/agent-skills/adversarial-review/SKILL.md`
- `docs/ai/generate-review-revise-loop.md`
- `docs/adr/007-semantic-precision-pass.md` / `docs/adr/008-actionability-axis-absorbed-into-disposition.md`
- Issue #1150 / #1545 / #1574 / #1814

測定日は 2026-08-26（JST）、基点コミットは `fe79c4ce` です。

## 0. 要旨

- `scope` は語が衝突する。同じキーへ 2 つ目の値語彙を載せてはならない
- `verdict` / `action` の 2 語には既存の相当物が無く、新規である
- final status 6 値のうち 4 値は `validatedStatus` の既存 enum で表現できる
- `validatedStatus` は schema に宣言だけがあり、`src/**` に生成者が 1 つも無い
- 本文が挙げる pre-verification 6 例のうち 4 例は `verifier.mjs` に実装済みである
- 本文の Step 2 → Step 3 の順序は、現行実装の順序と逆である
- `critic` という語は `src/**` `schemas/**` `skills/**` `tests/**` に 1 件も存在しない
- Phase 2 は本リポジトリでは実行不可であり、Phase 3 以降は構造的にブロックされる

## 1. 語彙の重複表

### 1.1 対応表

| #1978 の提案                                            | 既存に相当するもの                                     | ファイル:行                                                                                                     | 判定                                                             |
| ------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `verdict: AGREE / DISAGREE_EVIDENCE / DISAGREE_CONCERN` | 該当なし。`deriveVerdict` の run 単位 verdict は別概念 | `docs/ai/generate-review-revise-loop.md:19`                                                                     | 新規。ただし `verdict` という語は run 単位で先約あり             |
| `action: KEEP / REVISE / WITHDRAW`                      | 該当なし                                               | —                                                                                                               | 新規                                                             |
| `scope: IN_SCOPE / SCOPE_UNCERTAIN / OUT_OF_SCOPE`      | `scope: in-diff / pre-existing`（#1644）               | `src/lib/finding-factory.mjs:24` / `schemas/output.schema.json:118` / `schemas/review-artifact.schema.json:424` | **語が衝突している。後述 1.2 を参照**                            |
| final status 6 値                                       | `validatedStatus` 4 値                                 | `schemas/review-artifact.schema.json:455`                                                                       | 一部重複。後述 1.3 を参照                                        |
| final status の一部                                     | `status: open / suppressed / verified`                 | `schemas/review-artifact.schema.json:406`                                                                       | 別軸（ライフサイクル）。混ぜてはならない                         |
| final status の一部                                     | `disposition: blocking / advisory / suppressed`        | `docs/adr/007-semantic-precision-pass.md:46`                                                                    | 別軸（システムとしての扱い方）。finding フィールドとしては未実装 |
| `validation.*` の `evidence_refs`                       | `evidence`（string 配列）                              | `schemas/review-artifact.schema.json:411`                                                                       | 重複。既存で表現可能                                             |
| `validation.*` の `scope_status`                        | `scope`                                                | 上記 `scope` の行と同じ                                                                                         | 重複かつ語衝突                                                   |
| `validation.*` の `critic.reviewer`                     | `agreement[]` / `reviewer` / `sourceKind`              | `schemas/review-artifact.schema.json:444` / `:416` / `:439`                                                     | 一部重複。provenance は既存で表現可能                            |
| `validation.rounds`                                     | 該当なし                                               | —                                                                                                               | 新規                                                             |
| `validation.protocol`                                   | 該当なし                                               | —                                                                                                               | 新規                                                             |
| （対応なし）                                            | `consensusLevel: single / multi / consensus`           | `schemas/review-artifact.schema.json:450`                                                                       | 既存のみ。#1978 は置き換えを提案していない                       |

補足を 1 つ加えます。`agreement` をめぐる #1978 の設計原則 1（Consensus ≠ Correctness）は、既存契約と一致します。`schemas/review-artifact.schema.json:446` は「Synthesis layers MUST NOT use this for majority-vote decisions」と明記します。`:453` も `consensusLevel` を display-only と定めます。したがって原則 1 は新規要件ではなく、既存契約の再確認です。

### 1.2 `scope` の語衝突（判定: 衝突する）

衝突すると判定します。根拠は 4 つです。

1. `scope` は同一キー名で、既に出荷済みの値語彙を持つ。`schemas/output.schema.json:118` と `schemas/review-artifact.schema.json:424` の双方が `"enum": ["in-diff", "pre-existing"]` を宣言する
2. 自己申告ラベルの文法まで値で制約されている。`src/lib/finding-factory.mjs:103-104` の `RE_SCOPE_LABEL` は `SCOPE_VALUE_PATTERN`（`:102` の `in[-_ ]?diff|pre[-_ ]?existing`）を埋め込む。`IN_SCOPE` を同じ `Scope:` ラベルへ載せると、この正規表現の値語彙を広げる必要がある
3. 語彙を広げると既知の事故が再発する。`src/lib/finding-factory.mjs:95-101` のコメントは、無制約な `Scope:` をラベル集合へ入れると散文中の同語が直前の Evidence / Fix の取り込みを打ち切ると記録している
4. fail-safe の向きが両立しない。既存 `scope` の不明値は `in-diff` へ倒れる（`src/lib/finding-factory.mjs:24` / `normalizeScope` `:348-364`）。これは「降格させない」向きである。一方 #1978 の `OUT_OF_SCOPE` は revision instruction から外す、すなわち降格の向きである。同じキーで 2 つの向きは持てない

さらに `normalizeScope`（`src/lib/finding-factory.mjs:348`）は既定 `in-diff` を返すため、`IN_SCOPE` という文字列を渡しても静かに `in-diff` になります。型エラーにはなりません。これは検知できない誤変換であり、衝突の実害です。

#### ADR-008 の判断枠組みの適用

`docs/adr/008-actionability-axis-absorbed-into-disposition.md` は `actionability` の扱いを決めた ADR です。同名の先約（`schemas/output.schema.json:143` の 0-1 数値）を理由に新軸を作らず、既存 `disposition` へ吸収しました（同 `:32` / `:34` / `:67`）。その本文 `:34` は「同名で文字列 enum を足すと、同じキーの型が消費者ごとに変わります」と述べます。

同じ枠組みを `scope` へ適用すると、次の 3 問になります。

| ADR-008 の問い               | #1978 の `scope` への回答                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 同名の先約があるか           | ある。`in-diff / pre-existing`（#1644、v1.87.x 系で出荷済み）                                                     |
| 提案値は既存軸の真部分集合か | いいえ。`IN_SCOPE` は「元の依頼に対する欠陥か」を問い、`in-diff` は「追加行由来か」を問う。母集団も判定主体も違う |
| 直交性は成り立つか           | 成り立つ。`in-diff` かつ `OUT_OF_SCOPE`（追加行にあるが依頼外の改善提案）は自己矛盾しない                         |

ADR-008 で `actionability` が吸収されたのは、真部分集合であり直交しなかったためです（同 `:69` / `:79`）。`scope` は逆で、意味が異なり直交します。したがって「吸収する」という結論はここでは導けません。ADR-008 の枠組みが導くのは、**別概念であるなら別の名前を与える**という側の結論です。

#### 代替名の提案

| 候補                                            | 長所                                                                                                                                  | 短所                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `askRelevance: in-ask / uncertain / out-of-ask` | 「元の依頼（original ask）に対する関連性」という意味が名前に出る。#1978 の Scope Guard 設計節が入力に挙げる `original ask` と語が揃う | 新語である                                                     |
| `relevance: relevant / uncertain / irrelevant`  | 短い                                                                                                                                  | 意味が広く、severity や confidence と混同されうる              |
| `changeRelevance`                               | 依頼と変更の両方を含意する                                                                                                            | 長い                                                           |
| `scopeStatus`                                   | 元の提案 `validation.scope_status` に近い                                                                                             | `scope` と接頭辞が同じで、読み手が同一軸と誤解する。推奨しない |

推奨は `askRelevance` です。値語彙もハイフン小文字（`in-ask` / `uncertain` / `out-of-ask`）へ揃えます。理由は、既存 finding フィールドの enum が全てハイフン小文字だからです（`scope` は `in-diff`、`validatedStatus` は `dismissed-hallucination`、`consensusLevel` は `single`）。`IN_SCOPE` のような大文字スネークは本リポジトリの finding schema に前例がありません。LLM プロンプト内部の語として大文字を使う場合でも、schema へ書く前に正規化する層が要ります。

### 1.3 final status 6 値の対応

| #1978 の値              | 既存 `validatedStatus`                         | 判定                                                                     |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `confirmed`             | `confirmed`                                    | 完全一致                                                                 |
| `withdrawn-by-reviewer` | 該当なし                                       | 新規                                                                     |
| `dismissed-by-evidence` | `dismissed-hallucination` が近いが同一ではない | 一部重複                                                                 |
| `needs-human-judgment`  | `needs-human-judgment`                         | 完全一致                                                                 |
| `out-of-scope`          | 該当なし                                       | 新規。ただし 1.2 の軸と重なるため、status ではなく関連性軸で表すべき候補 |
| `critic-timeout`        | 該当なし                                       | 新規                                                                     |
| （対応なし）            | `dismissed-duplicate`                          | 既存のみ。`mergeFindings` の dedup 経路と対応する                        |

`dismissed-hallucination` と `dismissed-by-evidence` の差は次のとおりです。前者は `skills/midstream/independent-review-synthesis/SKILL.md:84-86` のとおり「evidence の参照先が実在しない」場合です。後者は #1978 Step 4 のとおり「実在するが Critic が反証コードを示した」場合です。実在性と正しさは別の問いであり、既存 enum に後者の受け皿はありません。

### 1.4 宣言だけがあり生成者が無い（最重要の実測）

`validatedStatus` を `git grep` した結果、`src/**` に出現は 0 件でした。出現するのは次の 3 箇所だけです。

- `schemas/review-artifact.schema.json:455`（宣言）
- `skills/midstream/independent-review-synthesis/SKILL.md`（`:78` `:86` `:92` `:100` `:109` `:116` `:117` `:118` `:132` の 9 箇所、プロンプト内の指示）
- `tests/review-artifact-schema.test.mjs:172` `:211` `:223`（schema 自身の検証）

`sourceKind` も同じ形です。`schemas/review-artifact.schema.json:439` が宣言し、`src/**` に生成者はありません。

つまり `validatedStatus` は「LLM が SKILL.md の指示に従って出力すれば schema が受け入れる」状態であり、決定論のコードが値を付ける経路はありません。#1978 が「既存語彙を再利用する」と書くとき、再利用先は実装ではなくプロンプト規約です。この違いは Phase 1 の作り方を変えます。既存関数へ import すべき SSoT は `validatedStatus` については存在しません。

一方 `scope` は逆で、決定論の生成者があります（`src/lib/verifier.mjs:218` `determineScopeFromDiff` / `:246` `resolveFindingScope`、呼び出しは `src/lib/review-engine.mjs:310`）。同じ `scope` という語でも、2 つの軸は成熟度が違います。

## 2. `independent-review-synthesis` との責務重複

`skills/midstream/independent-review-synthesis/SKILL.md` の Rule 節（`:61-101`）を規則単位で分解します。#1978 本文は「evidence 検証ルールを再利用候補」とだけ書き、どの規則かを特定していません。特定した結果は次のとおりです。

| 規則                        | 行         | 内容                                                                                          | #1978 との関係                                                                                                                                       |
| --------------------------- | ---------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule 1 Collect              | `:63-65`   | reviewer ごとに finding を収集し provenance を付与                                            | 別責務。#1978 は merge 後の単一 finding 集合を入力にする                                                                                             |
| Rule 2 Deduplicate          | `:67-74`   | file + 行±2 + evidence 先頭 80 字の編集距離 ≤10                                               | 別責務。`mergeFindings`（`src/lib/reviewer-orchestrator.mjs:542`）と重複する第 2 実装。#1978 は前段の merge を再利用する方針なので、こちらは使わない |
| Rule 3 Agreement annotation | `:76-78`   | `agreement[]` を付与し severity 決定には使わない                                              | **再利用可能。#1978 の設計原則 1 と同一**                                                                                                            |
| Rule 4 Verification         | `:80-86`   | evidence の file path 実在確認、code snippet の grep 一致、不一致は `dismissed-hallucination` | **再利用候補の本体。ただし後述のとおり半分は verifier.mjs に実装済み**                                                                               |
| Rule 5 Severity             | `:88-92`   | evidence が揃えば元 severity を尊重、不足なら上限 `major`                                     | **再利用可能。#1978 の設計原則 2（Evidence > Confidence）の具体化であり、本文には対応する規則が無い**                                                |
| Rule 6 Merge recommendation | `:94-100`  | `merge-ready` / `human-review` / `block` を emit                                              | 別責務。run 単位 verdict であり、finding 単位の #1978 とは層が違う                                                                                   |
| False-positive guards       | `:55-59`   | 全入力が空なら silent skip にしない、parse 不能なら loud-fail、単一 reviewer は degraded mode | **再利用可能。#1978 の fixture 13（critic timeout）/ 14（parse failure）と同型の要求**                                                               |
| Human Handoff               | `:130-134` | `needs-human-judgment` が 1 件以上、severity 乖離、解釈が分かれる場合                         | **再利用可能。#1978 の Step 6 escape 条件と重なる**                                                                                                  |

再利用可能と判定したのは Rule 3 / Rule 5 / False-positive guards / Human Handoff の 4 つです。別責務と判定したのは Rule 1 / Rule 2 / Rule 6 の 3 つです。Rule 4 は次節のとおり分割されます。

Rule 4 の内訳を分けると、次のようになります。

- 「evidence の file path が diff に存在するか」は `src/lib/verifier.mjs:106` `checkEvidenceInDiff` として決定論で実装済みである。再実装は不要
- 「evidence の code snippet が当該ファイルに grep で見つかるか」は未実装である。verifier は path の照合までしか行わない（`:112-133`）
- 「不一致を `dismissed-hallucination` に分類する」は未実装である。verifier は `verified: false` と `reasons` を返すだけで、status 語彙を付けない（`:312-320`）

したがって #1978 が Phase 1 で書くべき規則は、Rule 4 の 2 番目と 3 番目だけです。1 番目を書き直すと「Import the SSoT, never re-derive it」に該当します。

## 3. `adversarial-review` Skill との境界

### 3.1 本文の主張の検証

本文は `adversarial-review` を「Artifact への攻撃的 Lens であり review-of-review とは別責務」と主張します。SKILL.md を読んだ結果、**この主張は正しい**と判定します。根拠は次の 3 点です。

1. 入力が artifact であり、review artifact ではない。frontmatter の `inputContext` は `[diff, fullFile]` である（`skills/agent-skills/adversarial-review/SKILL.md:18`）。findings を入力に取る宣言は無い
2. 6 手法すべての「核心の問い」が artifact を対象とする。`:50-55` と `:58-62` の 2 表は、対象を「失敗シナリオ」「攻撃経路」「論理の穴」「宣言と実装の乖離」「完了主張の反証」「caller 側残骸」と定める。いずれも finding を対象としない
3. 本 skill は entry / routing skill である。`:74-81` の 6 個の下位 skill id へ振り分ける。6 個は `pre-mortem` / `war-game` / `logic-torturing` / `self-contradiction` / `refactor-claim-audit` / `cross-file-leakage` であり、いずれも `skills/` 配下に実在する

ただし部分的な近接が 1 つあります。`refactor-claim-audit`（`:76`）の核心の問いは「『全部やった』を grep で反証できるか」であり、**主張に対して反証コードを探す**という #1978 の `DISAGREE_EVIDENCE` と同型の動作です。対象が「PR の完了主張」か「reviewer の finding」かだけが違います。Phase 1 のプロンプト設計では、この skill の反証手順を参照する価値があります。責務は別のままです。

### 3.2 名前衝突の実測

`skills/**/SKILL.md` の frontmatter `id` を全件列挙し（129 件）、候補 3 つと突き合わせました。

| 候補                       | 既存 id との完全一致 | 近接する既存 id                                                                                                                                                 |
| -------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finding-critic`           | 無し                 | 無し。`critic` を含む skill id は 0 件                                                                                                                          |
| `review-validation`        | 無し                 | `review-criteria-integrity` / `review-automation-boundary` / `review-comment-triage` / `review-policy-standard-{upstream,midstream,downstream}` / `review-team` |
| `evidence-grounded-review` | 無し                 | `impact-evidence-coverage`                                                                                                                                      |

3 候補とも id は衝突しません。加えて `critic` という語自体を `src/` `schemas/` `skills/` `tests/` `runners/`（`dist` を除く）`commands/` `agents/` へ `git grep -niE "critic([^a]|$)"` した結果、**一致は 0 件**でした。一致するのは `docs/ai/generate-review-revise-loop.md`（6 件）と `pages/**` および `README*.md`（各 1 件）の散文だけです。

routing 側の懸念は id ではなく tag です。メモリ `feedback_broad_applyto_planner_top1_tiebreak` が記録するとおり、broad な `applyTo` と generic tag を併せ持つ新規 skill は planner の top1 をアルファベット順で横取りします。planner-dataset テストが落ちます。`finding-critic` はアルファベット順で `fix-scope-integrity` より前に来るため、この risk は実在します。Phase 1 で SKILL.md を作る場合、tag は固有のもの（`finding-validation` など）へ絞ります。あわせて `npm run skills:validate:refs` と planner-dataset テストをローカル実行してから push すべきです。

命名についての所見を 1 つ加えます。`review-validation` は、既存 `review-criteria-integrity`（レビュー基準そのものの妥当性）と読み手が混同しやすい語です。`evidence-grounded-review` は River Review 全体の性質を指す語とも読めます。3 候補のうち意味の重複が最も少ないのは `finding-critic` です。

## 4. `verifier.mjs` が既に決定論で判定している範囲

本文 Step 3 が挙げる pre-verification の 6 例について、実装の有無を測定しました。

| 本文の例                     | 実装   | ファイル:行                                                                           | reject するか                                                                         |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| evidence なし                | あり   | `src/lib/verifier.mjs:38` `checkEvidenceExists`                                       | する（`:296`）                                                                        |
| evidence path が diff にない | あり   | `src/lib/verifier.mjs:106` `checkEvidenceInDiff`                                      | する（`:297`）                                                                        |
| line mismatch                | 部分的 | `src/lib/verifier.mjs:218` `determineScopeFromDiff` が line を added lines と照合する | **しない**。`:308-309` のとおり scope は metadata 専用であり、`verified` を動かさない |
| scope mismatch               | 部分的 | `src/lib/verifier.mjs:260` が `scopeMismatch` を計算する                              | **しない**。同上                                                                      |
| invalid phase                | あり   | `src/lib/verifier.mjs:52` `checkPhaseCoherent` と `:155` `checkFilePhaseCoherent`     | する（`:298-303`）                                                                    |
| actionable suggestion 欠如   | あり   | `src/lib/verifier.mjs:92` `checkSuggestionActionable`                                 | する（`:306`）                                                                        |

本文が挙げていない決定論の判定も 2 つあります。

- severity が skill 宣言の上限を超える場合の reject（`src/lib/verifier.mjs:69` `checkSeverityJustified`、reject は `:304-305`）
- traceability refs を差し引いてから長さ検査を行う #1666 の扱い（`src/lib/verifier.mjs:274-285`）

さらに `verifier.mjs` の外側にも決定論の抑制があります。`src/lib/finding-factory.mjs:505` の `prefilterFindings` が 4 つを担います。内訳は `low_confidence` / `insufficient_evidence`（evidence 30 字未満）/ `style_only` / `duplicate` です（`:509` `:513` `:518` `:526`、reason 定数は `:34-48`）。

### 4.1 「新規に作る」提案として残してはならないもの

上表のうち **evidence なし / evidence path が diff にない / invalid phase / actionable suggestion 欠如の 4 例は実装済み**です。Phase 1 でこれらを再実装してはなりません。

残る 2 例（line mismatch / scope mismatch）は、計算は存在するが reject には使わないという状態です。これは「未実装」ではなく「意図的に metadata 専用にしてある」ものです。`src/lib/verifier.mjs:308-309` のコメントが #1644 Phase 1 の決定として明記しています。#1978 がこれを reject 条件へ格上げしたい場合、それは新機能の追加ではなく **#1644 の決定の変更**にあたります。ADR が必要です。

### 4.2 パイプライン順序の不一致（本文の前提の誤り）

本文 Step 2 → Step 3 は「mergeFindings のあとに deterministic pre-verification」と並べます。現行実装は逆です。

- `src/lib/reviewer-orchestrator.mjs:1` が `generateReview` を import する
- `src/lib/review-engine.mjs:295` の `runVerifierStage` が `generateReview` の内側で走り、`:310` で `verifyFinding` を呼ぶ
- `src/lib/reviewer-orchestrator.mjs:823` の `mergeFindings(rawFindings)` は、各 role の `generateReview` 完了後に走る

したがって現行の順序は「reviewer ごとに verify → merge」であり、本文の「merge → verify」ではありません。Phase 3 で validation stage を merge の後段へ置く場合、verifier は既に 1 度走った後になります。2 度目を走らせるのか、merge 後専用の別段にするのかは Phase 0 では決まっていない論点です。

## 5. inner-loop state の保存場所

### 5.1 既存の保存先の棚卸し

| 保存先                             | 定義位置                                        | 保存されるもの                                                                                                                                                                                                                                                                                            | 制約                                                                                               |
| ---------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| run record（`.river/runs/*.json`） | `src/lib/result-store.mjs:151` `buildRunRecord` | `runId` / `timestamp` / `reviewedTarget` / `phase` / `reviewMode` / `mergeBase` / `defaultBranch` / `commitSha`（任意） / `provenance`（任意） / `changedFiles` / `decision`（任意） / `gate`（任意） / `debug`（任意） / `findings` / `suppressedFindings` / `overflowFindings`（任意） / `finalSummary` | 条件付き spread で任意キーを制御する。`--save` 時のみ書かれる                                      |
| `debug`（run record 内）           | `src/lib/result-store.mjs:193`                  | `result.reviewDebug` をそのまま入れる。source 側で redact 済み                                                                                                                                                                                                                                            | schema 上 `additionalProperties: true` で自由形式（`schemas/review-artifact.schema.json:308-311`） |
| `reviewDebug`（実行時）            | `src/lib/local-runner.mjs:663`                  | verifier 統計等                                                                                                                                                                                                                                                                                           | run record の `debug` へ流れる                                                                     |
| orchestrator の `debug`            | `src/lib/reviewer-orchestrator.mjs:893-905`     | `succeededReviewers` / `failedReviewers` / `deduplicatedCount` / `timeoutMs` / `timedOutRoles` / `durationMs`                                                                                                                                                                                             | reviewer 単位の実行メタ。round 概念は無い                                                          |
| `trace`                            | `schemas/review-artifact.schema.json:252-260`   | `run_id` の 1 キーのみ                                                                                                                                                                                                                                                                                    | 「result-store の id と等しいと仮定するな」と明記されている                                        |
| `usage`                            | `schemas/review-artifact.schema.json:222-250`   | `provider` / `model` / `input_tokens` / `output_tokens` / `estimated_cost_usd`                                                                                                                                                                                                                            | LLM を通した run のみ。round ごとの内訳は表現できない                                              |

### 5.2 実測

`.river/runs` の run record は 6 件で、`debug` キーを持つものは **0 件**でした（`node` で全件の key 集合を列挙）。ADR-008 が 2026-08-19 に記録した状況（同 `:54`）から変化していません。

したがって inner-loop state の置き場所として `debug` を選ぶ場合、「既存の観測経路に載せる」という利点は現時点では絵に描いた餅です。実データが 1 件も無いため、載せても誰も読めません。この点は Phase 1 の fixture が実データの代役を果たす必要があることを意味します。

### 5.3 選択肢の整理（決定はしない）

- `debug.validation` へ入れる。`additionalProperties: true` なので schema 変更が不要である。ただし `debug` は「Structure is not guaranteed across versions」と宣言されており（`schemas/review-artifact.schema.json:311`）、契約として参照できない
- `trace` を拡張する。`additionalProperties: false` なので schema 変更が要る。round 数や critic 呼び出し回数の置き場所としては意味的に近い
- finding 単位の `validation` オブジェクトを新設する。`additionalProperties: false` の `$defs/finding` を変える必要があり、影響範囲は ADR-008 `:15-28` が列挙した 11 段と同規模になる
- run record へ新しいトップレベルキーを足す。`buildRunRecord` の条件付き spread 方式（`src/lib/result-store.mjs:180-200`）に倣えば後方互換を保てる

`usage` は round ごとの token を持てないため、#1978 の Cost metrics（critic calls per review / average inner rounds）はどの選択肢でも新しい置き場所を要します。

## 6. #1150 が「完了済み」という主張の検証

### 6.1 事実

Issue #1150 は 2026-06-17T05:43:07Z に closed です（`gh api repos/s977043/river-review/issues/1150`）。最終コメントは S1〜S4 の全スライス着地を宣言します。個別に照合した結果は次のとおりです。

| #1150 のスライス            | 主張                                 | 実測                                                                                                                                                       | 判定                                                                                     |
| --------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| S1 critic API               | verdict + Agent Handoff の契約明文化 | `docs/ai/generate-review-revise-loop.md` と `pages/reference/loop-convergence-contract.md` が存在する。`src/config/schema.mjs:66` に `agentHandoff` がある | 主張どおり。ただし成果物は **doc と config フラグ**であり、critic という実行主体ではない |
| S2 収束制御                 | 停止条件 / 発散ガード / 振動検知     | `src/lib/loop-signal.mjs`、`src/cli/commands/runs.mjs:48-108` の oscillation 検知が存在する                                                                | 主張どおり                                                                               |
| S3 review team orchestrator | 並列 role + merger                   | `src/lib/reviewer-orchestrator.mjs:542` `mergeFindings` / `:676` `runReviewerOrchestration` が存在する                                                     | 主張どおり                                                                               |
| S4 plan-review-gate         | human-approval policy                | `skills/upstream/plan-review-gate/` が存在する                                                                                                             | 主張どおり                                                                               |

### 6.2 「critic 実装がある」という読みは誤り

`git grep -niE "critic([^a]|$)"` を `src` `schemas` `skills` `tests` `runners` `commands` `agents` へ実行した結果、**一致 0 件**です（`critical` は除外済み）。`critic` を名に持つモジュール、関数、skill、テストは 1 つもありません。

Issue #1150 の S1 が「critic API」と呼んだものの実体は、`river run` が返す `decision` / `verdict` / findings を外部の caller がループ入力として消費できるという契約です。#1150 の 2026-06-12 コメントが「`formatJsonOutput` に fail-safe 付きで decision 追加」と記すとおりです。これは **River Review 全体が caller から見て critic として振る舞う**という意味の critic であり、#1978 が言う **finding を反証する内部の Critic role** とは別物です。

さらに #1150 の最終から 2 つ前のコメント（2026-06-15T02:55:32Z）は、残 follow-up の第 1 位として「**adversarial reviewer role の追加（reviewer-orchestrator に lens 追加、S3 の発展）**」を明記しています。#1978 本文も「コメント上でも adversarial reviewer role は follow-up 扱いだった」と正しく記述しています。

### 6.3 判定

「#1150 は完了済み」は事実です。「critic API が完了済み」も、#1150 の定義する critic API に限れば事実です。

一方、本文の Gap 節や既存 Skill 表を読んだ実装者が「critic に相当する実装が repo 内にある」と解釈すると、それは誤りです。同じ `critic` という語が 2 つの粒度で使われており、本文はその区別を明示していません。Phase 1 の worker へ渡す指示では、この 2 つを別語で書き分けるべきです。

## 7. Phase 2 は本リポジトリでは実行不可である

**結論: Phase 2 は本リポジトリでは実行できません。したがって「Phase 2 の結果が悪ければ core orchestration へ昇格しない」という本文の条件は判定不能であり、Phase 3 以降は構造的にブロックされます。**

理由は次のとおりです。

1. #1978 の Primary metrics（precision / false-positive rate / recall / F1 / human accept / reject / reverse）は、いずれも LLM Critic の実応答を必要とする。決定論の verifier だけでは Critic の verdict が存在せず、比較対象の 3 方式のうち第 3 方式が成立しない
2. 本リポジトリは LLM の API キーを repo secret へ登録しない方針である。`.github/workflows/README.md:77` は skill-eval について「API キー未登録のため実際の eval は skip され、設定検証まで縮退する（必須チェックではない）」と記す。`.github/workflows/skill-eval.yml:122` も `No API keys configured - running dry-run validation only` を出す
3. これは未完了の作業ではなく、メンテナの確定判断である。`docs/development/retrospectives/2026-08-12.md:196` は「実際にはメンテナの方針であり、LLM eval は CI のオプションであってメインのゲートではありません。意図どおりの構成でした」と記録する。同じ判断はセッションメモリ `project_llm_eval_is_optional`（2026-08-13 ユーザー判断）にも残る
4. 同じ壁に既に 2 つの ADR が突き当たっている。`docs/adr/007-semantic-precision-pass.md:183` は次のように書く。「provider の API キーが登録され、LLM を通った run を産めることである。**これは代行できない人間作業であり、現時点で未完了である。** この 1 点が未達である間、`observe` 以降のすべての評価は開始できない」。`docs/adr/006-model-aware-review-prompt-compiler.md:137` も同じ条件を第 1 に挙げる
5. ローカルの手動 dogfood で代替する案も Primary metrics を満たさない。precision と F1 は母集団に対する比率であり、golden ラベル付きの十分なサンプル数を要する。手動実行で数件を回しても、`docs/development/1860-prompt-compiler-paired.md:66` が記す「差分 0 は『回帰が無い』ではなく『観測していない』」と同じ状態になる

したがって #1978 の Phase 2 → Phase 3 のゲートは、現在の運用方針のもとでは開きません。この事実は Phase 1 の着手前に合意しておく必要があります。Phase 1 を「Phase 3 への通過点」として位置づけると、到達しないゴールへ向けた作業になります。

## 8. Phase 1 の位置づけ

Phase 2 が実行不可であることは、Phase 1 が無意味であることを意味しません。逆です。

- **fixture 18 件は API キー無しで作成できる。** #1978 が列挙する 18 件は、Reviewer 出力 / Critic 出力 / 期待される最終状態の 3 つ組であり、いずれも人手で書ける固定テキストである
- **fixture は将来の評価資産になる。** API キーが登録された時点で、そのまま paired evaluation の入力として使える。ADR-007 が待っている「LLM を通った run」が生まれた日に、評価を開始できる状態を先に作っておける
- **決定論で検証できる部分は今日から回帰防止できる。** 18 件のうち fixture 2（hallucinated path → verifier reject）は `checkEvidenceInDiff`（`src/lib/verifier.mjs:106`）だけで判定できる。fixture 13（critic timeout）と 14（parse failure）も、fail-safe の分岐がキー無しで検査できる
- **protocol の文書化それ自体が成果物である。** `AGREE / DISAGREE_EVIDENCE / DISAGREE_CONCERN` と `KEEP / REVISE / WITHDRAW` の provider-neutral contract は、手動 dogfood へ今日から使える

したがって Phase 1 は「Phase 3 への前段」ではなく、**それ自体で閉じた成果物**として定義し直すべきです。Definition of Done のうち、キー無しで満たせるのは次の 7 項目です。

- 既存 adversarial / synthesis / verifier との責務境界の明文化（本ノートで完了）
- `AGREE / DISAGREE_EVIDENCE / DISAGREE_CONCERN` の provider-neutral contract
- Reviewer response（`KEEP / REVISE / WITHDRAW`）の構造化
- evidence なしの agreement を correctness として扱わない（既存契約の踏襲）
- inner loop 中の artifact freeze の明文化
- Scope Gate の明文化（ただし語は `scope` 以外へ変える必要がある）
- max inner rounds / timeout / parse failure の fail-safe の明文化

満たせないのは次の 5 項目です。18 件の fixture のうち LLM 応答を要するもの、paired evaluation、precision / FP / F1 / token / latency の計測、critical / major 回帰の確認、risk-based activation のコスト制御です。

## 9. 本文の前提のうち誤っていたもの

実測と食い違った点を全て列挙します。

| #   | 本文の記述                                                            | 実測                                                                                                                                                          | 影響                                                                                                                           |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Step 2（merge）→ Step 3（deterministic pre-verification）の順         | 現行は reviewer ごとの verify（`src/lib/review-engine.mjs:310`）が先で、merge（`src/lib/reviewer-orchestrator.mjs:823`）が後                                  | Phase 3 の配置設計が変わる。「verifier を Critic より先に使う」という DoD は既に満たされているが、merge との相対位置は本文と逆 |
| 2   | `verifier.mjs` は「line / scope mismatch」を検証する                  | 計算はするが reject しない。`src/lib/verifier.mjs:308-309` が metadata 専用と明記する                                                                         | 「安く確定できる」対象に数えると、実際には確定しない                                                                           |
| 3   | 既存 `validatedStatus` を再利用候補として扱う                         | schema 宣言（`schemas/review-artifact.schema.json:455`）とプロンプト規約はあるが、`src/**` に生成者が 0 件                                                    | 「既存語彙の再利用」は実装の再利用を意味しない。import 先が無い                                                                |
| 4   | `scope` を `IN_SCOPE / SCOPE_UNCERTAIN / OUT_OF_SCOPE` として提案する | 同キーが `in-diff / pre-existing` で出荷済み。`normalizeScope`（`src/lib/finding-factory.mjs:348`）は未知値を静かに `in-diff` へ倒す                          | 検知できない誤変換になる。別名が必須                                                                                           |
| 5   | 「#1150: critic API は完了済み」                                      | 事実だが、`critic` という語は `src/**` `schemas/**` `skills/**` `tests/**` に 0 件。#1150 の critic は「River Review 全体が caller に対して果たす役割」を指す | 実装者が「Critic の実装がある」と読むと誤る                                                                                    |
| 6   | Phase 2 の結果が悪ければ昇格しない                                    | Phase 2 自体が実行不可。判定は「悪い」ではなく「不能」                                                                                                        | Phase 3 以降が構造的にブロックされる。着手前の合意が要る                                                                       |
| 7   | `independent-review-synthesis` の「evidence 検証ルールを再利用候補」  | Rule 4 の 3 要素のうち 1 つ（path 照合）は `verifier.mjs` に実装済み。残り 2 つが未実装                                                                       | 特定しないまま委託すると、実装済みの部分を書き直す事故になる                                                                   |
| 8   | 既存 Skill 表が `adversarial-review` を「残す」とだけ書く             | `refactor-claim-audit`（`skills/agent-skills/adversarial-review/SKILL.md:76`）は「主張への反証コードを探す」という点で `DISAGREE_EVIDENCE` と同型             | 別責務という結論は変わらないが、プロンプト設計で参照すべき前例を見落とす                                                       |

なお本文の主張のうち、実測で**正しいと確認できたもの**も記録します。`adversarial-review` が review-of-review とは別責務であること（3.1）、`agreement` を多数決に使わない設計が既存契約であること（1.1 の補足）、名前衝突の回避先候補 3 つが既存 skill id と衝突しないこと（3.2）の 3 点です。

## 10. Phase 0 チェックリストの充足状況

| Phase 0 の項目                                                              | 本ノートの節 | 状態                                                                     |
| --------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| current finding schema / `validatedStatus` / `agreement` / `scope` を棚卸し | 1            | 完了                                                                     |
| `independent-review-synthesis` との責務重複を整理                           | 2            | 完了                                                                     |
| `adversarial-review` Skill との名前・責務境界を文書化                       | 3            | 完了                                                                     |
| inner-loop state の保存場所を決める                                         | 5            | **未完了。選択肢の整理までで、決定は下していない**（本タスクは調査のみ） |
| provider-neutral critic contract を決める                                   | —            | **未着手。Phase 1 の対象**                                               |
| scoring へ渡す Finding 状態を決める                                         | —            | **未着手。決定を要する**                                                 |

残り 3 項目は設計判断を含むため、人間の承認を要します。本ノートはそこへ入りません。

## 11. 関連

- Issue [#1978](https://github.com/s977043/river-review/issues/1978)
- Issue [#1150](https://github.com/s977043/river-review/issues/1150)（closed 2026-06-17）
- Issue [#1545](https://github.com/s977043/river-review/issues/1545)（closed 2026-08-02）
- Issue [#1574](https://github.com/s977043/river-review/issues/1574)（open）
- Issue [#1814](https://github.com/s977043/river-review/issues/1814)（open）
- [`docs/adr/007-semantic-precision-pass.md`](../adr/007-semantic-precision-pass.md)
- [`docs/adr/008-actionability-axis-absorbed-into-disposition.md`](../adr/008-actionability-axis-absorbed-into-disposition.md)
- [`docs/ai/generate-review-revise-loop.md`](../ai/generate-review-revise-loop.md)
