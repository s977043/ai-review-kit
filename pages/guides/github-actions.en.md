# Setting up River Review with GitHub Actions

Here is a minimal workflow example to run River Review on GitHub Actions. Place it as `.github/workflows/river-review.yml`.

> **⚠️ IMPORTANT**: For PRs from forked repositories, GitHub does not expose repository secrets for security reasons. If you want to run reviews on external contributor PRs, consider event selection like `pull_request_target` and permission settings.

```yaml
name: River Review
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
jobs:
  river-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Run River Review (midstream)
        uses: s977043/river-review/runners/github-action@v1.22.0
        with:
          phase: midstream # upstream|midstream|downstream
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Choosing a phase

| phase        | Timing                                     | Typical trigger                                        | Use case                                                                 |
| ------------ | ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `upstream`   | Pre-merge gate (draft / review-request)    | `pull_request: types: [ready_for_review]`              | Run quality checks at the draft stage before review is requested         |
| `midstream`  | Review on PR open / sync (**recommended**) | `pull_request: types: [opened, synchronize, reopened]` | General case — runs a review every time the PR is updated                |
| `downstream` | Post-merge analysis                        | `push` / `workflow_run`                                | Aggregate code quality metrics or run retrospective analysis after merge |

Most teams should use **`midstream`**. It runs a review when the PR is opened and again whenever the diff is updated.

`issues: write` is required to post comments on PRs. Review workflow `permissions` if you encounter permission errors.

> The example pins to `@v1.22.0`. Replace it with a newer tag once one is released. Pinning to a release tag is recommended for stability.

## Using Anthropic (Claude)

Specify a `claude-*` model in `.river-review.json` (placed in the repository root) and pass `ANTHROPIC_API_KEY`. For all available fields, see the [Config Schema Reference](../reference/config-schema.md).

```yaml
- name: Run River Review (midstream, Claude)
  uses: s977043/river-review/runners/github-action@v1.22.0
  with:
    phase: midstream
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

```json
{
  "model": {
    "provider": "anthropic",
    "modelName": "claude-sonnet-4-6",
    "temperature": 0
  }
}
```

`RIVER_ANTHROPIC_API_KEY` is also accepted as a fallback environment variable when you want to separate keys from other tools.
