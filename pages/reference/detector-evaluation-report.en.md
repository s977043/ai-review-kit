---
id: detector-evaluation-report-en
title: Deterministic Detector Evaluation Report (Reproducible)
sidebar_label: Detector evaluation report
description: What River Review's deterministic (LLM-free) detectors catch and what they never false-positive on — shown as a fixture regression anyone can reproduce with one command.
keywords:
  - AI code review evaluation
  - deterministic code review
  - AI code review benchmark
  - false positive
  - River Review
---

This report shows what River Review's deterministic (LLM-free) heuristic detectors catch, and what they deliberately do not false-positive on, as a reproducible fixture regression. Unlike vendor self-reported benchmarks, every number here can be reproduced by anyone with a single command.

LLM-based review varies from run to run. Deterministic detectors, by contrast, return the same result for the same input, so their quality can be guaranteed mechanically with fixture regression tests. River Review guards this layer with canary cases (a collection of known false-positive patterns) so that a fixed false-positive never silently reappears.

## Scope and method

- **Detectors**: `security-basic` / `logging-observability` / `test-existence` / `coverage-gap`. They run offline (`--offline` / rules-only) and require no API key.
- **Fixtures**: both cases that _should_ be detected (true positives) and guard cases that must _not_ be flagged (false-positive prevention).
- **Assertion**: each fixture is checked mechanically against its expectations (`mustInclude` and `maxFindings`).
- **Source**: the case definitions live in [`tests/fixtures/review-eval/cases.json`](https://github.com/s977043/river-review/blob/main/tests/fixtures/review-eval/cases.json).

## Results (as of 2026-07-05)

**13 of 13 fixtures pass.** The breakdown:

| Category      | Detector(s)                     | Detection cases | Guard (no false positive) | Total |
| ------------- | ------------------------------- | --------------- | ------------------------- | ----- |
| secrets       | `security-basic`                | 3               | 1                         | 4     |
| observability | `logging-observability`         | 2               | 1                         | 3     |
| tests         | `test-existence` `coverage-gap` | 5               | 1                         | 6     |
| **Total**     |                                 | **10**          | **3**                     | 13    |

Guard cases confirm that safe patterns (for example a `process.env` reference rather than a secret, a `catch` block that logs, or a diff that also updates a test file) are not flagged. They act as canaries that prevent known false positives from recurring ([#1070](https://github.com/s977043/river-review/issues/1070)).

## How to reproduce

The command below reproduces the results above verbatim. It is deterministic, so every run yields the same output, and it needs no API key.

```bash
npm run eval:fixtures
```

Each case prints as `[PASS]` or `[FAIL]`. To add or change a case, edit `tests/fixtures/review-eval/cases.json`.

## Scope of this report (honest limits)

- It covers the **deterministic detectors only**. LLM-driven skill accuracy (precision / recall) is not measured here.
- These numbers are one slice of quality; for production use, try River Review on your own real pull requests to confirm it fits.
- Unlike vendor self-reported benchmarks, the emphasis here is that a third party can verify the result with the same command.

## Related docs

- [Evaluation rubric](./evaluation-rubric.en.md)
- [Evaluation fixture format](./evaluation-fixture-format.en.md)
- [Evaluation keep / discard policy](./eval-keep-discard-policy.en.md)
- [Known limitations](./known-limitations.en.md)
