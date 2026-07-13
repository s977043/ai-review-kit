---
id: reviewer-lens-taxonomy
title: Reviewer Lens Taxonomy（レビュアー・レンズの分類）
---

Reviewer Lens は、既存のレビュー機構を「評価目的」の切り口で整理するための説明語です。新しいレジストリやスキーマ列ではなく、既存の**実装領域別ルーター**と**review team ロール**を評価目的へ写像する語彙として使います。

:::info[この文書の位置づけ]
本文書は写像のための説明ドキュメントであり、コードやスキーマは変更しません。Lens はスキーマの enum やレジストリ ID へ昇格させず、doc レベルの語彙にとどめます。詳細な検討の経緯は Issue #1545 を参照してください。
:::

## 由来 / Provenance

Lens という整理軸は、3 つの外部フレームワークから概念を輸入しています。名指しの参照（nominative）にとどめ、各フレームワークの推奨や提携は主張しません。

- g-stack — 目的別の専門レビュー（CEO / engineering / design / DevEx など）
- Superpowers — 仕様に対するレビューとトレーサビリティ
- Matt Pocock skills — alignment 成果物の整合性レビュー

:::warning[一次ソース未確認]
上記 3 フレームワークの一次ソースは、本文書の作成時点で取得できていません。したがって内容は Issue #1545 の要約を正とします。原典を取得できた場合は、Lens 定義の過不足を再検証してください。
:::

## Lens とは何か / What a Lens Is

Lens は「どの評価関数でレビューするか」を表す切り口です。River Review には、すでに 2 つのテキソノミーが並存しています。

- 実装領域別ルーター — `skills/agent-skills/river-review-{architecture,code,docs,frontend,performance,security,testing}` の 7 スキル
- review team ロール — `src/lib/reviewer-orchestrator.mjs` の `REVIEWER_ROLES`（6 ロール）

Lens は 3 つ目のテキソノミーではありません。上記 2 者を評価目的へ写像する読み替えの語です。新しいレビュアーを無制限に増やさず、目的・適用条件・期待成果が明確な場合にのみ Lens を足す方針をとります。

## 写像表 / Mapping Table

各 Lens を、既存のルーターとロールへ写像します。充足度は Issue #1545 のカバレッジ分析（Covered / Partial / Gap）に対応します。

| Lens         | 主な問い                                   | 実装領域別ルーター                 | review team ロール            | 充足度  |
| ------------ | ------------------------------------------ | ---------------------------------- | ----------------------------- | ------- |
| engineering  | 設計・保守性・既存構造・拡張性は妥当か     | `river-review-code`                | `bug-hunter`                  | Covered |
| security     | 認証・権限・入力・データ保護に問題はないか | `river-review-security`            | `security-scanner`            | Covered |
| qa           | 受入条件・境界値・異常系・回帰を検証したか | `river-review-testing`             | `test-gap`                    | Covered |
| design       | UX・視認性・操作性・a11y に問題はないか    | `river-review-frontend`            | `frontend-reviewer`           | Covered |
| architecture | 境界・依存・データフロー・契約を壊さないか | `river-review-architecture`        | （専任ロールなし）            | Partial |
| operability  | 監視・障害対応・設定・デプロイは安全か     | `river-review-performance`（部分） | `ci-cd-reviewer`（部分）      | Partial |
| devex        | API・CLI・導入・デバッグ体験を損なわないか | `river-review-docs`（部分）        | （専任ロールなし）            | Partial |
| release      | migration・互換性・rollback は安全か       | （専任ルーターなし）               | `dependency-reviewer`（部分） | Partial |
| product      | 要求・利用価値・事業ルールに適合するか     | （専任ルーターなし）               | （専任ロールなし）            | Gap     |

充足度の読み方は次のとおりです。

- Covered — ルーターとロールの双方が写像先を持つ。
- Partial — 一方のみ、または部分的にしか写像先を持たない。
- Gap — 専任の写像先がなく、必要になった時点で追加を検討する。

## Gap の扱い / Handling Gaps

Gap と Partial の Lens（product / architecture の専任ロール / privacy / accessibility / release）は、真のギャップが運用で観測された場合にのみ registry skill として追加します。先回りしてレビュアーを増やすことはしません。product / design のようにコード外の成果物を必要とする Lens は、[artifact 入力契約](../reference/artifact-input-contract.md)経由で成果物を受け取ります。

## PlanGate との境界 / Boundary with PlanGate

Lens の語彙定義は River Review を SSoT とします。River Review は「レビュー観点の定義・実行・記憶」を担い、GO / NO-GO・停止・承認・merge は担いません。PlanGate（Issue #851）は River Review の findings を利用する側で、Lens を mode / risk の入力として参照します。二重定義を避けるため、Lens の語彙は本文書に一元化します。

関連ドキュメントは次のとおりです。

- review team の実行フロー — `skills/agent-skills/review-team/SKILL.md`
- レビュー観点の切り口 — [上流、中流、下流](./upstream-midstream-downstream.md)
- artifact 入力契約 — [artifact-input-contract](../reference/artifact-input-contract.md)

## 人間レビューの要点 / Notes for Human Review

- 本文書は写像のみを扱い、新しい語彙・スキーマ・レジストリを増やさない。
- 一次ソースは未確認のため、原典取得後に Lens 定義を再検証する。
- review team ロールは SKILL.md と `reviewer-orchestrator.mjs` の二重管理である。本文書は写像にとどめ、二重管理を悪化させない。
