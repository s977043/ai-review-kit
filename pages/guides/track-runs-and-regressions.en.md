---
title: Run store and regression comparison (runs / --baseline)
---

River Review can persist review runs to a project-local **Run store** (`.river/runs/`) and compare against past runs to see regressions (new vs. resolved findings). Wired into CI, this lets you mechanically track "did this PR add findings?".

> For the full list of flags and subcommands, see [Stable Interfaces (CLI reference)](../reference/stable-interfaces.md). This page focuses on the how-to.

## Overview

| What you want                                | Command                                   |
| -------------------------------------------- | ----------------------------------------- |
| Save a review run                            | `river run <path> --save`                 |
| List saved runs                              | `river runs list`                         |
| Diff saved runs (regression / oscillation)   | `river runs diff <id1> <id2> [<id3>...]`  |
| See an aggregate dashboard across saved runs | `river runs summary`                      |
| Compare against an arbitrary baseline JSON   | `river run <path> --baseline <prev.json>` |

## 1. Save a review run (`--save`)

Passing `--save` to `river run` persists the result to the Run store.

```bash
river run . --save
```

On success, the destination is printed to stderr.

```text
Run saved: 2026-06-06T08-30-00-000Z-a1b2c3 → /path/to/repo/.river/runs/2026-06-06T08-30-00-000Z-a1b2c3.json
```

### Where the Run store lives

- Default: **`.river/runs/`** directly under the reviewed repository (project-local)
- Fallback when no repository can be resolved: **`~/.river/runs/`** (global)

Each run is saved as a single `<runId>.json` file. The `runId` is an ISO timestamp plus a short hash (e.g. `2026-06-06T08-30-00-000Z-a1b2c3`), designed so that lexicographic filename order equals chronological order.

> `.river/runs/` is a run log and does not need to be committed. It is common to add it to `.gitignore`.

### What is saved

Each run record (JSON) contains:

- `runId` / `timestamp` / `phase` / `reviewMode`
- `mergeBase` / `defaultBranch` / `changedFiles`
- `findings` and `suppressedFindings`
- `overflowFindings` (findings that fell past the overview display cap; the key is absent when nothing overflowed)
- `finalSummary`: `findingsCount` / `suppressedCount` / `overflowCount` / `overviewCount` / `changedFilesCount` / `tokenEstimate`

`overflowFindings` are not suppressions. A suppression is a decision about how to treat a finding, whereas exceeding the display cap is only a ranking outcome, so it carries no reason code and is stored apart from `suppressedFindings`. The Markdown report itself does not truncate at that cap, so overflowed findings still appear there in full.

## 2. List saved runs (`river runs list`)

Lists the runs in the Run store, newest first.

```bash
river runs list
```

```text
Stored runs (/path/to/repo/.river/runs):

  2026-06-06T08-30-00-000Z-a1b2c3  phase=midstream  findings=4  suppressed=1  overflow=2  files=7  2026-06-06T08:30:00.000Z
  2026-06-05T17-10-00-000Z-d4e5f6  phase=midstream  findings=6  suppressed=0  overflow=0  files=5  2026-06-05T17:10:00.000Z
```

Run records saved before `overflow=` existed carry no `overflowCount`, so they print as `overflow=0`.

If there are no saved runs, `No stored runs found in ...` is printed.

## 3. Compare two or more runs (`river runs diff`)

Specify two saved runs by `runId` to compare finding regressions.

```bash
river runs diff 2026-06-05T17-10-00-000Z-d4e5f6 2026-06-06T08-30-00-000Z-a1b2c3
```

It prints a `## Regression Review Summary` Markdown block.

| Item              | Meaning                                                         |
| ----------------- | --------------------------------------------------------------- |
| New findings      | Present in the second run but not the first (a regression)      |
| Resolved findings | Present in the first run but gone in the second (resolved)      |
| Persisting        | Present in both, with a small score change                      |
| Score changed     | Present in both, but the composite score moved by ±0.05 or more |
| Regression score  | `New − Resolved`. Positive means a net increase (worse)         |

The New / Resolved / Score changes sections list the affected file and the finding content.

> Finding identity is determined by a fingerprint. Findings with the same file path, rule, and message gist are treated as identical; line-number shifts are ignored.

### Oscillation detection with 3+ runs

Passing three or more run IDs enables **oscillation detection**.

```bash
river runs diff <run-id-1> <run-id-2> <run-id-3>
```

An oscillated finding is one that was Resolved in an intermediate run but reappears as New in a later run. This is a signal that an AI-driven revise cycle introduced a different problem — a self-correction loop. The `Oscillated findings` section in the output lists these re-emergent findings. With `--output json` the same data is available in the `oscillated` array for machine consumption.

## 4. Aggregate dashboard (`river runs summary`)

Prints a Markdown dashboard aggregated across the whole Run store.

```bash
river runs summary
```

```text
## River Review Dashboard

| Metric | Value |
|---|---|
| Total runs | 12 |
| Total findings | 48 |
| Total suppressed | 6 |
| Total overflow (overview cap) | 2 |
| Suppress rate | 11.1% |
| Avg findings/run | 4.0 |
```

It also prints Severity / Confidence distribution tables. Use it to grasp quality trends across many runs.

`Suppress rate` counts `suppressedFindings` exactly as each run record stored them. Older run records folded the display-cap overflow into `suppressedFindings`, so while such records remain in the Run store their side of the metric reads higher. When they are present a `Legacy pre-#1857 suppressions` row appears; use that row to tell the discontinuity apart from a real change.

## 5. Compare against an arbitrary baseline (`--baseline`)

Whereas `runs diff` compares two saved runs, `--baseline` compares a **freshly executed result against any past review JSON**. This suits keeping a baseline generated on `main` as a file and checking for regressions on a PR branch.

```bash
river run . --baseline ./baseline-findings.json
```

The JSON passed to `--baseline` accepts either form:

- A bare array of findings (`[ { ... }, { ... } ]`)
- An object with a `findings` (or `issues`) key (`{ "findings": [ ... ] }`)

The output is the same `## Regression Review Summary` format as `runs diff`. If the comparison fails, `Warning: --baseline comparison failed: ...` is printed and the review itself continues.

Which stream the summary goes to depends on `--output` (#1706): stdout for the default `text`, stderr for `markdown` / `json` / `yaml` / `html`. So `river run . --baseline base.json --output json > result.json` still writes a valid JSON file.

### Creating a baseline file

If you save a result with `--output json`, you can reuse it directly as a baseline.

```bash
# Create the baseline on main
git switch main
river run . --output json > baseline-findings.json

# Check for regressions on the PR branch
git switch feature/my-change
river run . --baseline ./baseline-findings.json
```

## Example CI integration

A minimal example that flags a net increase in findings on a PR.

```bash
# Assumes the baseline (main's findings) is kept as an artifact
river run . --baseline ./baseline-findings.json --save
```

Combining `--save` accumulates each PR's run in the Run store, so you can later review trends with `river runs summary`.

## Related pages

- [Stable Interfaces (CLI reference)](../reference/stable-interfaces.md) — flag and subcommand list
- [Use Riverbed Memory](./use-riverbed-memory.md) — suppressing findings
- [Tracing / Observability](./tracing.md)
