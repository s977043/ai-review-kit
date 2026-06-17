---
title: Stable Interfaces (CLI / GitHub Actions)
---

River Review is growing as an OSS project, and internal implementations may change. However, we define **stable contracts** so users can adopt it with confidence.

Breaking changes generally require a **major version bump**.

## Stable Contract

The following elements are treated as "public interfaces":

- Skill definitions (`schemas/skill.schema.json`) and their semantics (severity/confidence, etc.)
- GitHub Actions (`runners/github-action/action.yml`) inputs / outputs and behavior
- CLI (`river` / `river-review`) commands/options and exit codes
- Idempotent update method for PR comments (marker)

## Component Stability Labels

Current stability level for each surface.

| Label            | Definition                                                                |
| ---------------- | ------------------------------------------------------------------------- |
| **Stable**       | Breaking changes require a major version bump. Recommended for production |
| **Beta**         | API may change in minor versions. Deprecation notice given before removal |
| **Experimental** | May change or be removed without notice. Use for evaluation only          |

| Surface                                    | Label        | Notes                                      |
| ------------------------------------------ | ------------ | ------------------------------------------ |
| GitHub Action                              | Beta         | v0.x, breaking changes possible            |
| CLI (`river` command)                      | Beta         | Stable interfaces below are maintained     |
| Skill Schema (`schemas/skill.schema.json`) | Beta         | CI-validated, field extensions possible    |
| Node API (`runners/node-api/`)             | Experimental | `private: true`, not published to npm      |
| Agent Skills bridge                        | Experimental | Added in v0.9.0, still maturing            |
| Riverbed Memory                            | Experimental | Design phase, stabilization planned for v1 |

## CLI (`river`) Reference (Minimal)

### Commands

- `river run <path>`: Run review locally
- `river doctor <path>`: Diagnose config/prerequisites and offer hints

### Main Options

- `--phase <upstream|midstream|downstream>`: Review phase (Default: `midstream`)
- `--planner <off|order|prune>`: Planner mode (Default: `off`)
- `--dry-run`: Run without calling external APIs
- `--offline` (alias `--rules-only`): Skip AI even when an API key is set; review on deterministic mechanical checks only (reproduces the Auto-approve gate locally when CI is unavailable)
- `--debug`: Output debug info
- `--explain`: Print the resolved skills / gates / config tier in human-readable form (to stderr)
- `--estimate`: Cost estimation only (no review execution)
- `--max-cost <usd>`: Abort if estimate exceeds limit
- `--output <text|markdown|json|yaml|html>`: Output format (GitHub Actions uses `markdown`; `html` emits a self-contained HTML report)
- `--context <list>`: Available contexts (e.g., `diff,fullFile`)
- `--dependency <list>`: Available dependencies (e.g., `code_search,test_runner`)

### Exit Codes

Exit codes other than `0` are only produced when `--fail-on` / `--warn-on` is specified. **Without `--fail-on`, River Review always exits `0` (regardless of findings).**

| Exit code | Condition                                                                                 | Description                           |
| --------- | ----------------------------------------------------------------------------------------- | ------------------------------------- |
| `0`       | `--fail-on` not specified / `--advisory-only` / max severity < warn rank                  | Pass (always 0)                       |
| `1`       | `--fail-on <sev>` specified and max severity ≥ fail rank                                  | Fail (blocking threshold met)         |
| `2`       | `--warn-on <sev>` specified and max severity ≥ warn rank but < fail rank                  | Warn (warn threshold met, below fail) |
| `1`       | Invalid input / git diff failure / skill validation failure / `--max-cost` exceeded, etc. | Error exit                            |

Severity rank (low → high): `info`=0 / `minor`=1 / `major`=2 / `critical`=3

For the full usage contract including stop conditions, divergence guards, and oscillation detection in self-fix loops, see [Loop Convergence Contract](./loop-convergence-contract.en.md).

## GitHub Actions (`river-review`) Reference (Minimal)

### inputs (Stable)

See `runners/github-action/action.yml` for definition.

- `phase`: `upstream|midstream|downstream`
- `planner`: `off|order|prune`
- `target`: Repository path to review
- `comment`: Whether to post PR comment (only for `pull_request`)
- `dry_run`: Run without calling external APIs
- `debug`: Output debug info
- `estimate`: Run cost estimation only
- `max_cost`: Abort if estimate exceeds limit
- `node_version`: Node.js version for Action execution

### outputs (Stable)

- `comment_path`: Path to Markdown output in Actions runner temp area (used for posting PR comment)

### PR Comment Contract (Idempotent)

- **Updates** comment containing `<!-- river-review -->` marker; creates new if missing.
- Truncates tail if comment body is too long (limit exists).

## Versioning (Handling Breaking Changes)

Changing the following requires a major version bump as a breaking change:

- Changing/Removing `river` CLI option names or meanings
- Changing/Removing Action inputs / outputs
- Changing required fields in Skill Schema, or changing meanings of existing fields

For stable Action behavior, we recommend **pinning to a release tag** (e.g., `@v1.22.0`) instead of `@main`.

## Schema Versioning Policy

JSON Schema files under `schemas/` carry a `version` field (for example `"version": { "const": "1" }` in `review-artifact.schema.json`).

- Backward-compatible additions (optional fields, new `enum` values) stay in the same schema file.
- Breaking changes (new required fields, changing an existing field's type or meaning, removing `enum` values) follow one of:
  1. Create a new schema file (e.g. `review-artifact.v2.schema.json`), assign `version: const "2"`, and keep the old schema for at least one major version.
  2. Use `oneOf` in the existing schema so old and new versions coexist. Discriminate on the `version` field so a single `$ref` can handle multiple versions.

When adding a new schema, remember to update related documentation (`pages/reference/_meta.json`, etc.).
