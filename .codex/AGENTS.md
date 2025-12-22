# Project Codex Instructions (CODEX_HOME scoped)

> **Note**: Read [AGENTS.md](../AGENTS.md) first for core project rules.
> This file contains Codex-specific configuration only.

## Usage

Run Codex with project-local config:

```bash
CODEX_HOME=$(pwd)/.codex codex "your prompt"
```

## Codex-specific settings

- Config: See `.codex/config.toml` for approval policy and sandbox mode
- Environment: Limited env vars forwarded (PATH, HOME, USER, SHELL, LANG, LC_ALL)

## Quick reference (from AGENTS.md)

- Skills: Search `skills/` with both English and Japanese keywords
- Safety: No secrets access, no destructive commands without confirmation
- Workflow: Small changes → lint/test → PR
