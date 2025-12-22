# Copilot instructions (river-reviewer)

## Golden rule: use the project “skills”

- This repository keeps reusable how-to knowledge under `skills/`.
- When you receive a task, first search `skills/` for the most relevant skill doc(s), then follow them.
- If multiple skills apply, pick the smallest set that covers the task and avoid conflicting guidance.
- If you can’t find a matching skill, create one under `skills/` (using the existing template in this repo) and then proceed.

## What to prefer

- Prefer small, reviewable changes over big-bang rewrites.
- Prefer existing patterns used in this repo. If you introduce a new pattern, explain why and document it.
- Keep docs and code consistent. If behavior changes, update docs in the same PR.

## Reviews / quality

- Use `coding-review-checklist.md` as the baseline review rubric when reviewing or proposing changes.
- Flag: security, privacy, dependency risk, and surprising behavior.
- Add/adjust tests for changes that affect behavior.

## Repo navigation / commands

- Before running commands, check existing scripts/config in the repo and prefer those.
- If you need to run commands, prefer: search (rg/fd), lint, format, test, build.
- Never run destructive commands (delete/clean/reset) without explicit human confirmation.

## Docs language convention

- Follow the repository’s existing convention for multilingual docs: keep the default language file and pair translations as separate files (e.g., `.en.md`) when the repo does that.
