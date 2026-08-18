# River Review: Engineering Operating System Overview

River Review は単なる AI レビューツールではなく、**レビュー品質を測定 / 改善し続けるための Engineering Operating System (EOS)** として設計されている。本 doc は、その全体像を [warpdotdev/oz-skills](https://github.com/warpdotdev/oz-skills) が提唱する 5-layer EOS モデルにマップして整理する。

## 思想

- AI を「賢くする prompt 集」ではなく、**組織のレビュー知識を再現可能な仕組みとして codify する** ことを目的とする
- skill / fixture / suppression / governance / memory は **個別ファイルではなく層として扱う** ことで、追加・更新・廃止のサイクルを循環させる
- レビュー結果は finding 単位ではなく、**fixture / reference / suppression / routing 更新へ降ろす** ことで再発を防ぐ（[FEEDBACK_TO_FIXTURE.md](../../skills/agent-skills/river-review/references/FEEDBACK_TO_FIXTURE.md) 参照）

## 5 レイヤ

各層は独立に進化できる責務を持ち、上位層の変更は下位層の eval / metrics で検証される。

```text
┌──────────────────────────────────────────────────────────────┐
│ 1. Skills          ─ レビュー観点の宣言とプロンプト           │
│    - skills/{upstream,midstream,downstream}/*/SKILL.md (80+) │
│    - skills/agent-skills/*/SKILL.md (Claude Code 互換)       │
├──────────────────────────────────────────────────────────────┤
│ 2. Evaluation      ─ skill 出力の正解集                       │
│    - tests/fixtures/planner-dataset/cases.json (41 cases)    │
│    - tests/fixtures/repo-wide-eval/                          │
│    - tests/fixtures/review-eval/                             │
├──────────────────────────────────────────────────────────────┤
│ 3. Metrics         ─ skill / planner / pipeline の KPI       │
│    - planner: coverage / top1Match / top1MatchCases          │
│    - eval: must_include recall / FP rate / evidence rate     │
│    - 詳細: docs/development/skill-eval-kpi.md                │
├──────────────────────────────────────────────────────────────┤
│ 4. Governance      ─ ownership / approval / deprecation       │
│    - docs/governance.md (PR/release/branch protection)        │
│    - .claude/rules/review-core.md (severity / scope)          │
│    - docs/development/skill-severity-rubric.md (severity)     │
│    - docs/development/skill-applyto-scoping.md (applyTo)      │
│    - docs/governance/ 索引 doc                               │
├──────────────────────────────────────────────────────────────┤
│ 5. Memory          ─ レビュー知見と継続改善ループ             │
│    - skills/agent-skills/river-review/references/           │
│      VERIFICATION.md / FEEDBACK.md / IMPROVEMENT_LOOP.md /   │
│      FEEDBACK_TO_FIXTURE.md / ROUTING.md                     │
│    - memory: suppression entries (Riverbed Memory)            │
└──────────────────────────────────────────────────────────────┘
```

## 既存実装との対応

oz-Skills EOS の各層が、river-review のどこに実装されているかの一覧。

| EOS layer  | river-review での実装                                                                                 | 状態                 |
| ---------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| Skills     | `skills/upstream/`, `skills/midstream/`, `skills/downstream/`, `skills/agent-skills/`                 | ✅ 充実              |
| Evaluation | `tests/fixtures/planner-dataset/`, `tests/fixtures/repo-wide-eval/`, `tests/fixtures/review-eval/`    | ✅ 充実              |
| Metrics    | `scripts/evaluate-*.mjs` 群 + `docs/development/skill-eval-kpi.md` (本 PR で codify)                  | 部分実装             |
| Governance | `docs/governance.md`, `.claude/rules/`, `docs/development/skill-{severity-rubric,applyto-scoping}.md` | 充実、index 化が課題 |
| Memory     | `skills/agent-skills/river-review/references/`, Riverbed Memory (`.river/memory/`)                    | ✅ 充実              |

## warpdotdev/oz-skills との関係

- river-review の Skills レイヤ frontmatter は **planner driven** で、 `applyTo` / `inputContext` / `dependencies` / `severity` 等 13+ keys を持つ。これは Agent Skills 標準（`name` / `description` / `license` の 3 keys）よりも厚い
- しかし `skills/agent-skills/` 配下の Claude Code 互換 skill は **Agent Skills 標準互換性も意識** する（本 PR で `license: MIT` を追加）
- 80+ の workflow skill は planner routing に依存するため標準形式へ下げない。**Dual-mode**: workflow skills (planner-driven) + agent skills (Agent Skills 標準互換) で運用する

## ロードマップ

| Phase   | スコープ                                                                        | 状態                                                                                  |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Phase 1 | EOS 5 layer の codify (本 doc + KPI doc + governance index + license: MIT 追加) | 完了 (#786)                                                                           |
| Phase 2 | KPI の自動計測 + 比較（nightly-eval ledger / `eval:compare` script / 回帰検出） | 部分実装 (per-run + 直近 2-entry 比較は実装済 / 90-day 超 history と分布追跡は未実装) |
| Phase 3 | Memory layer の structured representation（architecture / glossary 抽出）       | TODO                                                                                  |

## 参考

- [warpdotdev/oz-skills](https://github.com/warpdotdev/oz-skills)—EOS の元になった oz-Skills 設計
- [agentskills.io](https://agentskills.io)—Agent Skills 標準
- [`docs/development/improvement-flow.md`](../development/improvement-flow.md)—振り返り → codify → PR の運用フロー
- [`skills/agent-skills/river-review/references/IMPROVEMENT_LOOP.md`](../../skills/agent-skills/river-review/references/IMPROVEMENT_LOOP.md)—Memory layer の中核となる 9-step loop
