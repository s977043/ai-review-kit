# Superpowers Review Patterns for River Review (#1223)

## Status

Proposal for #1223.

This document records how River Review should evaluate patterns inspired by
Superpowers without importing Superpowers as a dependency and without changing
River Review's responsibility boundary.

**Decision direction:** adopt the review patterns, not the execution workflow.

- PlanGate owns execution governance: plan creation, approval, stop/go policy,
  TDD requirements, and subagent execution control.
- River Review owns review judgment: artifact comparison, findings, verdicts,
  and reusable repo-owned review skills.

This follows the existing Review Gates Design decision: River Review reviews;
PlanGate gates.

## Why

AI implementation speed has shifted review risk away from only "is this code
well-written?" toward "is this implementation still aligned with the approved
intent?" Diff-only review is not enough for agentic development.

A useful River Review run should be able to answer these questions:

- Does the diff implement the approved plan, rather than a plausible but
  different implementation?
- Did the implementation stay within the planned target files and out-of-scope
  boundaries?
- Do tests cover the test cases promised in the plan?
- For high-risk work, is there evidence that TDD happened in the right order:
  RED, then GREEN, then REFACTOR VERIFY?
- Did task-level implementation reports and prior reviews get respected?
- Is the final branch coherent after multiple task-level changes are combined?

Superpowers contains useful operational patterns for these questions:

- plan-to-task decomposition,
- task brief / report / review package handoff,
- task-level review loop,
- TDD RED/GREEN evidence,
- final whole-branch review.

River Review should not copy that execution workflow. It should translate those
patterns into review skills and artifact contracts.

## What to adopt

### 1. Plan Alignment Review

River Review already has related capabilities through PlanGate conformance
skills. The Superpowers-derived improvement is to make the review vocabulary and
finding taxonomy more explicit.

#### Purpose

Compare approved planning artifacts against the implementation diff.

#### Inputs

- `plan.md`
- `design.md` or ADRs, when present
- `todo.md`
- `test-cases.md`
- diff / patch
- JUnit / coverage, when present

#### Checks

- `plan.md` task requirements appear in the diff.
- `design.md` or ADR boundary decisions are respected.
- changed files are within the planned target files or explicitly justified.
- out-of-scope areas are not touched.
- planned tests exist and target the promised behavior.
- new dependencies, abstractions, modules, or migrations are planned or justified.
- no extra feature work is hidden inside the PR.

#### Finding taxonomy

| Finding id | Meaning | Typical severity |
| --- | --- | --- |
| `planned-but-missing` | A planned task or acceptance item is not implemented. | major / critical |
| `implemented-but-not-planned` | The diff adds behavior not present in the plan. | major |
| `target-file-violation` | Changed files exceed planned target files without justification. | major |
| `out-of-scope-change` | The diff touches an explicitly excluded area. | critical |
| `design-deviation` | The implementation contradicts an approved design / ADR. | major / critical |
| `test-contract-missing` | Planned test case is absent from tests or JUnit evidence. | major |
| `unexpected-dependency-added` | A dependency was added without plan/design justification. | major |
| `unjustified-abstraction` | A new abstraction appears without plan/design rationale. | minor / major |

#### Existing mapping

This should build on, not replace:

- `rr-upstream-plangate-plan-integrity-001`
- `rr-upstream-plangate-exec-conformance-001`

The near-term implementation may be either:

1. extend `rr-upstream-plangate-exec-conformance-001`, or
2. add a focused sibling skill, e.g. `rr-upstream-plan-alignment-001`.

Prefer option 1 if the change is only taxonomy and evidence wording. Prefer
option 2 if the skill starts requiring additional artifacts such as task review
packages or TDD ledgers.

## 2. TDD Evidence Review

PlanGate can require and record TDD evidence. River Review should review whether
that evidence is meaningful.

### Purpose

Check whether a claimed TDD implementation has valid RED/GREEN/REFACTOR VERIFY
evidence and whether that evidence maps to the promised test cases.

### Inputs

- `test-cases.md`
- `docs/working/TASK-XXXX/evidence/tdd/task-N-ledger.json`
- `docs/working/TASK-XXXX/evidence/verification/*.json`
- diff / patch
- JUnit, when present

### Expected TDD phases

| Phase | Required meaning | Validity rule |
| --- | --- | --- |
| `tdd_red` | Added test fails before production implementation. | `exitCode != 0` and conclusion explains the expected failure. |
| `tdd_green` | Minimal implementation makes the target test pass. | `exitCode = 0` and command targets the relevant test. |
| `refactor_verify` | After cleanup, tests and related checks still pass. | `exitCode = 0`; required when refactor was performed. |
| `verification` | Non-TDD final verification. | `exitCode = 0`; does not replace RED/GREEN. |

### Checks

- high-risk / critical work has `tdd_red` and `tdd_green` evidence.
- `tdd_red` did not pass accidentally.
- `tdd_red` conclusion explains the expected failure, not an unrelated runtime error.
- `tdd_green` targets the same behavior introduced by `tdd_red`.
- `refactor_verify` exists when refactor or cleanup occurred.
- test evidence maps back to `test-cases.md` or acceptance criteria.
- tests are not only asserting mocks while missing the business boundary.

### Finding taxonomy

| Finding id | Meaning | Typical severity |
| --- | --- | --- |
| `missing-tdd-red` | TDD is required but no RED evidence exists. | major |
| `invalid-tdd-red` | RED evidence passed or failed for an unrelated reason. | major |
| `missing-tdd-green` | No GREEN evidence exists after implementation. | major |
| `missing-refactor-verify` | Refactor occurred but no post-refactor verification exists. | minor / major |
| `tdd-evidence-not-linked-to-test-case` | Evidence cannot be mapped to a planned test case. | major |
| `test-does-not-cover-acceptance-criteria` | Test exists but does not verify the promised acceptance behavior. | major |

### Existing mapping

This should build on, not replace:

- `rr-upstream-plangate-verification-audit-001`
- future `river review verify` runtime work

Near-term implementation should be a new focused skill, because TDD evidence has
different inputs and validity rules than W-checking `review-self` /
`review-external`.

Proposed id:

```text
rr-upstream-plangate-tdd-evidence-001
```

## 3. Review Context Bundle

Superpowers reduces context drift by passing task-specific files instead of the
entire conversation. River Review should adopt the same review-input principle.

### Purpose

Make reviewer input reproducible, inspectable, and replayable.

### Candidate bundle layout

River-native form:

```text
.review/
└── packages/
    └── task-001/
        ├── brief.md
        ├── implementation-report.md
        ├── diff.patch
        ├── evidence-ledger.json
        ├── tdd-ledger.json
        └── review-artifact.json
```

PlanGate-integrated form:

```text
docs/working/TASK-XXXX/
├── plan.md
├── design.md
├── test-cases.md
├── evidence/
│   ├── verification/
│   └── tdd/
└── dispatch/
    ├── task-001-brief.md
    ├── task-001-report.md
    └── task-001-review-package.md
```

### Review Artifact schema decision

Do **not** add a required top-level `contextBundle` field to schema v1.

Reason:

- `review-artifact.schema.json` v1 is already stable and intentionally additive.
- Review bundle support is an input contract concern first.
- v1 can carry experimental data under `debug.execution.snapshot` or external
  artifacts while the contract is validated.

Recommended path:

1. Document accepted artifact names in `artifact-input-contract` or a new
   development proposal.
2. Let skills consume bundle files as optional artifacts.
3. If usage stabilizes, consider `review-artifact.v2.schema.json` with a formal
   `contextBundle` / `artifacts` section.

## 4. Final Whole-Branch Review

Superpowers performs task-level reviews and then a final branch review. River
Review should map this to downstream review, not to automatic merge approval.

### Purpose

Check whether multiple task-level changes still form a coherent branch.

### Inputs

- full diff
- task review packages
- previous River Review artifacts
- review-self / review-external
- evidence ledgers
- plan / design / test-cases

### Checks

- task-level findings were resolved or explicitly deferred.
- no integration contradiction appears between tasks.
- branch-level acceptance criteria are covered.
- migration / dependency / security risks are not introduced by the combination
  of individually safe tasks.
- previous review feedback was not ignored.

### Output

This should produce findings + `decision` / `suggestedLoopSignal` only.
It must not perform GO / NO-GO, C-3 approval, or auto-merge.

## Responsibility boundary

| Area | PlanGate | River Review |
| --- | --- | --- |
| Plan creation | Owner | Reads as artifact |
| Design approval | Owner | Detects design deviation |
| Exec start/stop | Owner | Does not control |
| TDD requirement | Owner | Reviews evidence validity |
| Subagent execution | Owner | Reviews reports/packages |
| Diff review | Supporting | Owner |
| Findings generation | Supporting | Owner |
| GO / NO-GO | Human / caller / PlanGate | Advisory only |
| Auto-merge | No | No |

## Adoption plan

### Phase 1: documentation and taxonomy

- Record this proposal.
- Align finding ids with existing skills.
- Decide whether Plan Alignment extends `exec-conformance` or becomes a sibling
  skill.
- Decide whether TDD Evidence Review is a new skill.

### Phase 2: minimal skill work

- Update or add Plan Alignment review skill.
- Add fixtures and golden outputs for:
  - planned-but-missing,
  - implemented-but-not-planned,
  - out-of-scope-change,
  - test-contract-missing.

### Phase 3: TDD evidence review

- Add `rr-upstream-plangate-tdd-evidence-001`.
- Add fixtures and golden outputs for:
  - missing-tdd-red,
  - invalid-tdd-red,
  - missing-tdd-green,
  - tdd-evidence-not-linked-to-test-case.

### Phase 4: Review Context Bundle

- Define artifact input names.
- Add docs and examples.
- Decide whether schema v2 needs formal bundle metadata.

## Non-goals

- Do not import Superpowers as a dependency.
- Do not copy Superpowers skill files.
- Do not make River Review execute implementation tasks.
- Do not make River Review perform PlanGate C-3 approval.
- Do not make River Review block or unblock execution directly.
- Do not add auto-merge.
- Do not require TDD for all PRs.

## Open questions

1. Should Plan Alignment be an extension of
   `rr-upstream-plangate-exec-conformance-001`, or a new sibling skill?
2. Should TDD Evidence Review be upstream, verify, or both?
3. Should Review Context Bundle be River-native (`.review/packages`) or only
   PlanGate-integrated (`docs/working/TASK-XXXX/dispatch`) for the first cut?
4. Should the bundle become a schema v2 concept, or remain an artifact resolver
   concern?

## Initial recommendation

- Extend `rr-upstream-plangate-exec-conformance-001` only for Plan Alignment
  taxonomy and wording.
- Add a new `rr-upstream-plangate-tdd-evidence-001` skill for TDD evidence.
- Keep Review Context Bundle outside schema v1.
- Keep Final Whole-Branch Review as downstream advisory review.
