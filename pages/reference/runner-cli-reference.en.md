# Runner CLI Reference

Use the Runner CLI to validate River Review agents and skills locally or in CI.
A lightweight Python runner outputs structured review results that follow `schemas/output.schema.json`.
Install the required dependency with `pip install jsonschema` before running the Python example.

## `--reviewers` flag

The `--reviewers` flag on `river run` accepts a comma-separated list of role names or the special keyword `auto`.

### `auto` keyword

When `--reviewers auto` is specified, River Review analyzes the diff content and selects reviewer roles automatically. `bug-hunter` is always included; additional roles are added based on the following signals:

| Signal                                                                                                               | Role added            |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- |
| config / schema / migration / infra files changed, or risk-escalated files exist                                     | `security-scanner`    |
| test files changed, or 3 or more app files changed                                                                   | `test-gap`            |
| package manifest / lockfile changed (`package.json` / `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`)          | `dependency-reviewer` |
| UI / component / styling files changed (`.tsx` / `.jsx` / `.css` / `.scss` / `.sass` / `.less` / `.vue` / `.svelte`) | `frontend-reviewer`   |
| Workflows under `.github/workflows/` changed                                                                         | `ci-cd-reviewer`      |

If no signals are detected, only `bug-hunter` is used.

The selected roles are reported in the `autoSelectedRoles` field of the JSON output:

```json
{
  "autoSelectedRoles": ["bug-hunter", "security-scanner"]
}
```

### Large-diff chunking and finding deduplication

When reviewing with multiple roles (including `auto`), large diffs are automatically split into chunks and run in parallel as role × chunk. Findings from each run are deduplicated across chunks and roles before final IDs are assigned (implemented in `src/lib/reviewer-orchestrator.mjs` as `splitDiffIntoChunks` / `deduplicateFindings`), so duplicate findings on the same location are collapsed into one.

### Progress output and per-role timeout

Parallel role execution prints one line per role start, completion, and failure to **stderr**. The deliverable goes to stdout, so progress lines never corrupt the JSON / YAML / Markdown artifact.

```text
Reviewer bug-hunter: start
Reviewer security-scanner: start
Reviewer bug-hunter: done in 6.2s (3 findings)
Reviewer security-scanner: timeout after 120.0s (other chunks/roles continue)
Reviewers: 1/2 roles succeeded, 0 failed, 120.0s total (timed out: security-scanner)
```

The related flag and environment variable:

| Name                     | Kind   | Default                              | Description                                                                                                                                                                            |
| ------------------------ | ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--quiet`                | flag   | `false`                              | Suppresses the role progress lines above only. It does not affect the other logs `river run` writes (the run header, `Run saved:`, and so on)                                          |
| `RIVER_REVIEWER_TIMEOUT` | env    | unset                                | Per-role budget in milliseconds. Only integers in `1`–`3600000` are accepted; out-of-range or non-integer values are ignored with a warning. Wins over `review.orchestrator.timeoutMs` |
| `review.orchestrator.*`  | config | `timeoutMs` unset / `progress: true` | The equivalent settings in `.river-review.json`. See [Config / Schema Overview](./config-schema.md)                                                                                    |

The per-role timeout is disabled (unlimited) by default. **Leaving it unset does not change how long a run waits** — only observability improves; cutting a role off happens solely when a limit is configured.

The timeout is fail-soft: the role that hits the limit is recorded as a failed role and the run continues with the other roles' findings — the whole run is never aborted. **When no role at all succeeds the run counts as "review not executed"**, so the gate never returns GO (`decision` becomes `human-review-required` and `--gate` exits non-zero).

A cutoff is observable from:

| Surface                                   | Where it appears                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--output json`                           | top-level `timedOutRoles` (names of the roles cut off; the key is absent when none were)                        |
| run record (`--save` / automatic CI save) | `reviewDebug.timeoutMs` / `reviewDebug.timedOutRoles` / `reviewDebug.durationMs`                                |
| library callers                           | `reviewerResults[].timedOut` / `reviewerResults[].durationMs`, plus the same `debug.*` fields as the run record |

`--output yaml` and `--output html` do not carry the cutoff information. Use the JSON output for machine-readable decisions.

> **Note**: the timeout only bounds the orchestration-layer wait; it does not cancel the in-flight LLM call. The abandoned request keeps running until the budget in `src/lib/llm-pipeline.mjs` is exhausted (15 s per attempt plus bounded retries — roughly 45 s), so the process stays alive for that long after the `timeout` line is printed. True cancellation requires threading an `AbortSignal` through `generateReview()` and is out of scope for this change.

## Commands

- Agents: `npm run agents:validate` (or `node scripts/validate-agents.mjs`)
- Skills: `npm run skills:validate` (or `node scripts/validate-skills.mjs`)
- Structured output (Python): `python scripts/rr_runner.py --input tests/fixtures/structured-output/sample_llm_response.json`

## Exit codes

- `0`: validation completed successfully.
- `1`: schema checks didn't pass or a schema error occurred.

## Examples

```bash
# Validate all agents
npm run agents:validate

# Validate all skills
npm run skills:validate

# Build structured review output (writes to artifacts/river-review-output.json)
python scripts/rr_runner.py --input tests/fixtures/structured-output/sample_llm_response.json
```
