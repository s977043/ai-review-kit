---
title: Manifest-driven Skills Guide
---

This is an implementation guide for describing River Reviewer skills flexibly in "manifest (YAML/Markdown)" format and applying them across multiple phases or file globs. It summarizes samples following `schemas/skill.schema.json` along with validation and operational procedures.

## 1. Skill Definition Format (Markdown / YAML)

### Markdown (Frontmatter)

```markdown
---
id: rr-midstream-observability-001
name: Logging and Observability Guard
description: Encourage proper logging instead of swallowing exceptions
phase:
  - midstream
applyTo:
  - 'src/**/*.ts'
tags:
  - observability
severity: major
inputContext:
  - diff
outputKind:
  - findings
modelHint: balanced
---

## Goal

- Reduce swallowed exceptions and missing logs.
```

### YAML (Nested Structure)

```yaml
metadata:
  id: rr-downstream-test-coverage-001
  name: Test Coverage Guard
  description: Detect missing tests for added features
  phase: [downstream]
  files: ['src/**/*.ts', 'tests/**/*.ts'] # files is an alias for metadata.applyTo (same as frontmatter applyTo)
  severity: major
  inputContext: [tests]
  outputKind: [findings]
instruction: |
  Check if tests exist for changed parts, and propose concrete tests if missing.
```

### YAML (Flat Structure)

```yaml
id: rr-midstream-security-001
name: Basic Security Review
description: Detect basic security pitfalls
phase: [midstream, downstream]
applyTo: ['**/*.js']
tags: [security]
inputContext: [fullFile]
outputKind: [findings]
instruction: |
  Check for hardcoded secrets or dangerous function calls, and offer fixes if needed.
```

Points:

- `phase` allows single value or array.
- `files` can be used as an alias for `applyTo`.
- The body (Markdown body or YAML `instruction`) becomes the skill instruction.

## 2. Recommended Directory Structure

- `skills/core/`: Default loaded skills
- `skills/community/`: External/Library-specific skills
- `skills/private/`: Project-specific skills
- `skills/agent-skills/`: Packages following Agent Skills spec (`SKILL.md` + `references/`, not validated by River Reviewer core)
- Test fixtures should be separated in `tests/fixtures/skills/` etc.

## 3. Validation Flow

- Schema Validation: `npm run skills:validate`
- Agent Skills Validation: `npm run agent-skills:validate`
- Lint/Format: `npm run lint` (includes markdownlint/textlint/Prettier)
- Unit Tests: `npm test` (includes skill-loader)

Run these in CI to reject broken manifests.

## 4. Operational Tips

- Strictly specify `phase` to avoid unnecessary skill calls.
- Narrow glob patterns (`applyTo`/`files`) to reduce false positives.
- Add `x-` prefix to extension fields to avoid collision with future schema updates.
- Explicitly specify `skillsDir` in Runner config or env vars if loading skills from outside repo root.

## 5. Compatibility Checklist with Existing Skills

- Meets required fields (`id`, `name`, `description`, `phase`, `applyTo/files`).
- Matches Runner's phase check (`matchesPhase`) for multiple phase specifications.
- `instruction` (body) is correctly extracted in both Markdown/YAML formats.
- New aliases/extension fields do not break existing tools even if ignored.
