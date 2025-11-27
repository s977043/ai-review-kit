# Integrating with GitHub Actions

Wire River Reviewer into your repository so every PR gets phase-aware feedback.

## 1. Add the workflow

Create `.github/workflows/river-review.yml`:

```yaml
name: River Reviewer
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: s977043/river-reviewer@v0
```

## 2. Keep credentials out of the flow

- Do not commit secrets or `.env` files.
- If the reviewer needs extra context, pass it through repository or organization secrets.

## 3. Tune for phases

- Tag skills with `phase: upstream|midstream|downstream`.
- Use path filters in your workflow to restrict when the reviewer runs, if needed.

## 4. Validate on every push

Ensure the workflow runs `npm run agents:validate` so schema changes are caught early. For larger repos, consider a pre-commit hook or a dedicated CI job for validation.
