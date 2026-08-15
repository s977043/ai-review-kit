# Skill Policy (Operation Rules)

This document is the rule set for "nurturing skills as operations" in River Review. For how to write skills for authors, refer to `pages/guides/write-a-skill.en.md`.

## Purpose

- Maintain quality without "noisy" reviews even as skills increase.
- Keep changes as testable specs (rules) to prevent regression.
- Make it easy for external contributors to join (Clear expectations).

## Skill Addition/Change Review Flow (Minimal)

1. Purpose of change stated in 1 line (What to reduce/increase/prevent).
2. `applyTo` appropriately narrowed (No over-application).
3. False positive guards (silence conditions) and Non-goals exist.
4. Output (finding message) is short and leads to next action.
5. `npm run skills:validate` passes.

## Final Decision (When in Doubt)

In ambiguous cases or split opinions, the maintainer makes the final decision. Criteria prioritizes precision over coverage.

## Backward Compatibility (Avoid Breaking)

Principle:

- Avoid changes that trouble existing users (Changing meaning of same name, destructive output change).
- If destructive change needed, state in PR and agree in Issue if necessary.

Minimum:

- Stabilize `id` (Trackable as same skill even if moved/renamed).
- `phase` / `applyTo` changes have high impact, leave reason in PR.

## Handling False Positives

False positives are "Bugs worth fixing". Align the following:

- Symptom: Which diff, what was false positive.
- Expectation: How it should behave (Silence / Say with condition).
- Action: Add guard condition (Silence condition) or weaken expression.

If possible, add minimal reproduction diff as fixtures to detect regression.

## Adoption Criteria for "Good Skill" (Priority Order)

1. Precision (Hits): Low false positives.
2. Actionability (Next Step): Fix direction is clear.
3. Evidence (Basis): Clear where it is pointing to.
4. Coverage (Completeness): Increase later (Don't spread too wide initially).

## Stable Contract (Core not to change)

Treat the following as stable contract; major version bump required for breaking changes.

- Output format (e.g., `<file>:<line>: <message>` format or meaning of `NO_ISSUES`).
- Semantics of `severity` / `confidence` (Interpretation expected by users).

## Community → First-party Promotion (`recommended: true`)

A skill placed under `community/` becomes a promotion candidate once it satisfies all of the conditions below.

### Promotion Criteria

1. **Fixture coverage**: `fixtures/` contains `.md` fixtures for both the happy path and a false-positive case (e.g. `01-icon-button-happy.md`, `02-decorative-img-false-positive.md`).
2. **Golden output**: a matching `golden/<name>.md` exists for every fixture (prose golden output in `Finding:` / `Evidence:` form) and the eval assertions in `eval/promptfoo.yaml` pass.
3. **False-positive guards / Non-goals**: the skill body states its silence conditions and the cases it does not handle.
4. **Maintainer review**: at least one maintainer listed in `CODEOWNERS` has approved. Cross-review by several maintainers is preferable, but since `CODEOWNERS` currently has a single owner (`@s977043`) this is treated as a stretch goal.

> For how to run the eval and generate goldens, see `docs/runbook/community-skill-eval.md`.

### How to Request Promotion

1. Once the conditions are met, prefix the PR title with `[promotion-request]`.
2. State the following in the PR body.
   - The list of fixtures (file paths and count)
   - The eval output (for example the path check from `scripts/run-promptfoo-eval.sh`)
   - The false-positive guards and Non-goals, as bullets
3. Assign a reviewer from the maintainers listed in `CODEOWNERS`.
4. After the maintainer approves, flip `recommended: false → true` for that skill in `skills/registry.yaml` and merge the PR.

> **Expected timeline**: a PR that meets the conditions is usually reviewed within two weeks. If there is no response for a long stretch, ping the maintainers on an Issue.

## Deprecation Policy

- Clean up unused or duplicate skills.
- If replacement exists, state alternative skill (`id`) in PR.
- If impact is large, open Issue first to get agreement.
