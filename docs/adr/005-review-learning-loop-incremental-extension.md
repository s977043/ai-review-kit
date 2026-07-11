# ADR-005: レビュー学習ループは新設せず既存 improvement-loop を増分拡張する

## Status

Accepted—#1471「レビュー結果を学習し、観点・Skill・自動検査へ昇格する仕組み」の Fit&Gap 調査に基づき、増分A（PR #1488）・増分B（PR #1492）をマージ済み。増分Cである本 ADR がその設計判断を記録する。

## Context

Issue #1471 は、レビュー結果（finding 単位の採否・理由）を蓄積し、観点・Skill・自動検査へ段階的に昇格させる仕組みを提案した。提案には次の要素が含まれていた。

- finding 単位のレビュー結果スキーマ（`status` / `reason_code` / `confidence` / `evidence[]` / `project_scope` / `promotion_candidate` / `fix_verified`）
- 13 カテゴリの指摘分類体系、11 の採用・不採用理由コード
- 誤検知パターンのモデル/観点/プロジェクト別集計
- 多因子の昇格条件（固定回数閾値でない）
- `/review-ai-feedback` Skill の新設
- 効果測定（precision / FP rate / escape rate / recurrence rate / モデル別コスト）
- `ai-second-brain`・PlanGate へのクロスリポ連携

読み取り専用の調査エージェントが、この提案と river-review の既存資産を file:line 根拠付きで突合した（詳細マッピングは issue #1471 コメント参照）。既存資産は次の通り、提案の骨格をすでに広くカバーしていた。

| #1471 の提案要素                                | 判定 | 根拠                                                                                                                                       |
| ----------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| finding 単位の採否記録                          | ◐    | `src/lib/feedback.mjs` の `buildFeedbackEntry` は skill × feedbackType 単位で、finding 単位の `status`/`reason_code`/`confidence` は未対応 |
| 指摘の分類体系                                  | ◐    | 既存は 7 型 `FEEDBACK_TYPES`（`FEEDBACK.md`）。#1471 の 13 カテゴリとは別軸                                                                |
| 類似パターンの集約・昇格候補検出                | ●    | `scripts/feedback-rule-candidates.mjs` の `findRuleCandidates`（`npm run feedback:rules`）                                                 |
| 昇格先の選択（review rule/skill/lint/test/ci）  | ●    | `FEEDBACK_TO_FIXTURE.md` 変換表 + `IMPROVEMENT_LOOP.md` Step 9 + `.claude/rules/review-core.md` #1070                                      |
| `/review-ai-feedback` 相当の Skill              | ●    | 既存 orchestrator（`skills/agent-skills/river-review/SKILL.md`）の Route→Review→Verify→Classify FB                                         |
| 効果測定（escape rate / recurrence / モデル別） | ○    | `docs/development/skill-eval-kpi.md` に recall / FP rate はあるが、この3軸は未実装                                                         |
| `ai-second-brain` / PlanGate 連携               | ○    | `.river/` 配下 in-repo 完結。クロスリポ出力契約は存在しない                                                                                |
| HITL 原則（無承認で自動昇格しない）             | ●    | `skill-improvement-loop-design.md` 63-65/145-151「生成は雛形まで、適用は人間 PR」                                                          |

調査時点の実データ検証では、`.river/feedback/2026-06.jsonl` は smoke test 1行のみで、実運用の feedback 蓄積は事実上ゼロだった。**「仕組みはあるが使われていない」が実態**であり、最優先の課題は新機能の追加ではなく「記録が発生する運用トリガー」の欠如だった。

## Decision

Issue #1471 は**新システムの構築ではなく、既存 improvement-loop の欠落ピースを埋める増分拡張**として採用する。真のギャップは次の3点に限定されると判断した。

1. finding 単位の decision 記録の粒度不足（severity / confidence / model フィールドの欠如）
2. クロスリポ（`ai-second-brain` / PlanGate）への出力契約の不在
3. escape rate / recurrence rate / モデル別コストの計測軸の不足

これに対し、以下の増分のみを実施する。

### 増分A（PR #1488・マージ済み）

`src/lib/feedback.mjs` の `buildFeedbackEntry` に、8番目の feedbackType `out_of_scope`（skip-scope disposition 用）を追加した。あわせて省略可能フィールド `reviewer` / `model` / `reversedBy` を後方互換で追加した。省略時は既存 JSONL の形状を変えない。理由コード・カテゴリ体系は新設しない。既存 7→8型の `feedbackType`（destination 軸）と直交させ、severity 語彙（`.claude/rules/review-core.md` #1070 の blocker→critical 等）との二重管理を避けた。`findingFingerprint` は実データがない場合に捏造せず `null` を許容する（feedback.mjs 冒頭のコメント参照）。

### 増分B（PR #1492・マージ済み）

`scripts/feedback-rule-candidates.mjs`（`npm run feedback:rules`）に `--out <path>` を追加し、rule-promotion candidates を構造化 JSON artifact として書き出せるようにした。artifact の形は `{generatedAt, threshold, entries, candidates[]}` で、`candidates[]` の要素は `{skillId, feedbackType, count, prs, suggestedAction}` を持つ。既存の人間向け stdout・`--json` 出力・exit code 2（候補検出時）の挙動は変更していない。ライブ統合ではなくファイル境界の契約定義に留め、将来 CI artifact 化や PlanGate / `ai-second-brain` 連携の入力にできる形だけを用意した。

### 増分C（本 ADR）

本ドキュメントとして Fit&Gap 分析を確定し、見送った代替案とその理由を記録する。

## Non-Goals（見送った代替案）

| #1471 をそのまま実装した場合                               | 二重系になる既存資産                                                                                           | 見送った理由                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| finding 単位の新 yaml スキーマ store を新設                | `.river/feedback/*.jsonl`（decision）+ `.river/runs/*.json`（finding）                                         | 新 store を作らず既存 JSONL を増分A で拡張すれば足りる                                                                               |
| `/review-ai-feedback` Skill を新規追加                     | orchestrator の Verify→Classify FB ステップ + `FEEDBACK.md` + `VERIFICATION.md`                                | 既存 orchestrator の強化で代替可能（#1471 自身も既存強化を推奨）                                                                     |
| 13 カテゴリ + 11 理由コードの独立体系を導入                | 7→8 型 `FEEDBACK_TYPES`（`FEEDBACK.md`）+ severity 語彙マッピング（#1070）                                     | reason_code を既存 taxonomy と直交フィールドとして併存させれば、severity は既存 blocker/warning/nit を正のまま保てる                 |
| 多因子の昇格エンジンを新規構築                             | `feedback-rule-candidates.mjs`（`findRuleCandidates` の `min` 閾値）+ `suppression:analytics` + `eval:compare` | 既存3コマンドの閾値・多因子化を段階拡張すればよく、固定回数閾値の検出のみに留め、codify は人間判断に委ねる既存原則（HITL）と整合する |
| escape rate / recurrence / モデル別の新 KPI ダッシュボード | `skill-eval-kpi.md` + `artifacts/evals/results.jsonl` ledger + `nightly-eval.yml`                              | 不足軸は既存 ledger スキーマへの追記で埋められ、新規ダッシュボードは不要                                                             |
| River Review 内で昇格実行まで完結させる                    | HITL 原則（`skill-improvement-loop-design.md` 非ゴール）                                                       | 実行はせず artifact 出力に留め、審査は人間または PlanGate 側で行う（増分B の設計判断）                                               |
| CLAUDE.md / Hook の自動昇格・自動書換                      | HITL 原則、#1471 の非目標                                                                                      | river-review は HITL 前提であり、参考にした外部記事（zenn nexta\_）の自動化度をそのまま持ち込まない                                  |

## Consequences

### Positive

- 新しい二重系（新 store / 新 Skill / 新 KPI ダッシュボード）を作らず、既存 `.river/feedback` → `feedback:rules` → `review-core.md`/Gate という段階昇格の骨格をそのまま維持できる
- feedback JSONL のフィールド追加は後方互換なので、既存 reader（`feedback:apply` / `feedback:rules` / eval 系）を壊さない
- `--out` artifact は疎結合な契約のため、将来 `ai-second-brain` や PlanGate と連携する際も既存資産を作り直す必要がない

### Negative

- finding 単位の decision 記録は依然として skill × feedbackType の粗い粒度であり、reason_code の enum 化・多因子昇格スコアリングは未着手のまま残る
- escape rate / recurrence rate / モデル別コストの計測は増分A で `model` フィールドを追加しただけで、集計・ダッシュボード化は別途の増分が必要
- `ai-second-brain` / PlanGate との実連携（artifact を実際に消費する側）は本 ADR の範囲外であり、増分B は「契約の型」を用意したのみ

## 再検討条件

次のいずれかが成立した時点で、Non-Goals の判断を再検討する。

1. `feedback-rule-candidates.mjs` の `--out` artifact を実際に消費する外部ツール（PlanGate の昇格審査等）が具体化し、現行の最小スキーマでは不足が判明した場合
2. reason_code の多因子昇格が、固定閾値 `min` の運用だけでは誤検知や見逃しが継続的に発生すると実データで確認された場合
3. escape rate / recurrence rate の計測が別 issue で必要になり、既存 `skill-eval-kpi.md` の ledger 拡張では表現できないと判明した場合

## 参照

- 提案: Issue [#1471](https://github.com/s977043/river-review/issues/1471)
- 増分A: PR #1488（`feat(feedback): reviewer/model/reversedBy と out_of_scope を後方互換で追加する`）
- 増分B: PR #1492（`feat(feedback): feedback:rules に --out artifact 出力を追加する`）
- [`src/lib/feedback.mjs`](../../src/lib/feedback.mjs)
- [`scripts/feedback-rule-candidates.mjs`](../../scripts/feedback-rule-candidates.mjs)
- [`skills/agent-skills/river-review/references/FEEDBACK.md`](../../skills/agent-skills/river-review/references/FEEDBACK.md)
- [`docs/development/skill-improvement-loop-design.md`](../development/skill-improvement-loop-design.md)
- [`docs/development/skill-eval-kpi.md`](../development/skill-eval-kpi.md)
- [ADR-001: Evaluation-Driven Reviewer Improvement Loop](./001-eval-driven-improvement-loop.md)
