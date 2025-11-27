#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

mkdir -p "$ROOT/scripts" "$ROOT/docs" "$ROOT/schemas" \
  "$ROOT/skills/upstream" "$ROOT/skills/midstream" "$ROOT/skills/downstream" \
  "$ROOT/assets/logo" "$ROOT/assets/icons" "$ROOT/assets/banners" \
  "$ROOT/.github/workflows"

write_readme() {
  cat <<'EORD' > "$ROOT/README.md"
# River Reviewer

**Review that Flows With You.**  
流れに寄り添う AI レビューエージェント。

## What is River Reviewer?

River Reviewer is an AI review agent that follows the flow of delivery: **upstream** (design), **midstream** (implementation), and **downstream** (test/QA and improvement). It is upstream-first, flow-based, and metadata-driven so reviews stay aligned with your development cadence instead of blocking it.

- **Upstream-first**: start reviews at the design/ADR stage to prevent costly rework.
- **Flow-based**: non-blocking guidance that moves with PRs and releases.
- **Metadata-driven**: skills are defined as YAML frontmatter + Markdown playbooks.

## Core Concepts

- **Upstream**: requirements, architecture, ADRs—catch design drift early.
- **Midstream**: code implementation and PR review—keep changes consistent and safe.
- **Downstream**: test, QA, release prep—verify quality, coverage, and remediation.

## Architecture Overview (conceptual)

- **Upstream/Midstream/Downstream Skills**: YAML + Markdown skills organized by phase.
- **Stream Router**: routes relevant skills based on the requested phase or change set.
- **(Future) Riverbed Memory**: persistent memory for previous findings, ADR links, and WontFix decisions.

## Quick Start (GitHub Actions example)

Minimal workflow to run River Reviewer in the midstream phase:

```yaml
name: River Reviewer
on:
  pull_request:
    branches: [ main ]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run River Reviewer (midstream)
        uses: river-reviewer/action@v0 # placeholder action
        with:
          phase: midstream
```

## Skill Definition example

Skills use YAML frontmatter for metadata and Markdown for guidance:

```markdown
---
id: rr-midstream-performance-001
name: Midstream Performance Guardrails
phase: midstream
tags: [performance, efficiency]
severity: major
applyTo:
  - "src/**/*.ts"
description: Ensure midstream changes avoid common performance pitfalls.
---

- Check for accidental O(n^2) loops over large collections.
- Prefer streaming/iterators when handling large payloads.
- Flag synchronous I/O in request paths.
- Suggest benchmarks when risky changes are detected.
```

## Planned Directory Structure

```
skills/
  upstream/
  midstream/
  downstream/
schemas/
  skill.schema.json
docs/
  glossary.md
```

## High-level Roadmap

- Branding & README refresh
- Skill metadata schema
- Loader recursion & phase filter
- skills/ three-layer migration
- (Future) Riverbed Memory

## Contributing

See `CONTRIBUTING.md` for guidance. Issues and PRs are welcome as we migrate to River Reviewer.

## License

Apache-2.0 (see `LICENSE`).

## Status

AI Review Kit → River Reviewer への移行中。
EORD
}

if [[ -f "$ROOT/README.md" ]]; then
  if [[ ! -f "$ROOT/README.old" ]]; then
    cp "$ROOT/README.md" "$ROOT/README.old"
    echo "Backed up existing README.md to README.old"
  fi
  if [[ "$FORCE" -eq 1 ]]; then
    write_readme
    echo "README.md replaced with River Reviewer content (force mode)."
  else
    echo "README.md exists; use --force to overwrite. Skipping README update."
  fi
else
  write_readme
  echo "README.md created with River Reviewer content."
fi

cat <<'EOG' > "$ROOT/docs/glossary.md"
# River Reviewer Glossary

- **Upstream**: requirements, design, and architecture phase (including ADRs) where early review prevents costly rework.
- **Midstream**: implementation and pull request phase focused on code quality, security, and developer experience.
- **Downstream**: test, QA, and release-prep phase to verify coverage, resilience, and regression protection.
- **Skill**: a YAML frontmatter + Markdown unit of review guidance executed by River Reviewer.
- **Stream Router**: logic that selects and runs skills based on the requested phase and change context.
- **Riverbed Memory (Future)**: persistent context layer for previous findings, ADR references, and WontFix decisions to keep reviews consistent over time.
EOG

cat <<'EOS' > "$ROOT/docs/skill-schema.md"
# Skill Schema

River Reviewer skills use YAML frontmatter for metadata and Markdown for guidance. The metadata fields are validated by `schemas/skill.schema.json`.

## Fields

- `id` (string, required): unique identifier (e.g., `rr-upstream-design-architecture-001`); stable across moves/renames.
- `name` (string, required): human-readable skill name.
- `phase` (string, required): one of `upstream`, `midstream`, or `downstream`.
- `tags` (string[], optional): keywords that group related skills.
- `severity` (string, optional): `info`, `minor`, `major`, or `critical` to indicate impact.
- `applyTo` (string[], required): glob patterns for files the skill should evaluate.
- `description` (string, required): concise explanation of what the skill checks.

## YAML Example (midstream performance)

```yaml
---
id: rr-midstream-performance-002
name: Midstream Performance Budget Check
phase: midstream
tags:
  - performance
  - latency
severity: major
applyTo:
  - "src/**/*.ts"
  - "packages/**/src/**/*.{ts,js}"
description: Flag midstream changes that risk latency regressions or heavy resource use.
---

Ensure changed code paths avoid unnecessary synchronous I/O, unbounded concurrency, and repeated heavy computations. Recommend benchmarks when touching hot paths.
```
EOS

cat <<'EOJ' > "$ROOT/schemas/skill.schema.json"
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "River Reviewer Skill Metadata Schema",
  "type": "object",
  "required": ["id", "name", "phase", "applyTo", "description"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "minLength": 3
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "phase": {
      "type": "string",
      "enum": ["upstream", "midstream", "downstream"]
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "uniqueItems": true
    },
    "severity": {
      "type": "string",
      "enum": ["info", "minor", "major", "critical"]
    },
    "applyTo": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string"
      }
    },
    "description": {
      "type": "string",
      "minLength": 1
    }
  }
}
EOJ

cat <<'EOW' > "$ROOT/.github/workflows/river-reviewer.yml"
name: River Reviewer (placeholder)

on:
  workflow_dispatch:
  pull_request:
    branches: [ main ]

jobs:
  river-reviewer:
    runs-on: ubuntu-latest
    env:
      RR_PHASE: midstream
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Run River Reviewer
        run: echo "River Reviewer placeholder run for phase=${RR_PHASE:-midstream}"
EOW

# Ensure placeholder markers so empty directories are tracked when needed
for dir in "$ROOT/skills" "$ROOT/skills/upstream" "$ROOT/skills/midstream" "$ROOT/skills/downstream" \
           "$ROOT/assets/logo" "$ROOT/assets/icons" "$ROOT/assets/banners"; do
  touch "$dir/.gitkeep"
done

echo "[DONE] River Reviewer bootstrap completed."
