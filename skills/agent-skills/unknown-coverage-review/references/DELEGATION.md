# Delegation 表 — Unknown Coverage の残余切り出し

Unknown Coverage Review は **evidence-sufficiency（証拠が足りているか）の meta 評価**に集中する。個別 defect の検出は既存 registry skill が担うため、本観点は **委譲先が扱わない残余のみ**を検出する。SIMPLIFY 観点と同じく、delegation 表で重複を機械的に抑制する。

## Pre-execution Gate（再掲）

**最初に判定する**。[SKILL.md](../SKILL.md) の Pre-execution Gate を満たさない場合は本表を参照せず `NO_REVIEW` を返す。要点:

- finding verification 後の合成ステップとして呼ばれていること。
- `diff` があり、実行コード・migration・schema・公開 API・設定に触れること（docs・コメントのみは対象外）。
- `plan` / `review-self` 欠損時は該当観点を `skippedSkills` に記録してデグレードする（PlanGate 非依存）。

## 証拠要件 / Evidence requirements

- finding の `file:line` は差分内にアンカーする（差分外の推測に基づく Unknown は question として返す）。
- 「証拠が repo 内・別ファイル・PR 本文・テストに存在する可能性」を Grep / Glob / artifact 参照で棄却できた場合のみ finding 化する。「なさそう」という推測は禁止する。
- 委譲先が既に finding を出す領域は重複指摘しない。本観点の finding は「証拠の不在（evidence_missing）」に限る。

## 委譲表 / Delegation table

| Unknown 種別（#1470）          | 委譲先（defect 検出）                                                                                                                                                      | 本観点が扱う残余（evidence-sufficiency の meta）                                                                                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement / Intent           | `requirements-acceptance`・`plangate-plan-integrity`・`ai-agent-review-readiness`                                                                                          | plan 無し PR でも残る「仕様推測を確認した証拠の不足」を合成する                                                                                                                                                                                                             |
| Repository / Impact            | `cross-file-leakage`・`hallucinated-reference`・`api-compatibility`・`existing-pattern-conformance`                                                                        | 「影響範囲を repo 全体で検索した証拠があるか」の meta（顕在した漏れは委譲先が検出）。diff-time の証拠充足検出は registry skill `impact-evidence-coverage`（Impact 軸）へ切り出し済みで、合成層はその findings を残余に取り込み重複指摘しない                                |
| Runtime / Operational          | `operability-slo`・`failure-modes-observability`・`migration-safety`・`event-driven-semantics`・`external-dependencies`・`cache-strategy-consistency`・`async-correctness` | 運用・影響系は多くが `applyTo: docs/**` で code-only diff では空振りする。その「証拠の不在」を拾う。diff-time の失敗系・外部依存の証拠充足検出は registry skill `impact-evidence-coverage`（Failure / External 軸）へ切り出し済みで、合成層はその findings を残余に取り込む |
| Security / Data                | `trust-boundaries-authz`・`migration-safety`                                                                                                                               | 「認証境界・入力検証・不可逆変更を確認した証拠があるか」の meta                                                                                                                                                                                                             |
| Validation                     | `coverage-gap`・`test-existence`・`e2e-wiring`・`test-plan-review`                                                                                                         | 「失敗系・境界・実利用経路を観測した証拠があるか」の meta（Missing Tests 節と接続）                                                                                                                                                                                         |
| Plan / Assumption Traceability | `plangate-verification-audit`・`architecture-risk-register`・`plangate-plan-integrity`                                                                                     | 「Plan の Assumption が解消された証拠」「実装中に発見した Unknown を記録した証拠」の突合。diff-time で plan 保有時に単独実行する版は registry skill `assumption-resolution-trace` へ切り出し済みで、合成層はその findings を残余に取り込む                                  |

## 分界の原則

- **defect（S）は委譲先、evidence-sufficiency（M）は本観点**。委譲先は「リスクが差分に顕在化した時」に指摘し、本観点は「そのリスク種別を調査した証拠が残っているか」を横断合成する。
- **diff-time の evidence-sufficiency は registry skill へ委譲する**。本観点（agent-skill 合成層）が扱う evidence-sufficiency のうち、diff-time で単独実行できる部分は次の registry skill へ切り出し済みで、合成層はそれらの findings を残余に取り込み重複指摘しない。
  - `impact-evidence-coverage`: Impact / Failure / External の 3 軸の証拠充足を diff-time で検出する。
  - `assumption-resolution-trace`: 観点6（Plan / Assumption）を `plan` 保有時に単独実行し、前提解消の証拠を突合する。
- 委譲先が upstream 設計文書向け（`applyTo: docs/**`）で code-only diff に発火しない場合でも、本観点は defect を代替検出しない。あくまで「証拠の不在」を Unknown として記録し、解消手順（resolution）を添える。
- 出力・verdict 写像は [SKILL.md](../SKILL.md) の Output 節に従う。新語彙は作らない。
