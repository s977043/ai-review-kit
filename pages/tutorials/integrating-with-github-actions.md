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
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: {org}/{repo}/.github/actions/river-reviewer@main
        with:
          phase: midstream
          dry_run: true
          debug: false
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

> Use `@main` until a release tag is available, then switch to `@v1` to pin to a stable release.

## 2. Keep credentials out of the flow

- By default, River Reviewer doesn't require credentials or API keys.
- If the reviewer needs extra context or external API access, pass tokens via repository or organization secrets and document which secrets are needed.

## 3. Tune for phases

- Tag skills with `phase: upstream|midstream|downstream`.
- Use path filters in your workflow to restrict when the reviewer runs, if needed.

## 4. Validate on every push

Ensure the workflow runs `npm run skills:validate` so schema changes are caught early. For larger repos, consider a pre-commit hook or a dedicated CI job for validation.
