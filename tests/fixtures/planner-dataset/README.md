# Planner evaluation dataset

This directory contains **offline** fixtures used to evaluate skill selection and ordering for representative PR diffs.

- `cases.json`: Case definitions (phase, available contexts/dependencies, and expectations).
- `diffs/*.diff`: Small unified diff snippets used to derive `changedFiles`.

## How to run

- Text summary: `npm run planner:eval:dataset`
- JSON output: `npm run planner:eval:dataset -- --json`
- Save JSON: `npm run planner:eval:dataset -- --out /tmp/planner-eval.json`
