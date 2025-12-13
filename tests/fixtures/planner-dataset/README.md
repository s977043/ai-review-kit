# Planner evaluation dataset

This directory contains **offline** fixtures used to evaluate skill selection and ordering for representative PR diffs.

- `cases.json`: Case definitions (phase, available contexts/dependencies, and expectations).
- `diffs/*.diff`: Small unified diff snippets used to derive `changedFiles`.

## How to run

- Text summary: `npm run planner:eval:dataset`
- Aggregated report: `npm run planner:eval:dataset -- --report`
- JSON output: `npm run planner:eval:dataset -- --json`
- Save JSON: `npm run planner:eval:dataset -- --out /tmp/planner-eval.json`
- Compare with baseline JSON: `npm run planner:eval:dataset -- --compare /tmp/planner-baseline.json`

## Note about GitHub diffs

When these fixture files are added/changed in a pull request, GitHub's diff view prefixes each line with `+`/`-`.
As a result, a valid unified-diff line like `+++ b/path` may appear as `++++ b/path` in the PR UI, even though the file content is correct.
