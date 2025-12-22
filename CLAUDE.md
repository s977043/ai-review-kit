# Claude Code Project Guide

## What this repo is

- You are working in the `river-reviewer` repository.
- Prefer incremental, testable changes.

## Must-use skills (local docs)

- This repository includes a skills library under `skills/`.
- When a task matches a skill, read the relevant `skills/**/skill.md` and follow it.
- If unsure, search `skills/` for keywords and choose the best match.

## Engineering rules

- Follow existing code style and conventions in the repo.
- Avoid large refactors unless explicitly requested.
- After changes, run the project’s standard checks (see README / package.json scripts / CI workflows).

## Safety rules

- Don’t access secrets: `.env`, `.env.*`, `secrets/**`, credential files.
- Avoid destructive shell commands; ask before anything risky.
- Don’t introduce new dependencies without explaining why.
