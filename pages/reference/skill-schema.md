# Skill Schema

River Reviewer skills use YAML frontmatter for metadata and Markdown for guidance. The metadata fields are validated by `schemas/skill.schema.json`.

## Fields

- `id` (string, required): unique identifier (for example, `rr-upstream-design-architecture-001`); stable across moves/renames.
- `name` (string, required): human-readable skill name.
- `phase` (string, required): one of `upstream`, `midstream`, or `downstream`.
- `applyTo` (string[], required): glob patterns for files the skill should evaluate.
- `tags` (string[], optional): keywords that group related skills.
- `severity` (string, optional): impact level; one of `info`/`minor`/`major`/`critical`.
- `description` (string, required): concise explanation of what the skill checks.
- `inputContext` (string[], optional): required inputs the skill expects (for example `diff`, `fullFile`, `tests`, `adr`, `commitMessage`, `repoConfig`).
- `outputKind` (string[], optional, default `['findings']`): output categories (for example `findings`, `summary`, `actions`, `tests`, `metrics`, `questions`).
- `modelHint` (string, optional): model selection hint; one of `cheap`/`balanced`/`high-accuracy`.
- `dependencies` (string[], optional): downstream tools/resources required (for example `code_search`, `test_runner`, `adr_lookup`, `repo_metadata`, `coverage_report`, `tracing`, or `custom:*` for extensions).

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
  - 'src/**/*.ts'
  - 'packages/**/src/**/*.{ts,js}'
description: Flag midstream changes that risk latency regressions or heavy resource use.
---
Ensure changed code paths avoid unnecessary synchronous I/O and unbounded concurrency. Avoid repeated heavy computations. Recommend benchmarks when touching hot paths.
```
