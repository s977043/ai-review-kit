# Runner CLI Reference

> **Scope note**: this page covers only the `--reviewers` flag of `river run` and the validation commands.
>
> - For every other `river run` flag (`--phase` / `--planner` / `--dry-run` / `--output` / `--max-cost` / `--debug` / `--estimate` and so on), see **[stable-interfaces.en.md](./stable-interfaces.en.md)**.
> - For the `river review exec` flags used in a W-check (`--artifact`, `--ensemble`, `--phase`), see the **[W-check guide](../guides/w-check.en.md)** and **[cli-review-exec-spec.en.md](./cli-review-exec-spec.en.md)**.

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

### `river run` / `src/cli.mjs`

| Code | Meaning                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                     |
| `1`  | Runtime error, schema error, or argument error (including an unknown command and a missing or invalid option value)         |
| `2`  | The `--warn-on` warning threshold was exceeded                                                                              |
| `3`  | An `--gate` ESCALATE verdict, a configuration error raised by the `review` handler, or an unimplemented `review` subcommand |

The exit code for argument errors (usage errors) was unified to exit 1 plus a stderr summary in #1709. Unknown commands and missing or invalid option values were unified in Slice 2. Unknown options, surplus positionals, and the value-missing paths that remained (for example `--from` / `--cases`) were unified in Slice 3. Printing the full help to stdout and exiting 0 is kept only for an explicit `--help` and for invocation with no arguments.

A missing or unknown `river review` subcommand also moved to exit 1 in #1755. Exit 3 now remains for three families of cases, none of which is about how the arguments were written:

- An `--gate` ESCALATE verdict
- A configuration error detected by the `review` handler (such as `--output html`)
- An unimplemented `review` path (`river review verify`, and `river review plan` without `--plan-only`, return exit 3 as "not implemented in Phase 3")

Thanks to this unification, an option-name typo, a surplus positional, and a missing value are all detectable as exit 1 in `$?`. The **validity of the value** is checked in the parse layer for the following options.

- Enumerated values: `--phase` / `--severity` / `--planner` / `--depth` / `--output` / `--format` / `--fail-on` / `--warn-on` / `--source` / `--fingerprint-algo`
- Numeric values: `--pr` / `--threshold` / `--min` / `--max-cost`
- Dates: `--expires` / `--month`

No data write (adding a feedback or suppression entry, for instance) ever happens ahead of a usage error.

`--base <ref>` is validated in the handler layer rather than the parse layer. `river run`, `river skills`, and `river review` (`plan` / `exec` / `route`) share a single resolution path: the value is trimmed first, then checked with `git rev-parse` (#2051 / #2057).

- A blank value and a ref the repository cannot resolve are usage errors, exit 1
- A ref that yields an empty range is not fatal; it is announced as a warning on stderr. The wording distinguishes a ref that shares no history with HEAD from one that is ahead of HEAD (#2067)
- What an omitted `--base` falls back to differs per surface. `river run` and `river skills` use the auto-detected default branch, which this check does not apply to. `river review plan` runs no git at all, and the `diff` artifact is then the only source of the diff (see the [CLI review plan spec](./cli-review-plan-spec.en.md))

`river skills` used to accept `--base` and never read it, always reviewing the diff against the auto-detected default branch (#2051). Now that the value is read, a caller that passes `--base` sees a different set of reviewed files and findings; drop the flag to keep the previous range. `river run` did read the value but never checked that it resolved, silently falling back to HEAD (#2057), so a typo that used to exit 0 now exits 1.

`--expires` accepts only the RFC 3339 `YYYY-MM-DD` form and the date-time form. A date-only input is read as UTC midnight and normalized to a date-time when stored, because `expiresAt` in `schemas/suppression-context.schema.json` is declared `format: date-time`.

Value validation does not reach every option, though. The following three paths still exit 0, so `$?` alone does not catch them.

- Passing a non-existent path to `--baseline` (the regression comparison is silently skipped)
- Passing unknown vocabulary to `--context` / `--dependency`
- Passing `--base` to a surface that does not read a diff (`doctor`, `runs list`, and `eval` accept the flag without consuming it; measured 2026-09-04 with an unresolvable ref, all exit 0)

The `RIVER_PHASE` environment variable now goes through the same vocabulary and the same case-insensitive validation as `--phase` (#1759 C2). An invalid value prints the same shape of error, `Error: RIVER_PHASE must be one of: ...`, to stderr and exits 1. Unset or empty still falls back to the default `midstream`.

Option values are passed **separated by a space**. The `=`-joined form such as `--output=json` is not accepted and exits 1 as an unknown option (`--run-id=<id>` is the one legacy exception). A value that contains `=` **inside** it, as in `--artifact plan=./plan.md`, is valid.

The target path may be written either before or after the options on these surfaces only:

- `run` / `doctor`
- `skills` (the form without a subcommand)
- `review` (`plan` / `exec` / `verify` / `route`)
- `evolve aggregate` (`evolve replay` is out of scope because it takes its input from `--spec`)

Within that range, `river run . --dry-run` and `river run --dry-run .` mean the same thing. Only one non-option token is read as the target path; a second one is a surplus positional and exits 1.

The `review` subcommands (`plan` / `exec` / `verify` / `route`) may likewise be written before or after the options: `river review plan --plan-only` and `river review --plan-only plan` are equivalent. Forgetting the subcommand, or passing a token outside the vocabulary, exits 1.

Under `review` the subcommand word does not count toward the positional budget above. `river review --plan-only plan ./sub` is accepted as one subcommand plus one path; the surplus positional starts at the third non-option token.

The POSIX `--` terminator works as well. A token placed after `--` is read as a path rather than as an option or a subcommand name. Here too only the first one is taken, and a second exits 1 as a surplus positional. `river run -- .` means the same as `river run .`. `river run -- --dry-run` is treated as specifying a path named `--dry-run`, so the `--dry-run` flag does not take effect.

A token after `--` must be an existing path; if it does not exist, the command exits 1. This prevents a typo such as `river evolve aggregate -- ./typo` from exiting 0 as "a successful aggregation over zero records". A bare `--` with no token after it is accepted as a no-op on every command surface.

Other surfaces (`skills list` / `runs list` / `promote list` / `eval` and so on) do not take a trailing path and exit 1 with a surplus positional. Subcommands that take several non-option tokens by design — `runs diff <id1> <id2> [<id3>...]` or `promote approve <id>` — are handled separately.

### `river review` / `river eval` (`runners/cli`)

The commands in `runners/cli` currently collapse every error into code `1`. Code `3` never occurs.

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| `0`  | Success                                                         |
| `1`  | Every abnormal termination, including runtime and schema errors |

### Validation script (Python)

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
