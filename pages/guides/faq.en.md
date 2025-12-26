---
title: FAQ (Common Pitfalls)
---

Summarizing common fatal mistakes: Symptom -> Cause -> Fix -> Check Command.

## 1) Review not running in PR (fork PR secrets)

- Symptom:
  - No comment posted on PR.
  - LLM not used even though `OPENAI_API_KEY` is set.
- Cause:
  - Secrets are not passed to PRs from forks due to GitHub security specs.
- Fix:
  - To run reviews on external contributor PRs, reconsider event choice (e.g., `pull_request_target`) and permission design (Note: `pull_request_target` carries security risks).
  - First check "connectivity" with `dry_run: true`.
- Check Command:
  - `river doctor .`

## 2) Diff not detected (merge-base failure / shallow fetch-depth)

- Symptom:
  - `No changes to review compared to main.` displayed.
  - Diff treated as empty in Actions.
- Cause:
  - `actions/checkout` with shallow `fetch-depth` prevents stable merge-base retrieval.
- Fix:
  - Set `fetch-depth: 0` in `actions/checkout`.
- Check Command:
  - `git fetch --all --tags`
  - `git merge-base HEAD origin/main`

## 3) Planner specified but skipped

- Symptom:
  - `Planner: order skipped (OPENAI_API_KEY...)` displayed.
- Cause:
  - `OPENAI_API_KEY` (or `RIVER_OPENAI_API_KEY`) not set.
  - `dry_run: true` (external call suppression).
- Fix:
  - Set secrets and use `dry_run: false`.
  - First check if deterministic path is stable with `planner: off`.
- Check Command:
  - `river run . --planner order --debug`

## 4) Skills not selected / Mostly skipped

- Symptom:
  - `Selected skills (0)`.
  - Skip reasons like `missing inputContext` / `missing dependencies`.
- Cause:
  - `RIVER_AVAILABLE_CONTEXTS` / `RIVER_AVAILABLE_DEPENDENCIES` insufficient.
  - Phase (`--phase` / `phase`) or `applyTo` mismatch with diff.
- Fix:
  - Declare required context/dependency (or enable stubs).
  - Review `--phase`.
- Check Command:
  - `river run . --debug`
  - `RIVER_DEPENDENCY_STUBS=1 river run . --debug`

## 5) PR Comment Post Failed (Permissions)

- Symptom:
  - Permission error in Actions log.
  - Comment not posted.
- Cause:
  - Workflow `permissions` insufficient (e.g., `pull-requests: write` / `issues: write`).
- Fix:
  - Add required `permissions` to workflow.
- Check Command:
  - `gh workflow view` (Check permission settings)
