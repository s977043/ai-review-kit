# Review Artifact

A structured JSON output schema for River Review run results. It bundles the execution plan, repository context, findings, and debug information into a single artifact that can be consumed by audit, memory ingestion, and evaluation pipelines.

## Overview

The existing `output.schema.json` defines the format of individual findings (issues), but does not cover the metadata of a complete review run -- which skills were executed, which files were targeted, the planner's reasoning, and so on.

The Review Artifact schema provides a complete record of a review execution.

- **Schema file**: [`schemas/review-artifact.schema.json`](../../schemas/review-artifact.schema.json)
- **JSON Schema Draft**: 2020-12
- **Version**: `1` (tracked via the `version` field)

## Field Reference

### Top-Level

| Field                 | Type                 | Required | Description                                                                                                                                                                                                             |
| --------------------- | -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`             | `string`             | Yes      | Schema version. Currently always `"1"`.                                                                                                                                                                                 |
| `timestamp`           | `string` (date-time) | Yes      | ISO 8601 timestamp of when the review run completed.                                                                                                                                                                    |
| `phase`               | `string`             | Yes      | SDLC phase of the review. `upstream` / `midstream` / `downstream`.                                                                                                                                                      |
| `status`              | `string`             | Yes      | Terminal status. `ok` / `no-changes` / `skipped-by-label` / `error`.                                                                                                                                                    |
| `decision`            | `string`             | No       | Top-level verdict derived from findings (`auto-approve` / `human-review-recommended` / `human-review-required`). Maps to the proposal's pass / warn / fail. Recommendation only; does not bypass HITL policy.           |
| `suggestedLoopSignal` | `string`             | No       | Layer-1 loop signal for agentic fix loops. One of `NO_SIGNAL` / `REVISE_REQUIRED` / `CONVERGED` / `ESCALATE_HUMAN`. Additive; absent on older artifacts. See [Loop Convergence Contract](loop-convergence-contract.md). |
| `usage`               | `object`             | No       | Provider / model when an LLM ran (token / cost only when the surface reports them). Absent for heuristic / dry-run / plan-only.                                                                                         |
| `trace`               | `object`             | No       | Run trace. `run_id` is a unique id generated at artifact finalization (independent of the `--save` result-store id; equality is not guaranteed).                                                                        |
| `plan`                | `object`             | No       | Execution plan. See below.                                                                                                                                                                                              |
| `findings`            | `array`              | No       | Array of review findings. Each item is compatible with the issue schema in `output.schema.json` (defined inline as `$defs/finding`).                                                                                    |
| `context`             | `object`             | No       | Repository and diff context.                                                                                                                                                                                            |
| `debug`               | `object`             | No       | Free-form debug information. Structure is not guaranteed across versions.                                                                                                                                               |

### `plan` Object

| Field            | Type     | Description                                                                                                                                                |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectedSkills` | `array`  | Skills selected for execution. Each item has `id` (required), `name` (required), `phase`, and `modelHint` (one of `cheap` / `balanced` / `high-accuracy`). |
| `skippedSkills`  | `array`  | Skills excluded from the run. Each item has `id` (required) and `reasons` (required, string array).                                                        |
| `plannerMode`    | `string` | AI planner mode. `off` / `order` / `prune`.                                                                                                                |
| `plannerReasons` | `array`  | Per-skill reasoning from the AI planner. Each item has `id` (required) and `reason` (required).                                                            |
| `impactTags`     | `array`  | Tags describing the impact area of changes (e.g. `security`, `performance`).                                                                               |

### `context` Object

| Field              | Type     | Description                                                 |
| ------------------ | -------- | ----------------------------------------------------------- |
| `repoRoot`         | `string` | Absolute path to the repository root.                       |
| `defaultBranch`    | `string` | Default branch name (e.g. `main`).                          |
| `mergeBase`        | `string` | Git merge-base commit SHA used for diffing.                 |
| `changedFiles`     | `array`  | List of file paths included in the review diff.             |
| `tokenEstimate`    | `number` | Estimated token count of the optimized diff text (>= 0).    |
| `rawTokenEstimate` | `number` | Estimated token count of the raw (unoptimized) diff (>= 0). |
| `reduction`        | `number` | Percentage of tokens saved by diff optimization (0--100).   |

### `status` Values

| Value              | Meaning                                  |
| ------------------ | ---------------------------------------- |
| `ok`               | Review completed successfully.           |
| `no-changes`       | No diff to review.                       |
| `skipped-by-label` | Run was skipped due to a PR label match. |
| `error`            | An error occurred during the run.        |

## Downstream Consumers

The Review Artifact is designed to be consumed by the following systems.

### CI (GitHub Actions)

- Retrieves review results as structured data for generating PR comments and status checks.
- The `status` field enables early-return decisions.

### Riverbed Memory

- Stores review results as repository-specific learning data.
- Records which skills were effective from the `plan` section.
- Analyzes historical finding patterns from `findings`.

### Eval (Evaluation Pipeline)

- Compares `plan` and `findings` against evaluation fixtures to measure skill accuracy.
- Tracks diff optimization effectiveness via `context.tokenEstimate` and `context.reduction`.

## Serialization

- Format: **JSON**
- Encoding: UTF-8
- File extension: `.json`
- MIME type: `application/json`

## Related Documents

- [Review Output Schema](../../schemas/output.schema.json) -- Individual finding (issue) definitions
- [Review Artifact Schema](../../schemas/review-artifact.schema.json) -- The JSON Schema file for this specification
- [Review Policy](./review-policy.en.md) -- AI review standard policy
- [Review Output Examples](./review-output-example.en.md) -- Review output examples
- [Riverbed Storage](./riverbed-storage.en.md) -- Riverbed Memory storage design
- [Evaluation Fixture Format](./evaluation-fixture-format.en.md) -- Evaluation fixture format
