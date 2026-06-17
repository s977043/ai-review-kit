# Getting Started with River Review

River Review is a flow-based AI review agent for your software development lifecycle. It travels from Upstream design to Midstream implementation and Downstream QA.

This tutorial helps you run your first review using the GitHub Action.

## 1. Install / Enable

Add the following workflow:

```yaml
name: River Review
on:
  pull_request:

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
      - uses: s977043/river-review/runners/github-action@v1.22.0
        with:
          phase: midstream
          dry_run: true # set false to call external APIs
          debug: true # show merge base, token estimates, prompt preview
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

> Pin to a release tag such as `@v1.22.0` for stability.
>
> The LLM key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`) is needed only for the **AI review on this headless path**. Without one, the mechanical (no-key) checks still run — and in normal agent-driven use (Claude Code etc. applying the skills directly), no key is needed at all (see [the execution model](../explanation/what-is-river-review.en.md)).

## 2. Run the review

Create a PR. River Review will automatically:

- detect changed files
- load relevant skills
- validate schema
- output structured review comments

You're ready to flow.
