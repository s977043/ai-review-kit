# Creating Your First Skill

Build a simple River Review skill that follows the Upstream → Midstream → Downstream flow.

## Prerequisites

- Node.js installed
- Repository cloned and dependencies installed (`npm install`)

## 1. Draft the skill metadata

Create a directory named after the skill ID under `skills/` and place a `SKILL.md` inside it (for example `skills/midstream/rr-midstream-hello-skill-001/SKILL.md`), with metadata that matches `/schemas/skill.schema.json`:

```yaml
---
id: rr-midstream-hello-skill-001
name: Hello World Skill
description: Flags TODO comments in Markdown
category: midstream
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
- **Downstream:** note how to verify or autofix the finding.

## 3. Validate the skill

Run the validators to make sure the schema and structure are correct:

```bash
npm run skills:validate
```

If your skill is phase-specific, add a short test PR to confirm the reviewer loads it only for matching files.

## 4. Iterate with reviews

Commit the skill, open a PR, and use the River Review PR templates to link related issues and prove validation passed.
