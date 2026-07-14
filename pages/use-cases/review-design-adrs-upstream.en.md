---
id: review-design-adrs-upstream-en
title: Review design docs and ADRs upstream
sidebar_label: Review design docs and ADRs upstream
description: Use River Review's upstream skills to review design docs and ADRs before code — catch failure-mode, compatibility, and observability gaps.
keywords:
  - ADR review
  - design review
  - upstream review
  - River Review
---

Want to run an AI review over your design docs? Wrote an ADR and worried you missed a viewpoint? River Review reviews design documents and ADRs in the **upstream** phase — before any code is written — so you catch design gaps before code, not during a diff review when they are expensive to fix.

## The problem

Flaws in a design document or ADR are cheapest to fix before implementation starts. But the highest-risk gaps — undefined failure modes, a missing backward-compatibility plan, no observability — never show up in a code diff. By the time a midstream diff review runs, the design decision is already baked into the code.

## How River Review addresses it

River Review routes the design documents themselves — not the code — to **upstream** skills. When a design plan or ADR appears in the diff, two upstream skills are matched against the changed files and return judgments against your team's design criteria. Each returns `findings` plus concrete follow-up actions.

- `architecture-validation-plan` — flags when a design doc lacks a validation plan: SLO/SLI targets, test plans, rollout/rollback/canary criteria, and observability for the new risks it introduces.
- `security-privacy-design` — reviews data retention/deletion, backup residency, cross-border transfer, encryption, and privacy-rights flows (erasure/export).

Both run in the `phase: upstream` and surface findings you can only see by reading the design document — not the implementation diff.

## Try it

Start with the no-setup demo — no API key and no `npm install` required. It reviews the design plan for a new webhook-delivery feature and surfaces three findings that never appear in an implementation diff (failure-mode/retry, payload versioning, observability).

Steps:

- Open `examples/upstream-design-review-demo/` ([read it on GitHub](https://github.com/s977043/river-review/tree/main/examples/upstream-design-review-demo)).
- Compare `design-plan.md` (the review target) against `expected-findings.json` (the expected findings).
- Then point the same upstream skills at your own ADR or RFC by including it in the diff.

## What it does NOT do

River Review automates the _judgment_, not the merge. Upstream review produces material for a human decision; the final call is always a person's.

- It does not auto-merge or auto-approve. It is human-in-the-loop by design.
- It is not a replacement for static analysis (linters, type checks, SAST). Syntactic, deterministic checks stay with those tools; upstream skills focus on semantic design validity — scope, boundaries, and acceptance criteria.
- It does not speculate about code that is not in the diff, and it does not return generic advice with no reference to the actual design.

## Related

- [Upstream / Midstream / Downstream](../explanation/upstream-midstream-downstream.en.md)
- [What is River Review](../explanation/what-is-river-review.en.md)
- Demo: [upstream-design-review-demo](https://github.com/s977043/river-review/tree/main/examples/upstream-design-review-demo)
