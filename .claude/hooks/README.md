# Claude Hooks

## gh-account-guard.sh

PreToolUse hook (matcher: `Bash`) that verifies the active `gh` CLI account
before gh **write** operations.

### Purpose

The local gh keyring holds two accounts (`s977043` for this repo,
`kominem-unilabo` for work) and the active account silently switches
mid-session, causing 404 / permission errors on `gh pr create` / `gh pr merge`
/ `gh api` write calls. This hook makes the prose guard in CLAUDE.md ("Verify
gh active account before write ops") deterministic.

### How it works

1. Reads the PreToolUse stdin JSON and extracts `.tool_input.command`.
2. Non-gh commands and gh read ops exit 0 immediately (no gh call, minimal
   overhead).
3. gh write ops (`gh pr create|merge|edit|close|comment|ready|reopen|review|update-branch`,
   `gh issue <write subcommands>`, `gh api` with `-X`/`--method`
   POST/PATCH/PUT/DELETE or body fields (`-f`/`-F`/`--field`/`--raw-field`/`--input`,
   which default `gh api` to POST), `gh release <write subcommands>`,
   `gh workflow run|enable|disable`, `gh run rerun|cancel|delete`,
   `gh repo <write subcommands>`, `gh label <write subcommands>`,
   `gh secret|variable set|delete`) trigger an account check via
   `gh api user --jq .login`.
4. If the active account is not the expected one, runs
   `gh auth switch -u <expected>` and notifies via stderr, then allows the
   command to proceed (exit 0). If the switch itself fails, exits 2 to block
   the tool call — stderr is fed back to Claude.

Expected account defaults to `s977043`; override with
`GH_ACCOUNT_GUARD_EXPECTED` (used by tests to stay hermetic).

### Setup

```bash
chmod +x .claude/hooks/gh-account-guard.sh
```

### Tests

`tests/gh-account-guard-hook.test.mjs` runs the script with a stubbed `gh` on
PATH (never touches the real keyring): `node --test tests/gh-account-guard-hook.test.mjs`

### Hook input contract

PreToolUse passes its input as a stdin JSON payload; the Bash command is
`.tool_input.command`. Exit 0 allows the tool call, exit 2 blocks it and
feeds stderr back to Claude. The hook is defense-in-depth: the session-start
account sanity check in CLAUDE.md remains in place.

## format.sh

Post-edit hook that runs after Claude writes or edits files.

### Purpose

- Auto-format changed files to reduce diff noise
- Keep formatting consistent without manual intervention

### Setup

```bash
chmod +x .claude/hooks/format.sh
```

### How it works

1. If the PostToolUse stdin JSON provides `.tool_input.file_path` (the single
   file just edited) and `jq` is available, formats only that file.
2. Otherwise falls back to detecting changed files via `git diff`.
3. Filters for supported extensions (js, jsx, ts, tsx, json, md, yml, yaml, mjs)
4. Runs `prettier --write` on the selected file(s)

### Hook input contract

> **PostToolUse passes its input as a stdin JSON payload, not as environment
> variables.** The edited file path is `.tool_input.file_path` in that JSON.
> If you fork or reimplement this hook, read it from stdin (e.g.
> `jq -r '.tool_input.file_path'`) — assuming an env var such as
> `CLAUDE_TOOL_INPUT_FILE_PATH` silently turns the hook into a no-op.

The stdin path is read only when stdin is not a TTY, so running the script
manually in a terminal still works (it skips straight to the `git diff` path).

### Customization

Edit the grep pattern to include/exclude file types as needed.
