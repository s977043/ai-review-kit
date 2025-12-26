---
title: Adding a Skill (Shortest Path)
---

This guide summarizes the **shortest path** to add a new skill (`skills/**/*.md`) to River Reviewer, validate it, and run it locally.

For detailed writing guidelines (Anti-patterns, Evidence, Non-goals, False positive guards, etc.), refer to `pages/guides/write-a-skill.en.md`.

## 0) Prerequisites

- Node.js (This repo uses `node --test`)
- Run `npm ci` if dependencies are not installed

## 1) Create Skill from Template

1. Copy `skill_template.md` and place it under the target phase directory.
   - Example: `skills/midstream/rr-midstream-my-skill-001.md`
2. Fill in the minimum YAML frontmatter (Refer to `schemas/skill.schema.json` for required fields).
   - `id`: Unique ID (e.g., `rr-midstream-my-skill-001`)
   - `name`: Skill name
   - `description`: What to detect/point out (short)
   - `phase`: `upstream|midstream|downstream`
   - `applyTo`: Glob for target files (Recommend narrowing scope initially)

See `pages/reference/metadata-fields.en.md` for metadata details.

## 2) Pass Schema Validation

```bash
npm run skills:validate
```

If it fails, fix the fields shown in the error message (missing required, enum mismatch, etc.) and re-run.

## 3) Run Local Dry-run (No API)

To verify behavior first without LLM (Prioritizing reproducibility):

```bash
river run . --phase midstream --dry-run --debug --context diff,fullFile
```

Points:

- Skill is not selected if `applyTo` does not match changed files.
- If `inputContext` is set, skill is skipped if not included in `--context`.
  - If unsure, starting with `inputContext: [diff]` is safe.

## 4) Minimum Checks for PR

- `npm run skills:validate`
- `npm test`
- If possible, check perspectives for False positive guards / Non-goals (What NOT to say)
