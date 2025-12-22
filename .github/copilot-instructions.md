# Copilot instructions (river-reviewer)

> **Note**: Read [AGENTS.md](../AGENTS.md) first for core project rules.
> This file contains GitHub Copilot specific configuration only.

## Golden rule

Always search `skills/` before starting a task. Use both English and Japanese keywords.

## Copilot-specific settings

- Instruction files: `.github/instructions/*.instructions.md`
- Custom agent: `@river-reviewer` (in `.github/agents/`)
- Prompts: `/skill`, `/review` (in `.github/prompts/`)

## Quick reference (from AGENTS.md)

- Skills: Search `skills/` with both English and Japanese keywords
- Safety: No secrets access, no destructive commands without confirmation
- Workflow: Small changes → lint/test → PR
- Reviews: Use `coding-review-checklist.md` as baseline rubric
- Docs: Japanese is source of truth; English translations use `.en.md` suffix
