---
id: unknown-coverage-review
name: unknown-coverage-review
description: |
  完成した差分・PR・検証証拠に残る Unknown（未確認の前提・調査されていない影響・
  不足している証拠）を横断合成する evidence-sufficiency のメタ観点。個別 defect の
  検出は既存 skill へ委譲し、本 skill は「そのリスク種別を調査した証拠が残っているか」
  の meta 評価のみを行う。finding verification 後の合成ステップとして report-only で
  実行し、残存 Unknown を output-format §4「Unverified / Residual Risk」の Unknown
  Coverage 下位構造へ、判定を既存 verdict 語彙（GO/ESCALATE/NO_GO）へ写像する。
  新しい語彙・schema は作らない。
category: midstream
phase: [upstream, midstream, downstream]
severity: major
applyTo:
  - 'src/**/*.{ts,tsx,js,jsx,mjs}'
  - 'runners/**/*.{ts,js,mjs}'
  - 'scripts/**/*.mjs'
  - '**/migrations/**'
  - '**/*.sql'
  - '**/*.{yaml,yml,json,toml}'
inputContext: [diff, fullFile, plan, review-self, review-external, test-cases]
outputKind: [findings, questions, actions]
tags:
  [
    unknown-coverage,
    evidence-sufficiency,
    grill-for-unknowns,
    unknown-unknowns,
    map-territory,
    meta,
    synthesis,
  ]
version: '0.1.0'
license: MIT
---

# Unknown Coverage Review（残存 Unknown のメタ観点）

> **由来 / Inspired by**: Thariq「[A Field Guide to Finding Your Unknowns](https://claude.com/blog/a-field-guide-to-claude-fable-finding-your-unknowns)」（The map is not the territory: Plan やプロンプトは現実のコードベースを圧縮した地図であり、地図と土地の差分に Unknown が潜む）と Matt Pocock「[`/grill-me`](https://www.aihero.dev/skills-grill-me)」（実装前に質問を重ね共有理解を作る）から着想した概念の再実装。原著者を名指しする nominative fair use に留め、endorsement は主張しない。

通常のレビューは「壊れている箇所（defect）」を指す。
本観点は **「そのリスク種別を調査した証拠が残っているか（evidence-sufficiency）」** を、完成した差分を横断して合成する。問いが直交するため、defect 検出とは混載しない。

## 背景 / Background

AI coding agent の実行能力が上がるほど、見逃しは単純なコード品質から **要件・暗黙知・影響範囲・運用条件・移行条件などの「未確認の未知（Unknown）」** へ移る。
チェックリストを満たしても、レビュー対象外の前提や未確認領域が残れば誤ったマージ判断につながる。
本観点は大量の質問を生成しない。差分・PR 本文・Plan・テスト・設定・履歴を調査し、以下を構造化して出力する。

1. 何が未確認か
2. なぜ危険か
3. どの証拠が不足しているか
4. 何を確認すれば解消できるか
5. マージを止めるべきか（既存 verdict 語彙への写像で表現）

## Pre-execution Gate / 発火条件

**最初に判定する**。満たさない場合は以降の観点を実行せず `NO_REVIEW` を返す。

- finding verification 後の **合成ステップ**として呼ばれている（orchestrator の Execution Flow から。keyword routing では呼ばない）。
- 入力に少なくとも `diff` があり、差分が **リポジトリ内で実行されるコード・migration・schema・公開 API・設定**のいずれかに触れる。docs・コメントのみの差分は対象外とする。
- ビルド成果物・生成物（`dist/**`・`*.map`・lockfile・自動生成 manifest）は Gate 判定からもレビュー対象からも除外する。
- **PlanGate 非依存**: `plan` / `review-self` などの artifact が欠損しても動作する。欠損した観点は finding を出さず `skippedSkills` に記録してデグレードする（artifact-input-contract の既定挙動）。

## 6 Unknown 観点 / Perspectives

Issue #1470 の 6 カテゴリを、defect ではなく **evidence-sufficiency の meta 質問**として扱う。各観点の defect 検出は既存 skill へ委譲する（[DELEGATION.md](./references/DELEGATION.md)）。本観点は委譲先が扱わない **残余（証拠が足りているかの合成）のみ**を検出する。

| #   | 観点                           | 核心の meta 問い                                                         |
| --- | ------------------------------ | ------------------------------------------------------------------------ |
| 1   | Requirement / Intent Unknowns  | 「曖昧な仕様を推測で実装した箇所に、確認した証拠があるか」               |
| 2   | Repository / Impact Unknowns   | 「影響範囲を repo 全体で検索・確認した証拠があるか」                     |
| 3   | Runtime / Operational Unknowns | 「migration・再実行・外部依存・監視を検証した証拠があるか」              |
| 4   | Security / Data Unknowns       | 「認証境界・入力検証・不可逆変更を確認した証拠があるか」                 |
| 5   | Validation Unknowns            | 「失敗系・境界・実利用経路を観測した証拠があるか」                       |
| 6   | Plan / Assumption Traceability | 「Plan の Assumption が解消され、新規 Unknown が記録された証拠があるか」 |

観点 3〜5 は既存の運用・影響・検証系 skill の多くが `applyTo: docs/**`（upstream 設計文書向け）で、**コードのみの diff では空振りする**。本観点はその空白を「証拠の有無」の meta として拾う（設計 §1 の Partial / Gap）。

## 委譲 / Delegation

重複指摘を避けるため、個別 defect の検出は既存 registry skill に委譲し、本観点は **証拠充足の meta 評価のみ**を行う。委譲表・証拠要件・分界は [DELEGATION.md](./references/DELEGATION.md) を SSoT とする。委譲先が finding を出す領域を本観点は重複指摘しない。

## Output / 出力

report-only 契約に従う。**本観点はマージを止めない**。判定素材を返すだけで、反復・停止・エスカレは caller の責務である。

- 残存 Unknown は [output-format.md](../../../docs/review/output-format.md) §4「Unverified / Residual Risk」の **Unknown Coverage（残存 Unknown / evidence_missing / resolution）** 下位構造へ出力する。各 Unknown は category・severity・blocking・evidence_missing・resolution を持つ。
- 解消済み Unknown は Good Points 節に根拠（リンク済み受入条件・テスト等）を添えて記録する。分量目安は**観点ごとに代表 1 件・1 行に要約**する（低リスク PR では解消済み記録が出力の大半を占めやすいため）。
- verdict は新語彙を作らず既存 `gate.decision` へ写像する（loop-convergence-contract.md「Unknown Coverage verdict の写像」表が SSoT）。

| verdict        | 既存語彙                     | 条件                                                                                                                              |
| -------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pass`         | `GO` / `GO_WITH_OBSERVATION` | Blocking Unknown なし・必要証拠あり。resolution が merge 後の観測で足りる非 Blocking Unknown のみ残る場合は `GO_WITH_OBSERVATION` |
| `needs_review` | `ESCALATE`（要人間）         | merge 前に解消すべき非 Blocking Unknown / 証拠不足 → `severity: major` ＋ §4 残リスク                                             |
| `fail`         | `NO_GO`（要修正）            | セキュリティ / データ損失 / 互換性 / 不可逆の重大 Blocking Unknown → `severity: critical`                                         |

判別軸は **resolution の実行タイミング（merge 前 / merge 後）** に置く。非 Blocking Unknown が残ること自体は `needs_review` を意味しない。その resolution が merge 後の観測（次回 eval run・運用レビュー等）で足りるなら `pass`（`GO_WITH_OBSERVATION`）に倒し、merge 前に解消すべきものだけを `needs_review`（`ESCALATE`）に倒す。

- **判定原則**: Unknown の存在だけで自動的に `fail` にはしない。severity・blocking・根拠・復旧可能性で判断し、**未確認と「確認済みでリスク受容」を区別**する。fail-safe（判定不能 → NO_GO / ESCALATE）は `src/lib/gate-decision.mjs` の決定論純関数が担う。resolution が merge 後の観測で足りる非 Blocking Unknown を finding として出す場合、severity は **`minor` / `info` に制限**する（`major` 以上を出しながら `verdict: pass` に写像すると矛盾するため）。
- **`skippedSkills` の出力例**: `plan` / `review-self` 欠損時は該当観点を `skippedSkills` に記録し、finding は出さずデグレードする（[artifact-input-contract.md](../../../pages/reference/artifact-input-contract.md) と同じ語彙・`review-artifact.md` の `id` / `reasons` スキーマに整合）。例:

  ```json
  "skippedSkills": [
    { "id": "unknown-coverage-review#6", "reasons": ["plan artifact missing"] }
  ]
  ```

## False-positive guards

- 指摘の `file:line` は差分内にあること（VERIFICATION の evidence 規則）。差分外の推測に基づく Unknown は finding にせず question として返す。
- 委譲表に該当する defect は出さない（委譲先 skill の実行に委ねる）。
- 「証拠が repo 内・別ファイル・PR 本文に存在する可能性」を Grep / artifact 参照で棄却できない場合は、finding ではなく question にする。
- 低リスク PR（小さな明確なバグ修正・既存パターン踏襲）では過剰な Unknown を出さない。観点ごとに **finding と question の合算で** 最大 5 件、severity 降順で切り捨てる。question は severity を持たないため **`info` 相当として扱い、切り捨ては findings（severity 降順）→ questions の順**とする。
- correctness bug・セキュリティ欠陥そのものは対象外（defect 系観点の責務）。

## References

- [DELEGATION.md](./references/DELEGATION.md) — 既存 skill への委譲表・証拠要件・分界
