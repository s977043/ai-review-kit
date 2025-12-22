# Claude Code Project Guide

> **Note**: Read [AGENTS.md](./AGENTS.md) first for core project rules.
> This file contains Claude Code specific configuration only.

## Claude-specific settings

- Permission settings: See `.claude/settings.json`
- Custom commands: `/skill`, `/review-local` (in `.claude/commands/`)
- Sub-agent: `river-reviewer` (in `.claude/agents/`)

## Quick reference (from AGENTS.md)

- Skills: Search `skills/` with both English and Japanese keywords
- Safety: No secrets access, no destructive commands without confirmation
- Workflow: Small changes → lint/test → PR
