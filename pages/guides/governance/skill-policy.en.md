# Skill Policy (Operation Rules)

This document is the rule set for "nurturing skills as operations" in River Reviewer. For how to write skills for authors, refer to `pages/guides/write-a-skill.en.md`.

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

## Deprecation Policy

- Clean up unused or duplicate skills.
- If replacement exists, state alternative skill (`id`) in PR.
- If impact is large, open Issue first to get agreement.
