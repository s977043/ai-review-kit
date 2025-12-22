# Project Codex Instructions (CODEX_HOME scoped)

## Goals

- Help implement and review this repository safely and consistently.
- Prefer small, verifiable changes over large rewrites.

## Must-use project skills

- This repo keeps a skills library under `skills/`.
- When a task matches a skill (docs/PDFs/spreadsheets/slides), read the relevant `skills/**/skill.md` first and follow it.
- If you are unsure which skill applies, search `skills/` by keyword and pick the closest one.

## Safety and hygiene

- Never read or print secrets. Treat `.env`, `secrets/`, and credential files as off-limits.
- Avoid destructive commands by default (`rm`, `reset --hard`, mass deletes). Ask first if truly needed.

## Workflow expectations

- Before coding: scan existing code and config; prefer existing patterns.
- After edits: run the project’s standard checks (see `README.md`, `package.json` scripts, CI workflows) to verify changes.
- Summarize what changed and why. Include commands you ran and their results.
