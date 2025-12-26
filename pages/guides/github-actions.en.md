# Setting up River Reviewer with GitHub Actions

Here is a minimal workflow example to run River Reviewer on GitHub Actions. Place it as `.github/workflows/river-reviewer.yml`.

> **⚠️ IMPORTANT**: For PRs from forked repositories, GitHub does not expose repository secrets for security reasons. If you want to run reviews on external contributor PRs, consider event selection like `pull_request_target` and permission settings.

```yaml
name: River Reviewer
on:
  pull_request:
  push:
    branches: [main]
jobs:
  river-reviewer:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Run River Reviewer (midstream)
        uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.1.1
        with:
          phase: midstream # upstream|midstream|downstream
          dry_run: true # Post PR comments without calling external APIs (fallback)
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

`issues: write` is required to post comments on PRs. Review workflow `permissions` if you encounter permission errors.

> Replace `@v0.1.1` with the latest tag. Pinning to a release tag is recommended for stability.
