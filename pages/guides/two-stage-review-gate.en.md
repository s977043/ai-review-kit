# Two-Stage Review Gate (Pre-PR + Post-PR)

River Review works best when you combine a pre-PR local self-review with a post-PR automated review. Strip noise locally before handing off to human reviewers, then re-check in CI after the PR is opened.

## Overview

```text
implement
  ↓  pre-PR (local, noise removal)
river run .              ← self-review the diff for quality & risk
  ↓  open PR
GitHub Actions           ← post-PR automated review (posts comments)
  ↓  spec conformance
river review plan / exec ← check the diff against plan & requirements
  ↓
human review
```

## Pre-PR: local self-review

Before opening a PR, review the diff locally to reduce noise.

```bash
river run . --base main             # explicit base branch (default: auto-detected)
river run . --depth thorough        # force depth (quick|standard|thorough)
river run . --skill-set typescript  # limit to a named skill set (registry recommendations)
```

- Project-specific rules in `.river/rules.md` and `.river/rules.d/*.md` are injected automatically (see [repo-wide review](./repo-wide-review.md)).
- Use `--dry-run` to inspect the plan and selected skills without calling the API.

## Post-PR: GitHub Actions automated review

Review automatically on PR open/update and post results as PR comments. See [Set up River Review with GitHub Actions](./github-actions.md).

- Run a specific phase (`upstream` / `midstream` / `downstream`).
- Gate execution by label (`prLabelsToIgnore`) to control noise and cost.

## Spec conformance: plan / exec gates

Use the SDLC gates to confirm the diff matches requirements and the plan.

```bash
river review plan   # build a review plan from upstream artifacts (plan / pbi-input / ...)
river review exec   # run the review against the plan
```

Skills such as `plangate-exec-conformance` check plan-vs-diff conformance.

## Notes

- **AI review is input for judgment**, not the final decision — humans decide. Findings are emitted with severity (critical / major / minor / info).
- Start with "pre-PR local + post-PR on labeled PRs", then widen coverage as you gain confidence.

## Related

- [Repo-wide review setup and tuning](./repo-wide-review.md)
- [Set up River Review with GitHub Actions](./github-actions.md)
- [Run phase-specific review](./run-phase-specific-review.md)
