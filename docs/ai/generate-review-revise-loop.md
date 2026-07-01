# River Review in the Generate → Review → Revise Loop

本 doc は、River Review を generate → review → revise の改善ループにおける **review ステージ** として位置づけ、未充足の **Agent 層 / Loop 駆動 / Review Team** を設計する。#976（[review-gates-design.md](../development/review-gates-design.md)）と #1148（plan-review-gate）を土台とし、[eos-overview.md](./eos-overview.md) の EOS 5 層に接続する。

新規 top-level command は追加しない（#1024 / #976 の方針を継承）。既存の findings / verdict / Agent Handoff / memory-context を**ループ部品として束ねる**ことに徹する。

## TL;DR

- River Review の中核価値は「賢いプロンプト集」ではなく、generate → review → revise ループに差し込める **verdict 付き critic** である。
- このループに必要な 3 部品（機械可読 critic 出力 / 収束ゲート / 回帰メモリ）に加え、並列 review orchestrator も**既存実装が存在する**。
- 欠けているのは、それらを束ねる **Agent 層の契約**（critic API / merge 契約 / 収束シグナル / caller 責務の明文化）であり、ゼロからの新規実装ではない。
- #976 は「ステージ別ゲート + verdict」を、#1148 は「plan 高度のゲート」を埋めた。本 doc は**そこに "ループ反復" と "エージェントチーム" の軸**を足す。

## review ステージの 3 要件

自律エージェントが回すループの review ステージは、人間向けレビューと異なる 3 要件を持つ。各要件は既存資産で再利用できる。

- 機械可読 critic 出力: revise する AI が次アクションへ変換できる構造。`findings` / `verdict` / Agent Handoff（`agentHandoff` config）が素地。
- 収束ゲート: ループ停止条件。`deriveVerdict` の 3 値（auto-approve / human-review-recommended / human-review-required）を起点とする。ただし後述のとおり verdict 単独では停止条件にならない。
- 回帰メモリ: 振動（fix A により break B、次周で B が再出現）の検知。`finding-fingerprint`（ruleId + file + message 先頭）と run history が基盤。`suppression` は false positive / accepted risk の除外機構であり**回帰追跡とは別責務**として扱う（混ぜると再発を検知する前に finding が消える）。

3 要件とも素地は既にあるため、欠けているのは束ね役の Agent 層のみです。なお既存資産の所在は次のとおりで、本 doc は新規実装でなく**既存実装の契約化・連携**が主眼です。

| 部品                  | 既存実装                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 並列 reviewer + dedup | `src/lib/reviewer-orchestrator.mjs`（bug-hunter / security-scanner / test-gap、fan-out + `deduplicateFindings`） |
| finding 同一性        | `src/lib/finding-factory.mjs`（line を意図的に除外）                                                             |
| verdict / score       | `src/lib/scoring/engine.mjs`（`deriveVerdict` / `scoreReview`）                                                  |
| reviewer 同意メタ     | `schemas/review-artifact.schema.json` の `agreement`（多数決に使わない、severity は evidence で決定）            |

## 同じループの 2 altitude

generate → review → revise は適用高度が違うだけの同一ループです。Agent 層を 1 つ設計すれば 2 インスタンスを賄え、二重実装を避けられます。

| 対象 | generate  | review                       | revise    |
| ---- | --------- | ---------------------------- | --------- |
| 計画 | plan 作成 | plan-review-gate（#1148）    | plan 修正 |
| 差分 | 実装      | code review（既存 skill 群） | diff 修正 |

## 収束制御

review を自律ループへ置くと、#976 の単発ゲートには無い制御が要る。

**実行主体の境界（#976 の責務分界を維持）**: River Review は `loop advice` / `decision signal`（findings + verdict + 収束判定の素材）を**出すだけ**です。反復・停止・escalation の実行は caller（呼び出し側 agent / PlanGate）の責務とします。River Review が自らループを止める主体になると #976 の「River Review は助言、ブロックは PlanGate」という分界を後退させるため、これを明示的に避けます。

caller が使う収束シグナルは次のとおり。

- 停止条件: `verdict == auto-approve` 単独では停止条件にならない（`auto-approve` は HITL 非バイパスの助言で、minor / info finding が残存しても成立する）。**「blocking finding ゼロ かつ unresolved major / critical ゼロ」を満たし、許容対象の minor / info の扱いを明示**した複合条件とする。`human-review-required` は caller が即 escalate する。
- 発散ガード: max iterations 上限と「新規 finding ゼロが N 周連続（loop-until-dry）」。
- 振動検知: 既存 `finding-fingerprint`（ruleId + file + message 先頭、line は含めない）と run history（new / resolved / persisted）を基準とする。同一 fingerprint が resolved 後に再出現したら「revise が別問題を生んだ」と判定し caller へ escalate シグナルを返す。line 近傍は補助シグナルに留める（修正で行番号が動いただけの同一問題を見逃さないため）。
- コスト上限: 1 ループあたりのトークン予算とイテレーション予算（#921 cost control mode の接続点）。

## マルチエージェント Review Team

並列 review team は**新規ではなく既に存在します**。`src/lib/reviewer-orchestrator.mjs` が bug-hunter / security-scanner / test-gap の役割を fan-out し、`deduplicateFindings` で統合します（CLI の `--reviewers` で利用可能）。Claude Code subagent `agents/river-review.md` が単一なのは別レイヤの話で、CLI 層には並列 orchestrator があります。したがって本 doc の狙いは「並列チームの新設」ではありません。**既存 orchestrator の契約化・schema 化・score / decision 連携・adversarial reviewer 追加**が主眼です。

```text
            ┌─ bug-hunter        (既存)
orchestrator┼─ security-scanner  (既存)
 (fan-out + ┼─ test-gap          (既存)
  merge)    └─ adversarial       (追加: 他 reviewer の finding を反証)
                  │ 並列実行
                  ▼
        mergeFindings()（契約化）→ scoreReview → 単一 verdict（advice）
```

- 既存 dedup の限界: `deduplicateFindings` は file / line±2 / message 類似で**最初の finding を残すだけ**で、別 reviewer が同一箇所を `major` と `critical` で出すと、残る側次第で verdict が変わる。severity と reviewer 同意の情報が失われる。
- `mergeFindings()` 契約の新設: `scoreReview` の**前段**に置く。canonical finding を確定し、deterministic merge rule を適用する。
  - severity は重複間の**最大値**を採る。
  - evidence は重複間の**union**を採る。
  - `agreement` には独立に同一 finding を出した reviewer ids を記録する（schema の注記どおり多数決には使わず、severity は evidence で決める）。
  - 低信頼の反証は破棄せず `validatedStatus`（dismissed 等）へ落とす。
- 統合スコア: `mergeFindings()` の出力を既存 `scoreReview` / `deriveVerdict` に渡す。スコアリング自体は流用し並立システムを作らないが、**merge を経ない生 findings を直接 `scoreReview` に渡さない**。
- adversarial 段: 他 reviewer の finding を反証し、false-positive を抑制する。

## EOS 5 層へのマッピング

| EOS 層                   | 本 doc の貢献                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| 1. Skills                | 既存（reviewer が読む観点）                                                                         |
| 2. Evaluation            | review team の統合品質を fixture 化し、ループ収束を回帰防止する                                     |
| 3. Metrics               | iteration 数 / 収束率 / 振動率を新規 KPI とする                                                     |
| 4-5. Governance / Memory | 振動検知に run history、escalate を governance へ接続する。suppression は除外専用で振動検知とは分離 |
| Agent（新設）            | critic API / review team orchestrator / 収束制御                                                    |

## 既存資産との重複・非重複

- `reviewer-orchestrator.mjs`: 並列 reviewer の fan-out と dedup は既出。本 doc は重複せず「merge 契約の厳密化（severity 最大 / evidence union / agreement）」と「adversarial 段」を追加する。
- #976 review-gates-design.md: ステージ別ゲートと verdict のパターンは既出。本 doc は重複せず「ループ反復」「収束 / 振動制御」「caller 責務の明文化」を追加する。実行主体の境界（River Review は助言、停止は caller）は #976 を後退させない。
- #1148 plan-review-gate: 本ループの plan 高度インスタンスとして内包する。
- #921 cost control: 収束制御のコスト上限の接続先とする。
- IMPROVEMENT_LOOP.md（9 ステップ）: あれは skill 改善の外側ループ（feedback → fixture → eval）である。本 doc は diff / plan を直す内側ループ（generate → review → revise）であり、二重ループ構造として両立する。

## Epic スライス案

実装は着手前に人間承認を要する。

S4（plan-review-gate）は #976 の pre-exec skill set で即時利用できるため S3 に依存させない。S2 は停止条件と振動検知に分割可能。S3 は diff review team の品質改善として独立させる。

| スライス | 内容                                                                                                                                                                                                                                                 | 依存         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| S1       | critic API: `river run` の verdict と handoff をループ消費可能な契約として固める                                                                                                                                                                     | 既存ほぼ完成 |
| S2a      | 停止条件の契約明文化（[pages/reference/loop-convergence-contract.md](../../pages/reference/loop-convergence-contract.md)）: blocking ゼロ / human-review-required 即エスカレ / oscillated 即エスカレの複合条件を docs ページとして確定（#1150 完了） | S1, S2b      |
| S2b      | 振動検知: 既存 `finding-fingerprint` と run history による再発検知                                                                                                                                                                                   | S1           |
| S3       | review team の契約化: 既存 `reviewer-orchestrator.mjs` に `mergeFindings` + adversarial 追加                                                                                                                                                         | S1           |
| S4       | plan-review-gate（#1148）: 既存 skill set + verdict 契約で実装、S1 後に前倒し可。`deriveVerdict` の拡張を含む（下記）                                                                                                                                | S1           |

補足:

- S2a の「unresolved」判定は run history / fingerprint（S2b の基盤）を前提とするため、S2b を先行させる。
- S4 は #1148 で確定した human_approval policy を実装するため、`deriveVerdict` に `humanApprovalRequired` boolean を 1 個追加する。true なら axis スコアを汚染せず `human-review-required` へ短絡する。critical finding の emit で代替する案はスコアを 30〜50 点不当に減点するため不可。`deriveVerdict` は `scoreReview` 内部から呼ばれる。伝播経路は `finalizeArtifact` → `scoreReview(findings, { humanApprovalRequired })` → `deriveVerdict` の 3 段になる。call site 伝播は `docs/development/pipeline-params-checklist.md` に従う。詳細は #1148 のコメントを参照。

## 未確定事項

- Epic 起票時の #976 / #1148 / #921 との親子関係。
- review team をマルチエージェントで実装するか、軽量な逐次 fallback も残すか。
- `mergeFindings()` の置き場所: `reviewer-orchestrator.mjs` 内の純関数とするか、schema（`agreement` / `validatedStatus`）への書き込み主体をどこに置くか（S3 着手前に要決定）。
- いずれもアーキ変更であり、実装着手前に人間承認が必要である。
