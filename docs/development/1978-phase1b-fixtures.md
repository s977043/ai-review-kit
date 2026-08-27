# #1978 Phase 1b—LLM 依存 fixture 11 件の仕様

Issue #1978（Evidence-Grounded Adversarial Review）の Phase 1 のうち、[`1978-phase1a-deterministic-skeleton.md`](./1978-phase1a-deterministic-skeleton.md) が Phase 1b へ回した 11 件を、本ノートで仕様として固定します。基点コミットは `56e0ae4c`、測定日は 2026-08-27（JST）です。

**本ノートは評価の記録ではありません。** API キーは登録されておらず、paired evaluation は 1 度も実行していません。Phase 0 ノート § 7 の判定（Phase 2 は本リポジトリでは実行不可）は変わっていません。ここで固定するのは「キーが登録された日に、そのまま評価の入力として使えるもの」です。

## 1. 成果物

| 成果物                                      | 内容                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `tests/fixtures/1978-phase1b/fixtures.json` | 11 件（case としては 12 件）の入力・期待出力・golden ラベル・判定規則 |
| `tests/finding-critic-phase1b.test.mjs`     | 固定 transcript を Phase 1a の state machine へ流した遷移の pin       |
| 本ノート                                    | 判定原則・評価ハーネス設計・母数不足の指標の明示                      |

`docs/development/pipeline-params-checklist.md` の `verifyFinding` call site 一覧へ 1 行足しています。新しいテストが `verifyFinding` を直接 import するため、`Doc enumeration` の必須チェックが行の追加を要求します。

`schemas/**` は変更していません。`skills/**` へ新規 skill も追加していません。CLI へも配線していません。Phase 1a の判断（planner top-1 横取りの回避、および `src/cli/**` からの非到達）をそのまま維持します。`src/lib/finding-critic.mjs` の振る舞いは 1 行も変えていません。

## 2. 判定原則—「LLM がそう言ったら合格」にしない

fixture の合否判定は、次の 3 つだけを根拠にします。

- **golden ラベル**: 人が LLM 実行の前に決めた正解である。`golden.assignedBy` に「before any LLM run」と明記し、テストがその文言の存在を検査する
- **決定論の関数の戻り値**: `preVerifyFinding` / `isCriticEvidenceGrounded` / `parseReviewerResponse` / `evaluateExchange` / `partitionByAskRelevance` の出力である
- **語彙の文字列一致**: `verdict` / `askRelevance` / `finalStatus` の値そのものであり、`reason` の散文ではない

逆に、次のものは判定根拠にしません。各 case の `grading.notGradedBy` に列挙してあります。

- Critic / Reviewer の `reason` 散文の説得力
- 自己申告の confidence
- 同意した actor の数

とくに引用の接地は `isCriticEvidenceGrounded` で機械判定します。Critic が「コードを見た」と書いたかどうかではなく、`artifact` が path の形をしていて、かつ diff に現れるかどうかで決めます。fixture ③ には、同じ `DISAGREE_EVIDENCE` でも引用先を diff 外の path へ差し替えると `needs-human-judgment` へ倒れることを確認する行があります。

## 3. fixture 11 件

case 数が 12 件なのは、⑤ を「Reviewer が撤回する」と「Reviewer が証拠なしで固執する」の 2 通りへ割ったためです。どちらも #1978 本文の ⑤ が併記する分岐です。

| #   | case id        | golden ラベル         | 期待 `finalStatus`      | routing               | 主たる判定方法                                                                   |
| --- | -------------- | --------------------- | ----------------------- | --------------------- | -------------------------------------------------------------------------------- |
| ①   | `RR-1978-F01`  | true-positive         | `confirmed`             | revisionInstructions  | golden 一致 + 同じ AGREE を未検証で流すと confirmed にならないこと               |
| ③   | `RR-1978-F03`  | false-positive        | `dismissed-by-evidence` | dropped               | 引用の接地を `isCriticEvidenceGrounded` で判定 + revisionInstructions が 0       |
| ④   | `RR-1978-F04`  | true-positive         | `confirmed`             | revisionInstructions  | 懸念単独では終端しないこと + KEEP が引用を伴うこと                               |
| ⑤a  | `RR-1978-F05a` | unsupported-claim     | `withdrawn-by-reviewer` | dropped               | `dismissed-by-evidence` と綴りが違うこと（引用の無い撤回を証拠扱いしない）       |
| ⑤b  | `RR-1978-F05b` | unsupported-claim     | `needs-human-judgment`  | humanReviewCandidates | parse 拒否 + 理由コード `keep-without-evidence`                                  |
| ⑥   | `RR-1978-F06`  | true-positive         | `confirmed`             | revisionInstructions  | Critic 由来 finding も同じ `preVerifyFinding` を通ること + origin 分岐が無いこと |
| ⑦   | `RR-1978-F07`  | false-positive        | `confirmed`（不一致）   | humanReviewCandidates | golden との**不一致それ自体**を FP として計数する（§ 5 参照）                    |
| ⑨   | `RR-1978-F09`  | true-positive         | `confirmed`             | revisionInstructions  | severity `critical` の素通し + out-of-ask 変種が followUpNotes へ退避            |
| ⑩   | `RR-1978-F10`  | out-of-ask            | `out-of-ask`            | followUpNotes         | 分類の文字列一致 + revisionInstructions が 0                                     |
| ⑪   | `RR-1978-F11`  | scope-creep           | `out-of-ask`            | followUpNotes         | 到達しうる 3 つの終端すべてで revisionInstructions が 0                          |
| ⑫   | `RR-1978-F12`  | relevance-undecidable | `confirmed`             | humanReviewCandidates | 理由コード `ask-relevance-uncertain` + 欠落時の fallback が `in-ask` でないこと  |
| ⑰   | `RR-1978-F17`  | true-positive         | `confirmed`             | revisionInstructions  | コード case と同一の終端 + 文書 path でも接地判定が両方向に効くこと              |

語彙は Phase 1a の実装に合わせています。`askRelevance` は `in-ask` / `uncertain` / `out-of-ask` のハイフン小文字であり、`IN_SCOPE` 系は使いません。transcript に `IN_SCOPE` / `SCOPE_UNCERTAIN` / `OUT_OF_SCOPE` / `IN_ASK` が混入していないことは、テストが全 case の transcript を走査して確認します。

### 3.1 各 case が持つもの

- 入力: `diff`（`diffs` の参照）、`originalAsk`、`acceptanceCriteria`、必要なら `nonGoals`、`candidateFinding`
- Critic への期待: `expected.critic.verdict` と `askRelevance`、引用が要る case では `evidenceGrounded`
- Reviewer への期待: `expected.reviewer.action` と、KEEP なら引用の要否
- 最終状態: `expected.finalStatus`（`FINAL_STATUS` の値）、`humanReview`、`retainFinding`、`routing`
- 判定規則: `grading.rubric[]`（`check` / `method` / `pass` / `fail`）と `grading.llmDependent[]`

`transcript` は LLM の 1 ターンを人手で書き起こした固定テキストです。これがあるおかげで、キーが無い今日でも state machine の遷移だけは実測できます。

## 4. 決定論で今すぐ pin できたもの

`tests/finding-critic-phase1b.test.mjs` が 44 件のテストで次を pin します。11 件のうち **9 件**について、Phase 1a に無かった遷移の pin を新規に追加しました。①⑫ は既存 pin の補強（明示的な status 断言、理由コードの断言）です。

| #   | 新規に pin した内容                                                                |
| --- | ---------------------------------------------------------------------------------- |
| ①   | 未検証の `AGREE` が `agreement-without-evidence` で escalate すること（明示化）    |
| ③   | 接地した dismissal が `dropped` へ入り、接地しない dismissal が human へ倒れること |
| ④   | `DISAGREE_CONCERN` + 引用つき `KEEP` が `confirmed` になること                     |
| ⑤a  | `DISAGREE_CONCERN` + `WITHDRAW` が `withdrawn-by-reviewer` になること              |
| ⑤b  | 引用なし `KEEP` が `keep-without-evidence` で humanReviewCandidates へ入ること     |
| ⑥   | Critic 由来 finding の pre-verification 同値性と、origin 分岐が存在しないこと      |
| ⑨   | severity `critical` の素通しと、out-of-ask による退避が human 通知を伴わないこと   |
| ⑪   | 3 つの終端すべてで revisionInstructions が 0 であること                            |
| ⑫   | 理由コード `ask-relevance-uncertain` が付くこと                                    |
| ⑰   | plan artifact でも終端が一致し、文書 path でも接地判定が働くこと                   |

⑦ と ⑩ には新規 pin を足していません。⑩ は Phase 1a の askRelevance gate のテストが既に同じ遷移を pin しており、重複になるためです。⑦ の理由は次節に書きます。

### 4.1 変異検証

pin が実装に噛んでいることを、分岐を 1 箇所ずつ壊して確認しました。手順は「変異 → `git diff --numstat` で適用確認 → 実行 → 復帰」です。

| 変異対象（`src/lib/finding-critic.mjs`）               | diff 行数 | `# fail` |
| ------------------------------------------------------ | --------- | -------- |
| `WITHDRAW` の綴り分岐を `dismissed-by-evidence` 固定へ | 1/4       | 2        |
| `DISAGREE_CONCERN` + `KEEP` の `confirmed` を human へ | 1/1       | 1        |
| `KEEP` の引用必須ガードを外す                          | 1/1       | 3        |
| `out-of-ask` gate の `retainFinding` を false へ       | 1/1       | 4        |
| `askRelevance` 未知値の fallback を `in-ask` へ        | 1/1       | 1        |
| 接地判定の形ゲートを常に true へ                       | 1/1       | 1        |

全ての変異は復帰済みで、復帰後の差分は 0 です。数値は実測です。

## 5. 決定論では測れないもの—⑦ を隠さずに残す

⑦（Reviewer と Critic が自信満々に誤同意）は、**Phase 1a の state machine が原理的に検出できない** case です。

fixture ⑦ の finding は次を全て満たします。`Evidence:` を持ち、引用先の path は diff に実在し、`Fix:` は actionable で、severity は skill の上限を超えません。したがって `preVerifyFinding` は `verified: true` を返します。Critic が `AGREE` を返せば、protocol は `confirmed` に到達します。誤りである根拠は diff の外側（呼び出し側が常に絶対 URL を渡す事実）にあり、決定論の層はそれを見ていません。

テストはこの事実を「限界として」pin します。`result.status` が `confirmed` であること、そして golden の `not-confirmed` と**一致しない**ことの両方を断言します。さらに、同じ誤同意を `ask-relevance: in-ask` で流すと revisionInstructions へ 1 件届くことも断言します。つまり、確信を持った誤同意と caller の間に決定論のゲートは 1 つも立っていません。

この case の合否は Phase 2 の false-positive rate としてしか出せません。「state machine が落ちなかったから処理できた」と読むのは誤りです。fixture の `grading.rubric` にも同じ注意を書いてあります。

## 6. 評価ハーネスの設計—キーが登録された日に何を実行するか

以下は仕様であり、コードは書いていません。実行に必要な要素のうち、**arm 3 の Critic 呼び出し実装（LLM runner）は存在しません**。それは Phase 3 の作業です。

### 6.1 arm（比較する 3 方式）

Issue #1978 の Baselines は 3 方式です。

1. arm-1: 現行 River Review（Reviewer 群 + merge、Critic 無し）
2. arm-2: 現行 + 決定論検証のみ（`preVerifyFinding` で足切りし、Critic は呼ばない）
3. arm-3: 現行 + Evidence-Grounded Adversarial Review（arm-2 の後段に Critic と Reviewer 応答を回す）

`buildExperimentManifest`（`src/lib/paired-replay.mjs:630`）は `spec.baseline` と `spec.candidate` の **2 側だけ**を受け取ります。3 方式を 1 つの manifest へ入れることはできません。したがって pairwise に 2 本の manifest を作ります。

- 実験 A: baseline = arm-1、candidate = arm-2
- 実験 B: baseline = arm-2、candidate = arm-3

両方の `dataset.datasetHash` は同じ fixture 集合から導かれますが、evidence の artifact hash が side ごとに違うため manifest は別物になります。arm-1 対 arm-3 を直接見たい場合は実験 C を追加します。差分の分解（決定論の寄与と Critic の寄与）を見たいので、まず A と B を回します。

### 6.2 case 同一性

`deriveCaseKey`（`src/lib/paired-replay.mjs:167`）は `record.caseId` を最優先で読み、無い場合に `<reviewedTarget>@<mergeBase>` を組み立てます。fixture は実 PR ではないため、run record へ `caseId` を明示します。値は fixtures.json の `caseId`（`RR-1978-F01` など）をそのまま使います。これにより 3 arm の run が同じ case へ確実に紐づきます。

`heldOutCaseKeys` は **paired の積集合**に対して検証されます（`buildExperimentManifest` 内で `pairableCaseKeys` と突き合わせる）。12 件しかないため、hold-out を切ると評価対象がさらに減ります。初回は hold-out を空にし、fixture が増えてから切ります。

### 6.3 実行手順（キー登録後）

1. arm ごとに 12 case を実行し、run record を保存する。`caseId` を必ず付ける
2. 各 run の Critic / Reviewer の生応答を保存する。fixtures.json の `transcript` は人手の固定値なので、実応答は別に残す
3. `buildExperimentManifest` で実験 A と B の manifest を作り、`verifyExperimentManifest` で content hash を確認する
4. `buildPairedReplay` で pairing と差分を出す（`pairFindings` が finding 単位の対応を作る）
5. fixtures.json の `golden` と各 arm の出力を突き合わせ、§ 6.4 の指標を計算する
6. `grading.rubric` の `method` をそのまま実行し、case ごとの pass / fail を記録する

### 6.4 指標の計算方法

母数は 12 case です。golden ラベルの内訳は true-positive 5、false-positive 2、unsupported-claim 2、out-of-ask 1、scope-creep 1、relevance-undecidable 1 です。

- **precision**: 「arm が revisionInstructions へ流した finding」を分母、「そのうち golden が true-positive のもの」を分子とする
- **false-positive**: golden が true-positive でない finding が revisionInstructions へ届いた件数とする
- **scope-creep**: golden が out-of-ask または scope-creep の case で revisionInstructions が 0 でない件数とする。#1978 の受入条件「scope-creep regression = 0 on guard fixtures」はこの形なら計算できる
- **actionable rate**: `checkSuggestionActionable` 相当の決定論判定を通った finding の比率とする
- **cost**: token / latency / critic call 数 / inner round 数を run record から集計する

### 6.5 母数が足りない指標

12 case では次の指標が成立しません。回すこと自体は可能でも、出た数値を採否の根拠にはできません。

| 指標                              | 分母                         | 判定                                                                      |
| --------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| precision                         | 実際に確定した finding 数    | 12 件では 1 件の反転が約 8 ポイント動く。arm 間の小さな差を分離できない   |
| false-positive rate               | golden 陰性 2 件（狭義）     | 分解能が 1/2 である。率としては読めない                                   |
| recall / missed issue             | 見落とし宣言のある case 1 件 | ⑥ の 1 件のみ。recall は事実上測れない                                    |
| F1                                | 上記 2 つの合成              | 両方が不足しているため成立しない                                          |
| human accept / reject / reverse   | 人の処置の記録 0 件          | fixture からは 1 件も得られない。運用データが要る                         |
| confirmed critical/major accuracy | critical case 1 件（⑨）      | 回帰の有無は言えるが、精度としては読めない                                |
| duplicate / thin finding rate     | 0                            | fixture は case あたり finding 1 件であり、重複の母集団が存在しない       |
| actionable finding rate           | 12                           | 計算はできるが、全 fixture を actionable に書いたので著者を測ることになる |
| cost 系（token / latency）        | 12 × trial 数                | 平均は出る。分散を語るには trial を 3 以上にする必要がある                |

つまり **12 件で意味のある判定に使えるのは「回帰の有無」と「guard fixture のゼロ違反」だけ**です。#1978 の受入条件のうち「false-positive rate が baseline より改善」は、この fixture 集合だけでは判定できません。判定するには golden ラベル付きの実 PR case を追加する必要があります。

### 6.6 #1574 への接続で分かったこと

`SUPPORTED_ACCEPTANCE_METRICS`（`src/lib/paired-replay.mjs:80`）が受け付ける指標名は次の 10 個です。

```text
criticalRegressionCount / criticalAdditionCount / removedFindingCount
addedFindingCount / changedFindingCount / unchangedFindingCount
unpairableFindingCount / pairedCaseCount / unpairedCaseCount / sampleSize
```

**precision / F1 / scope-creep rate はこの語彙に含まれていません。** したがって #1978 の Primary metrics をそのまま acceptance criterion として manifest へ書くことはできません。取りうる道は 2 つです。

- 既存語彙へ写像する。「critical 回帰 0」は `criticalRegressionCount` で表現でき、これは #1978 の受入条件の 1 つと一致する
- 語彙を拡張する。`SUPPORTED_ACCEPTANCE_METRICS` への追加は公開契約の変更であり、承認が要る

Phase 1b では写像の側だけを記録し、拡張は提案しません。母数（§ 6.5）が足りない指標を manifest の受入条件へ載せても、vacuous pass を増やすだけだからです。`METRIC_DENOMINATORS` は `paired-finding` と `paired-case` の 2 値なので、fixture 由来の指標は `paired-case` で数えます。

## 7. 既知のギャップ

- **`missed_findings` は parse されない**。`parseCriticResponse` は #1978 Step 4 の `missed_findings` を戻り値へ載せない。fixture ⑥ の transcript には含まれている。実装する際は、新 finding を `preVerifyFinding` へ通してから同じ validation へ入れること。テストは現状の非対応を pin しており、実装すると落ちる。その失敗が本節へ誘導する tripwire である
- **`out-of-ask` は単独 actor の kill switch のまま**。Phase 1a § 6 の限界はそのままで、fixture ⑨ の変種がこれを pin する。severity `critical` でも human へ通知しない。閾値の要否は、Critic の分類精度を測れるまで判断しない
- **⑦ を止める決定論のゲートは無い**（§ 5）
- **`validation` オブジェクトの保存先は未決**。Phase 0 ノート § 5.3 と Phase 1a § 7 の状態から動いていません

## 8. 関連

- Issue [#1978](https://github.com/s977043/river-review/issues/1978)
- [`1978-phase0-gap-analysis.md`](./1978-phase0-gap-analysis.md)
- [`1978-phase1a-deterministic-skeleton.md`](./1978-phase1a-deterministic-skeleton.md)
- [`1574-p2-paired-replay.md`](./1574-p2-paired-replay.md)
