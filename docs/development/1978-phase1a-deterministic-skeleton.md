# #1978 Phase 1a—決定論スケルトン

本ノートは Issue #1978（Evidence-Grounded Adversarial Review）の Phase 1 のうち、LLM 応答を必要としない部分だけを実装した記録です。設計入力は [`1978-phase0-gap-analysis.md`](./1978-phase0-gap-analysis.md) であり、本文と食い違う箇所ではノート側の実測を採用しています。

対象コードは `src/lib/finding-critic.mjs` の 1 モジュールで、テストは `tests/finding-critic.test.mjs` です。基点コミットは `2cb3678a`、測定日は 2026-08-26（JST）です。

## 1. Phase 1a と Phase 1b の分割

Phase 1 を 2 つに割ります。

- Phase 1a（本ノート）: 決定論で検証できる部分をコードで実装し、`node:test` で pin する
- Phase 1b（未着手）: LLM 応答を要する 3 値 verdict の実挙動。仕様記述に留める

分割の理由は、Phase 0 ノート § 7 が測定した事実です。本リポジトリは LLM の API キーを repo secret へ登録しない方針であり、Phase 2 の paired evaluation は実行できません。したがって **Phase 2 のゲートは開かず、Phase 3 のオーケストレータ統合へは到達しません**。本モジュールを `src/cli/**` から呼ばないのはこのためです。統合していないことはテストで機械的に確認します。

Phase 1a は Phase 3 への通過点ではなく、それ自体で閉じた成果物として定義します。

## 2. provider-neutral contract

### 2.1 Critic verdict（3 値）

Critic は finding 単位に次のいずれかを返します。語は論文と揃えて大文字のままワイヤ形式とします。

| verdict             | 意味                           | 本実装の扱い                                                               |
| ------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `AGREE`             | finding を支持する             | `AGREE` だけでは severity を上げない。決定論の検証が通った場合のみ確定する |
| `DISAGREE_EVIDENCE` | コード上の反証を提示する       | evidence の引用が無い場合は `DISAGREE_CONCERN` へ降格する                  |
| `DISAGREE_CONCERN`  | 疑わしいが反証コードを示せない | dismissal の機構にしない。立証責任を Reviewer へ戻す                       |

Critic 出力の parse は `parseCriticResponse` が担います。JSON と、`key: value` 行に `evidence:` リストを持つ簡易ブロックの両方を受け付けます。

parse に失敗した場合、**戻り値は verdict を持ちません**。呼び出し側は verdict を得られないため、clean 扱いへは倒れません。

### 2.2 Reviewer response（`KEEP` / `REVISE` / `WITHDRAW`）

| action     | 前提              | 遷移                                                                      |
| ---------- | ----------------- | ------------------------------------------------------------------------- |
| `KEEP`     | **evidence 必須** | `DISAGREE_CONCERN` に対しては確定、`DISAGREE_EVIDENCE` に対しては次 round |
| `REVISE`   | —                 | 未解決として次 round へ回す                                               |
| `WITHDRAW` | —                 | `withdrawn-by-reviewer` または `dismissed-by-evidence` で終端             |

evidence を伴わない `KEEP` は妥当な応答ではありません。`parseReviewerResponse` がこれを拒否し、`needs-human-judgment` へ倒します。

### 2.3 `askRelevance`（`scope` の語衝突を避けた新軸）

Issue 本文は `scope: IN_SCOPE / SCOPE_UNCERTAIN / OUT_OF_SCOPE` を提案します。Phase 0 ノート § 1.2 の実測では、この語は採れません。

- `scope` は `in-diff / pre-existing` という値語彙で既に出荷済みである
- `normalizeScope`（`src/lib/finding-factory.mjs:348`）は未知値を静かに `in-diff` へ倒すため、`IN_SCOPE` を渡しても型エラーにならない
- fail-safe の向きが逆である。既存 `scope` は降格させない向き、`OUT_OF_SCOPE` は降格の向きである

ADR-008 の枠組みでは、`actionability` は既存軸の真部分集合かつ非直交だったので吸収されました。`scope` の 2 意味は直交する別概念なので、吸収ではなく別名を与えます。

| 値           | 意味                       | 経路                                     |
| ------------ | -------------------------- | ---------------------------------------- |
| `in-ask`     | 元の依頼に対する欠陥である | revision instruction へ流す              |
| `uncertain`  | 依頼との関係が判定できない | human-review 候補。revision へは流さない |
| `out-of-ask` | 依頼の範囲外である         | follow-up note。revision へは流さない    |

値はハイフン小文字へ揃えます。既存 finding enum が全てこの形だからです。読み取れない値は `uncertain` へ倒します。`in-ask` へは倒しません。

### 2.4 収束

`runValidationLoop` は max inner rounds（既定 2）で回り、`HARD_CAP_INNER_ROUNDS`（5）で clamp します。cap に到達しても終端状態へ入らない場合、`needs-human-judgment` を返し finding を保持します。artifact は inner loop 中 freeze されます。本モジュールが書き換える対象は、コード / diff / finding 本文のいずれでもありません。

### 2.5 fail-safe 不変条件

degraded な経路は 1 つも clean を返しません。clean とは「finding が消え、かつ人にも回らない」状態であり、`isCleanOutcome` がこれを判定します。

| 分岐                    | status                 | `retainFinding` | `humanReview` |
| ----------------------- | ---------------------- | --------------- | ------------- |
| Critic timeout / error  | `critic-timeout`       | true            | true          |
| Critic parse failure    | `needs-human-judgment` | true            | true          |
| inner loop cap 到達     | `needs-human-judgment` | true            | true          |
| 決定論との矛盾          | `needs-human-judgment` | true            | true          |
| evidence 無し `KEEP`    | `needs-human-judgment` | true            | true          |
| evidence 無しの `AGREE` | `needs-human-judgment` | true            | true          |

## 3. 既存実装との責務境界—再実装しなかったもの

Phase 0 ノート § 4.1 が「実装済み」と判定したものは、1 つも書き直していません。

| 判定                         | 既存実装                                                | 本モジュールの扱い                                |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| evidence なし                | `src/lib/verifier.mjs:38` `checkEvidenceExists`         | `verifyFinding` を import して結果を消費する      |
| evidence path が diff にない | `src/lib/verifier.mjs:106` `checkEvidenceInDiff`        | 同上。Critic 側の引用の接地判定にも同じ関数を使う |
| invalid phase                | `src/lib/verifier.mjs:52` / `:155`                      | 同上                                              |
| actionable suggestion 欠如   | `src/lib/verifier.mjs:92` `checkSuggestionActionable`   | 同上                                              |
| severity 上限超過            | `src/lib/verifier.mjs:69` `checkSeverityJustified`      | 同上                                              |
| low confidence 等の抑制      | `src/lib/finding-factory.mjs:505` `prefilterFindings`   | 触れない。前段の責務である                        |
| dedup と `agreement` 付与    | `src/lib/reviewer-orchestrator.mjs:542` `mergeFindings` | 触れない。前段の責務である                        |

`preVerifyFinding` は `verifyFinding` の薄いアダプタです。判定そのものは行わず、`sendToCritic` の可否と既存 `reasons` の転記だけを担います。テストは `preVerifyFinding` の `reasons` が `verifyFinding` の `reasons` と一致することを直接突き合わせ、独自導出でないことを pin します。

line mismatch と scope mismatch は metadata 専用のままです。`src/lib/verifier.mjs:308-309` が #1644 Phase 1 の決定として明記しており、reject 条件への格上げは #1644 の決定の変更にあたるため ADR を要します。本タスクでは触れません。

`schemas/**` は変更していません。本モジュールが返す `validation` オブジェクトは、まだどの artifact へも書き込まれません。

## 4. Phase 1a で pin した 7 件

Issue #1978 の必須 fixture 18 件のうち、決定論で検証できる 7 件を `tests/finding-critic.test.mjs` が pin します。番号は Issue 本文の番号です。

| #   | fixture                                       | 検証方法                                                                                               |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 2   | hallucinated path → verifier で reject        | 既存 `verifyFinding` が reject し、`preVerifyFinding` が Critic 呼び出しを止める                       |
| 8   | 複数 Reviewer 検出                            | `agreementCount` は増えるが `severity` は素通しで、投票の入口が存在しない                              |
| 13  | critic timeout                                | `retainFinding` と `humanReview` がともに true、`isCleanOutcome` が false                              |
| 14  | critic parse failure                          | 8 種の壊れた payload で verdict を得られず、いずれも escalate する                                     |
| 15  | inner loop cap 到達                           | 既定 2 round / hard cap 5 で clamp し、cap 到達時に human-review へ倒す                                |
| 16  | dismiss が決定論 evidence と矛盾              | 接地していない `DISAGREE_EVIDENCE` は Reviewer の `WITHDRAW` より優先して human へ                     |
| 18  | `adversarial-review` との routing / name 衝突 | skill id 129 件を走査して衝突が無いこと、SKILL.md を追加していないこと、CLI へ配線していないことを確認 |

### 変異検証

各 fail-safe 分岐を「clean へ倒す」向きへ 1 箇所ずつ変異させ、テストが落ちることを実測しました。手順は「変異 → `git diff --numstat` で適用確認 → 実行 → 復帰」です。

| 変異対象            | diff 行数 | `# fail` | 落ちたテスト                                                    |
| ------------------- | --------- | -------- | --------------------------------------------------------------- |
| timeout 分岐        | 2/2       | 2        | `kind=timeout` / `kind=error` の 2 件                           |
| parse failure 分岐  | 3/3       | 8        | `payload #0`〜`#7 escalates instead of passing clean`           |
| inner loop cap 分岐 | 3/3       | 3        | cap 到達 / hard cap clamp / exchanges 枯渇の 3 件               |
| 決定論矛盾の分岐    | 3/3       | 1        | `an ungrounded dismissal of a verified finding goes to a human` |
| `out-of-ask` gate   | 1/1       | 1        | `out-of-ask is held as a follow-up note`                        |

全ての変異は復帰済みで、復帰後の差分は 0 です。

## 5. Phase 1b へ回した 11 件

残り 11 件は LLM の実応答を要するため Phase 1a では検証できません。理由を 1 件ずつ挙げます。

1. 実在 bug に Critic が `AGREE` → confirmed: `AGREE` を返すか否かが LLM の判断であり、固定入力では protocol の分岐しか測れない
2. false positive に Critic が反証コード提示 → withdrawn: 反証コードを Critic が実際に見つけられるかが未知数である
3. 懸念だけ提示され Reviewer が証拠提示 → keep: Reviewer が有効な証拠を出せるかは生成側の能力に依存する
4. 懸念だけ提示され Reviewer が証拠を出せない → withdraw / human: 上と同じく生成側の能力を測る fixture である
5. Critic が実在 bug を追加 → new finding として validation: missed findings の生成そのものが LLM の出力である
6. Reviewer と Critic が自信満々に誤同意 → confirmed へ倒さない: false consensus の再現には両者の実応答が要る
7. security critical finding → evidence-backed で維持: severity 判断と evidence の質が LLM 依存である
8. scope 外の改善提案 → `out-of-ask`: 依頼外だと Critic が分類できるかが検証対象であり、分類済みの入力を与えると同義反復になる
9. 論文 Case 2 相当の plausible concern が不要 refactor へ広がる: scope creep の発生自体を観測する必要がある
10. original ask 不足 → `uncertain` / human: 情報不足の自己申告が LLM の判断である
11. plan artifact review でも同じ protocol が成立: 別 artifact 種別に対する実プロンプト実行を要する

いずれも fixture のテキスト自体は API キー無しで作成でき、キーが登録された日にそのまま paired evaluation の入力になります。Phase 1b はその作成と仕様記述を担います。

## 6. 未決事項

Phase 0 ノート § 5.3 が整理した inner-loop state の保存場所は、まだ決めていません。本モジュールは `validation` オブジェクトを戻り値として返すだけです。run record と artifact のどちらへも書き込みません。保存先の決定は schema の変更を伴う可能性があり、公開サーフェスの変更として承認を要します。

## 7. 関連

- Issue [#1978](https://github.com/s977043/river-review/issues/1978)
- [`1978-phase0-gap-analysis.md`](./1978-phase0-gap-analysis.md)
- [`docs/adr/007-semantic-precision-pass.md`](../adr/007-semantic-precision-pass.md)
- [`docs/adr/008-actionability-axis-absorbed-into-disposition.md`](../adr/008-actionability-axis-absorbed-into-disposition.md)
