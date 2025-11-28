#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

mkdir -p "$ROOT/scripts" "$ROOT/docs" "$ROOT/docs/tutorials" "$ROOT/docs/how-to" "$ROOT/docs/reference" "$ROOT/docs/explanation" \
  "$ROOT/skills/upstream" "$ROOT/skills/midstream" "$ROOT/skills/downstream" \
  "$ROOT/assets/logo" "$ROOT/assets/icons" "$ROOT/assets/banners" \
  "$ROOT/.github/workflows"

write_readme() {
  cat <<'EORD' > "$ROOT/README.md"
# River Reviewer

![River Reviewer logo](assets/logo/river-reviewer-logo.svg)

RR (River Reviewer) is a flow-aware review assistant that moves with your delivery stream.

## Flow at a glance

- **Upstream → Midstream → Downstream**: design, implementation, and test/QA phases stay connected.
- **Upstream-first**: catch design drift early with ADR-aware skills.
- **Stream router**: picks skills per requested phase or change set.
- **(Future) Riverbed Memory**: retains past findings, ADR links, and WontFix decisions for consistent follow-up.

## Repository layout

```
README.md
assets/           # official RR logos/icons
schemas/          # JSON Schema for skills and outputs
skills/           # upstream/midstream/downstream skills (Markdown + frontmatter)
scripts/          # setup and skill refactor utilities
docs/             # tutorials, how-to, reference, explanation
.github/river-reviewer/ # River Reviewer checklists shared with CI/agents
```

## Quick start (GitHub Actions)

Minimal workflow to run River Reviewer in the midstream phase:

```yaml
name: River Reviewer
on:
  pull_request:
    branches: [main]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Run River Reviewer (midstream)
        uses: s977043/river-reviewer@v0
        with:
          phase: midstream
```

## Skill definition

Skills use YAML frontmatter for metadata and Markdown for guidance. Required fields: `id`, `name`, `description`, `phase`, `applyTo`.

```markdown
---
id: rr-midstream-performance-001
name: Midstream Performance Guardrails
description: Ensure midstream changes avoid common performance pitfalls.
phase: midstream
applyTo:
  - "src/**/*.ts"
tags: [performance, efficiency]
severity: major
---

- Check for accidental O(n^2) loops over large collections.
- Prefer streaming/iterators when handling large payloads.
- Flag synchronous I/O in request paths.
- Suggest benchmarks when risky changes are detected.
```

## Schemas & loader

- JSON Schema lives in `schemas/skill.schema.json` and `schemas/output.schema.json`.
- `scripts/rr_validate_skills.py` loads and validates skills recursively with `--phase upstream|midstream|downstream|all`.
- `scripts/setup_river_reviewer.sh` bootstraps the directory layout and placeholder files.

## Contributing

See `CONTRIBUTING.md` for guidance. Issues and PRs are welcome as we expand River Reviewer.

## License

- `LICENSE`: Apache-2.0 for repository scaffolding/config
- `LICENSE-CODE`: MIT for code and scripts
- `LICENSE-CONTENT`: CC BY 4.0 for docs and media
EORD
}

if [[ ! -f "$ROOT/README.md" ]]; then
  write_readme
  echo "README.md created with River Reviewer content."
elif [[ "$FORCE" -eq 1 ]]; then
  write_readme
  echo "README.md refreshed with River Reviewer content (force mode)."
else
  echo "README.md exists; use --force to overwrite. Skipping README update."
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
