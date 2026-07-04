---
id: enforce-plan-conformance-en
title: Enforce plan conformance (catch implementation drift)
sidebar_label: Enforce plan conformance (catch implementation drift)
description: How River Review catches implementation drift from an approved plan using upstream gates and midstream conformance skills, plus a runnable demo.
keywords:
  - plan conformance
  - implementation drift
  - AIコードレビュー
  - River Review
---

When you delegate implementation to an AI agent, the result can quietly drift from the plan you already approved. Validation gets added but the response shape breaks; the promised error code changes; a required test never lands. This kind of drift is easy to miss when you only read the diff, so it becomes a review blind spot.

## How River Review addresses it

River Review keeps its review criteria as repo-owned `SKILL.md` skills and forms its judgment across the plan, the diff, and the tests — not the diff alone. The skills that enforce plan conformance are:

- `plangate-exec-conformance` (upstream) — the core skill: it checks the implementation diff against the `plan` / `todo` / `test-cases` artifacts and flags unplanned changes, unimplemented items, and missing tests as drift.
- `plangate-plan-integrity` (upstream) — cross-checks the planning artifacts themselves (`plan` / `pbi-input` / `todo` / `test-cases`) for internal consistency, surfacing spec gaps before any code is written, so you measure conformance against a sound plan.
- `plan-review-gate` (upstream) — gates the plan before autonomous execution, catching dangerous operations, out-of-scope work, over-implementation, and conditions that require human approval.
- `design-source-conformance` (midstream) — when a design source of truth exists (`DESIGN.md`, design tokens), it verifies that new UI values (color, spacing, font size) conform to the defined scale.
- `existing-pattern-conformance` (midstream) — greps for prior art of the same layer and responsibility, then checks that its guards, validation, error handling, and conventions are inherited without gaps.

The distinguishing move is layering an upstream gate that reasons about the plan on top of midstream skills that only see the diff.

## Try it

Start with the runnable demo — it needs no API key and no `npm install`, and reads in about five minutes.

- The full fixture set (`plan.md`, `diff.patch`, `test-cases.md`, `expected-findings.json`) lives in [`examples/plan-conformance-demo`](https://github.com/s977043/river-review/tree/main/examples/plan-conformance-demo).
- Read `plan.md`'s three promises (add validation, keep response compatibility, return 400 on error) side by side with the implementation in `diff.patch`.
- Open `expected-findings.json`: it lists the three critical/major findings River Review should return — findings you only surface by cross-referencing the `plan`, not from the diff alone.

To run it against your own repository, scope the review by phase. See [Run a phase-specific review](../guides/run-phase-specific-review.en.md) for the exact commands.

## What it does not do

River Review produces decision-support material. It deliberately stops short of the following:

- It is human-in-the-loop. It surfaces findings with severities (critical/major/minor/info) but never decides pass/fail or auto-merges on its own.
- It does not replace deterministic, syntactic/pattern checks — that remains the job of static analysis and custom linters; the two are complementary.
- It does not judge the business value or priority of the plan itself; that stays a human decision, outside the skills' scope.

## Related

- [Run a phase-specific review](../guides/run-phase-specific-review.en.md)
- [Upstream / Midstream / Downstream phases](../explanation/upstream-midstream-downstream.en.md)
- [plan-conformance demo](https://github.com/s977043/river-review/tree/main/examples/plan-conformance-demo)
