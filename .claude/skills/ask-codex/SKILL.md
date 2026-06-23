---
name: ask-codex
description: Get a second opinion or independent review from Codex (OpenAI) via the local Codex CLI. Use when the user wants Codex to review a design memo, PR, diff, or decision, or to cross-check an approach from another model. Also trigger on "Codexに聞いて", "Codexと相談", "Codexにレビュー", "Codexの意見", "別のモデルで確認".
allowed-tools: Bash, Read
---

## Purpose

Delegate a focused question or review to **Codex** (OpenAI's CLI) and relay
its answer back to the user as an independent, attributed second opinion.

This skill does not replace your own judgment — it gathers Codex's view so the
user can compare it against yours (and against other reviewers such as
Antigravity).

## How Codex is invoked

The repository ships a project-local Codex config (`.codex/config.toml`) and a
wrapper script. Always call Codex through the script so the project config and
working directory are correct:

```bash
npm run codex:exec -- "<prompt>"
```

This runs `codex exec` non-interactively (`CODEX_HOME=.codex`, `-C <repo root>`)
and prints Codex's answer to stdout. Codex runs in the repo, so it can read
files itself — reference paths in the prompt instead of pasting large files.

## Steps

1. **Frame the prompt.** Turn the user's request into a single self-contained
   prompt for Codex. Include:
   - the role ("You are a senior reviewer of River Review …"),
   - the file paths Codex should read (e.g. `docs/development/1255-…md`,
     `runners/core/review-runner.mjs`),
   - the specific questions to answer, numbered,
   - a request to be concise and to state a clear conclusion.
2. **Run Codex** with a generous timeout (design reviews can take minutes):

   ```bash
   timeout 600 npm run codex:exec -- "<prompt>"
   ```

3. **Handle authentication failure.** If the output contains
   `401 Unauthorized` / `Missing bearer` / `Reconnecting...`, Codex is not
   authenticated. Do **not** retry blindly. Tell the user to authenticate
   themselves in this session (these are interactive / secret-bearing and you
   cannot run them for them):
   - `! codex login`, or
   - set `OPENAI_API_KEY` in the environment (warn that pasting a key into chat
     leaves it in history; prefer env/keychain).
     Then offer to re-run once authenticated.
4. **Relay faithfully.** Quote or summarize Codex's answer and **attribute it to
   Codex** ("Codex の見解:"). Keep Codex's conclusion distinct from your own. If
   you disagree, say so separately — do not silently overwrite its opinion.
5. **Persist when useful.** For design decisions, offer to record Codex's
   verdict in the relevant memo / issue / PR so it is not lost.

## Guardrails

- Never paste secrets or `.env` contents into the Codex prompt.
- Codex executes in `workspace-write` sandbox; treat its file edits as
  proposals to review, not as automatically trusted changes.
- This skill is for **advisory** review. Decisions and commits stay with the
  user and with you.
