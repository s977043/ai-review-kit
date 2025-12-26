# Troubleshooting

Common symptoms and checkpoints for isolation.

Related: `pages/guides/faq.en.md` (List of common failures)

## CLI (`river run`)

### First Step (Pre-diagnosis)

If isolation is difficult, run `river doctor .` first to check for "missing config" or "diff failure".

### OpenAI API key not found

- Symptom (Example):
  - `LLM: OPENAI_API_KEY (or RIVER_OPENAI_API_KEY) not set`
  - `River Reviewer doctor` shows `OpenAI (review): not set`
- Action:
  - Set `OPENAI_API_KEY` or `RIVER_OPENAI_API_KEY` in environment variables.
  - Use `--dry-run` to avoid external requests.

### Not recognized as Git repository

- Symptom: `Not a git repository: ...`
- Action:
  - Run in a directory under Git control.
  - `git init` / `git clone ...` if needed.

### Skill definition load/validate failed

- Symptom: `Skill configuration error: ...`
- Action:
  - Run `npm run skills:validate` to check error details.
  - Refer to `pages/reference/skill-schema-reference.en.md` for schema details.

### Cannot read rules (`.river/rules.md`)

- Symptom: Rules file read error.
- Action:
  - Check existence and read permissions of `.river/rules.md` (delete if unneeded).

### Don't know what was skipped

- Action:
  - Run `river run . --debug` and check output for selected skills and skip reasons.

### File not detected in local run

- Action:
  - Check diff with `git status` or `git diff`.
  - Check target file/hunk preview with `river run . --debug`.

### Rate Limit Error

- Action:
  - Check if OpenAI rate limit is reached.
  - Wait a while and retry.
  - Use `--dry-run` to check prompt/skill selection only if needed.

## GitHub Actions

### Review not running / Permission error

- `permissions` might be insufficient (e.g., `pull-requests: write`).
- Check if Secrets like `OPENAI_API_KEY` are correctly set.

### Diff not detected

- Recommend `fetch-depth: 0` in `actions/checkout` (to stably retrieve merge-base).
