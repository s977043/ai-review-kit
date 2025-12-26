---
title: Stable Interfaces (CLI / GitHub Actions)
---

River Reviewer is growing as an OSS project, and internal implementations may change. However, we define **stable contracts** so users can adopt it with confidence.

Breaking changes generally require a **major version bump**.

## Stable Contract

The following elements are treated as "public interfaces":

- Skill definitions (`schemas/skill.schema.json`) and their semantics (severity/confidence, etc.)
- GitHub Actions (`.github/actions/river-reviewer/action.yml`) inputs / outputs and behavior
- CLI (`river` / `river-reviewer`) commands/options and exit codes
- Idempotent update method for PR comments (marker)

## CLI (`river`) Reference (Minimal)

### Commands

- `river run <path>`: Run review locally
- `river doctor <path>`: Diagnose config/prerequisites and offer hints

### Main Options

- `--phase <upstream|midstream|downstream>`: Review phase (Default: `midstream`)
- `--planner <off|order|prune>`: Planner mode (Default: `off`)
- `--dry-run`: Run without calling external APIs
- `--debug`: Output debug info
- `--estimate`: Cost estimation only (no review execution)
- `--max-cost <usd>`: Abort if estimate exceeds limit
- `--output <text|markdown>`: Output format (GitHub Actions uses `markdown`)
- `--context <list>`: Available contexts (e.g., `diff,fullFile`)
- `--dependency <list>`: Available dependencies (e.g., `code_search,test_runner`)

### Exit Codes

- `0`: Success (Review/Diagnosis/Estimation completed)
- `1`: Failure (Invalid input, git diff failure, skill validation failure, `--max-cost` exceeded, etc.)

## GitHub Actions (`river-reviewer`) Reference (Minimal)

### inputs (Stable)

See `.github/actions/river-reviewer/action.yml` for definition.

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

- **Updates** comment containing `<!-- river-reviewer -->` marker; creates new if missing.
- Truncates tail if comment body is too long (limit exists).

## Versioning (Handling Breaking Changes)

Changing the following requires a major version bump as a breaking change:

- Changing/Removing `river` CLI option names or meanings
- Changing/Removing Action inputs / outputs
- Changing required fields in Skill Schema, or changing meanings of existing fields

For stable Action behavior, we recommend **pinning to a release tag** (e.g., `@v0.1.1`) instead of `@main`.
