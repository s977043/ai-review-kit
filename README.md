# River Reviewer

![River Reviewer logo](assets/logo/river-reviewer-logo.svg)

RR (River Reviewer) is a flow-aware review assistant that moves with your delivery stream.

## Flow at a glance

- **Upstream → Midstream → Downstream**: design, implementation, and test/QA phases stay connected.
- **Upstream-first**: catch design drift early with ADR-aware skills.
- **Stream router**: picks skills per requested phase or change set.
- **(Future) Riverbed Memory**: retains past findings, ADR links, and WontFix decisions for consistent follow-up.

## Repository layout

```text
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
  - 'src/**/*.ts'
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
