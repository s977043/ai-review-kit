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
