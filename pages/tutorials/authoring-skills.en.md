# How to Write Skills

In River Reviewer, checks for each phase are added as "skills". Skills are defined using YAML frontmatter + Markdown and must comply with `schemas/skill.schema.json`.

## Basic Rules

- Focus on one perspective per skill (e.g., security, performance, pre-release checks).
- Required fields: `id` / `name` / `description` / `phase` / `applyTo`.
- Set `phase` to `upstream`, `midstream`, or `downstream`, and match the directory structure (e.g., `skills/midstream/`).

## Sample

```markdown
---
id: rr-upstream-architecture-001
name: Architecture Consistency Check
description: Verify alignment with ADRs and design guides in the upstream phase.
phase: upstream
applyTo:
  - 'docs/adr/**/*.md'
severity: major
tags: [architecture, decision-record]
---

- Verify that changes do not contradict existing ADRs.
- If a new decision is needed, prompt the creation of an ADR draft.
- Check if the impact scope and risks are explicitly stated.
```

After saving, you can run `scripts/rr_validate_skills.py --phase upstream` to perform schema validation and phase-specific loading.
