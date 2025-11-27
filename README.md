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
    branches: [main]
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
  - 'src/**/*.ts'
description: Ensure midstream changes avoid common performance pitfalls.
---

- Check for accidental O(n^2) loops over large collections.
- Prefer streaming/iterators when handling large payloads.
- Flag synchronous I/O in request paths.
- Suggest benchmarks when risky changes are detected.
```

## Planned Directory Structure

```text
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
