# Integrating with GitHub Actions

Wire River Reviewer into your repository so every PR gets phase-aware feedback.

## 1. Add the workflow

Create `.github/workflows/river-review.yml` (replace `{org}` with your organization or user):

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
      - uses: {org}/river-reviewer@v1
```

> Note: `{org}/river-reviewer@v1` is a placeholder. Point this to the published River Reviewer action in your org or the official repository.

## 2. Keep credentials out of the flow

- By default, River Reviewer doesn't require credentials or API keys.
- If the reviewer needs extra context or external API access, pass tokens via repository or organization secrets and document which secrets are needed.

## 3. Tune for phases

- Tag skills with `phase: upstream|midstream|downstream`.
- Use path filters in your workflow to restrict when the reviewer runs, if needed.

## 4. Validate on every push

Ensure the workflow runs `npm run skills:validate` so schema changes are caught early. For larger repos, consider a pre-commit hook or a dedicated CI job for validation.
