# Creating Your First Skill

Build a simple River Reviewer skill that follows the Upstream → Midstream → Downstream flow.

## Prerequisites

- Node.js installed
- Repository cloned and dependencies installed (`npm install`)

## 1. Draft the skill metadata

Create a new file under `skills/` (for example `skills/rr-hello.yml`) and include metadata that matches `/schemas/skill.schema.json`:

```yaml
---
id: rr-hello
name: Hello World Skill
description: Flags TODO comments in Markdown
phase: upstream
applyTo:
  - '**/*.md'
tags:
  - content
  - hygiene
severity: minor
---
# instructions start here...
```

## 2. Keep the flow explicit

- **Upstream:** describe the intent of the check and link to any design references.
- **Midstream:** define the detection logic in the instruction body.
- **Downstream:** note how to verify or auto-fix the finding.

## 3. Validate the skill

Run the validators to make sure the schema and structure are correct:

```bash
npm run skills:validate
```

If your skill is phase-specific, add a short test PR to confirm the reviewer loads it only for matching files.

## 4. Iterate with reviews

Commit the skill, open a PR, and use the River Reviewer PR templates to link related issues and prove validation passed.
