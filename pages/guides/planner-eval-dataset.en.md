---
title: Planner Evaluation Dataset (Offline Evaluation)
---

This is an evaluation set to **offline reproduce and evaluate** the quality of Planner's "skill selection & ordering" for River Reviewer v0.3 (Smart Reviewer).

## What to Evaluate

- Are appropriate skills selected from PR diffs?
- Are expected skills minimally covered? (coverage)
- Is the "Top1 (first skill)" aligned with expectations? (top1Match: optional)

## Dataset Location

- `tests/fixtures/planner-dataset/`
  - `cases.json`: Case definitions (phase / contexts / dependencies / expectations)
  - `diffs/*.diff`: Small unified diffs (input for deriving `changedFiles`)

## How to Run

### 1) Show Summary in Text

`npm run planner:eval:dataset`

### 1-1) Show Aggregate Report (See Miss Trends)

`npm run planner:eval:dataset -- --report`

### 2) Output JSON to Stdout

`npm run -s planner:eval:dataset -- --json`

Output includes estimated `impactTags` from diff (e.g., `typescript`, `security`, `observability`). Useful for validating `selectedIds` or investigating Top1 deviation.

### 3) Save JSON to File

`npm run -s planner:eval:dataset -- --out /tmp/planner-eval.json`

### 4) Compare with Baseline

1. Save baseline (example)
   - `npm run -s planner:eval:dataset -- --out /tmp/planner-baseline.json`
2. Compare and show diff
   - `npm run planner:eval:dataset -- --compare /tmp/planner-baseline.json`

## Goals for v0.3 (Smart Reviewer) (Tentative)

This evaluation aims to stabilize the quality of the "No Planner (Deterministic)" path first.

- `coverage(avg)`: Maintain **100%** (Prevent regression where expected skills are no longer selected)
- `top1Match(avg)`: Target **90% (= 9/10) or higher** (Only for cases where Top1 is fixed)

Check the mismatch list in `--report` to see "in which cases Top1 is off" and use it for prioritizing improvements.

## Rules for Expectations (cases.json)

Premise: In offline evaluation, skills with `tags` like `sample` / `hello` / `policy` / `process` (always-on policies) are excluded by default to avoid polluting results.

### `expectedAny` (Required)

- List one or more skill IDs that **should be selected** in this case.
- Coverage is calculated as the percentage of `expectedAny` included in `selectedIds`.
  - If `expectedAny` is empty, it is treated as coverage=1 (usable for noise cases).

### `expectedTop1` (Optional)

- The acceptable set for "Top1 (first selected skill)".
- Set only for cases where you want to fix Top1; omit for non-fixed cases.
  - If `expectedTop1` is empty, the case is excluded from top1Match aggregation.

### Criteria for Determining Expectations (Operations)

- **precision over coverage**: When in doubt, do not increase expectations too much.
- Treat Skill IDs as **stable identifiers** (rename carefully).
- `expectedTop1` tends to spark debate, so prioritize `expectedAny` first.

## Steps to Add/Update Cases

1. Add diff to `tests/fixtures/planner-dataset/diffs/*.diff`
2. Add case to `tests/fixtures/planner-dataset/cases.json`
3. Run `npm test` and `npm run lint`
4. Check results with `npm run planner:eval:dataset`

Note: In PR diff display, `+++ b/...` might look like `++++ b/...` due to added lines starting with `+` (no issue if actual file content is correct). See `tests/fixtures/planner-dataset/README.md` for details.
