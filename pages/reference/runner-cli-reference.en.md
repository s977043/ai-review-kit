# Runner CLI Reference

Use the Runner CLI to validate River Review agents and skills locally or in CI.
A lightweight Python runner outputs structured review results that follow `schemas/output.schema.json`.
Install the required dependency with `pip install jsonschema` before running the Python example.

## `--reviewers` flag

The `--reviewers` flag on `river run` accepts a comma-separated list of role names or the special keyword `auto`.

### `auto` keyword

When `--reviewers auto` is specified, River Review analyzes the diff content and selects reviewer roles automatically. `bug-hunter` is always included; additional roles are added based on the following signals:

| Signal                                                                                                      | Role added            |
| ----------------------------------------------------------------------------------------------------------- | --------------------- |
| config / schema / migration / infra files changed, or risk-escalated files exist                            | `security-scanner`    |
| test files changed, or 3 or more app files changed                                                          | `test-gap`            |
| package manifest / lockfile changed (`package.json` / `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`) | `dependency-reviewer` |
| UI / component / styling files changed (`.tsx` / `.jsx` / `.css` / `.scss` / `.vue` / `.svelte`)            | `frontend-reviewer`   |
| Workflows under `.github/workflows/` changed                                                                | `ci-cd-reviewer`      |

If no signals are detected, only `bug-hunter` is used.

The selected roles are reported in the `autoSelectedRoles` field of the JSON output:

```json
{
  "autoSelectedRoles": ["bug-hunter", "security-scanner"]
}
```

### Large-diff chunking and finding deduplication

When reviewing with multiple roles (including `auto`), large diffs are automatically split into chunks and run in parallel as role × chunk. Findings from each run are deduplicated across chunks and roles before final IDs are assigned (implemented in `src/lib/reviewer-orchestrator.mjs` as `splitDiffIntoChunks` / `deduplicateFindings`), so duplicate findings on the same location are collapsed into one.

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
