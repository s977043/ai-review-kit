---
id: suppress-flaky-review-comments-en
title: Suppress flaky / false-positive AI review comments
sidebar_label: Suppress flaky / false-positive AI review comments
description: Reduce flaky, false-positive AI review noise with Riverbed Memory suppression and the suppression-feedback skill. Human-in-the-loop, not auto-merge.
keywords:
  - false positive AI review
  - suppress AI review comments
  - AIコードレビュー 誤検出
  - River Review
---

If you searched for "reduce false positives in AI code review", "suppress noisy AI review comments", or "stable AI review", this recipe is for you.

## The problem

LLM-driven review is non-deterministic: the same diff can surface different comments on each run, and some comments contradict the actual implementation intent. When the same finding re-fires on every PR, reviewers lose trust and developers start ignoring the bot. Left unmanaged, that noise erodes the signal that made the review worth reading.

## How River Review addresses it

River Review splits false-positive handling into two layers:

- **Deterministic detectors** (`security-basic`, `logging-observability`, `test-existence`, `coverage-gap`) are guarded by _canary_ fixtures — a corpus of known false-positive patterns. Once a false positive is fixed, a regression test keeps it fixed. See the [detector evaluation report](../reference/detector-evaluation-report.en.md).
- **Semantic noise and intent mismatches** are handled in the **midstream** phase by the `suppression-feedback` skill.

`suppression-feedback` does not silently delete findings. It classifies a finding so a reviewer (human or AI) can decide between _suppressing_ and _fixing_ it, then guides the `river suppression add` CLI that records the decision in Riverbed Memory:

- `false_positive` — records a comment that contradicts the implementation intent.
- `accepted_risk` — records a finding you knowingly keep after weighing the cost.
- `duplicate` — points at an existing fingerprint instead of repeating the comment.
- `major` / `critical` findings are **not** auto-suppressed except via `accepted_risk` with a rationale (the HIGH_SEVERITY guard). Everything else is blocked and must be handled manually.

Because the decision lives in Riverbed Memory, the next PR's review can recall it and stop re-firing the same noise.

## Try it

There is no dedicated demo — the workflow runs through Riverbed Memory suppression. To silence a comment you have judged a false positive:

1. Run a review and note the `fingerprint` of the comment you want to suppress.
2. Decide whether it is a false positive or an accepted risk.
3. Record it with `river suppression add`:

```bash
river suppression add \
  --fingerprint <fp> \
  --feedback false_positive \
  --rationale "one or two sentences on why this is a false positive"
```

For the full storage flow into `.river/memory/index.json`, see [Use Riverbed Memory](../guides/use-riverbed-memory.en.md). For the design rationale, see [Riverbed Memory](../explanation/riverbed-memory.en.md).

## What it does NOT do

- It does not auto-generate suppression entries. Writing to the CLI and to Riverbed Memory requires human approval.
- It is human-in-the-loop, not auto-merge — River Review never merges around a finding on its own; a human makes the final call.
- It is not a replacement for static analysis or your custom linters. The deterministic layer is guarded by canary fixtures; `suppression-feedback` focuses only on the semantic judgment those tools cannot make.
- It does not blanket-suppress `major` / `critical` findings. Auto-suppression is allowed only when both `accepted_risk` and a rationale are present.
