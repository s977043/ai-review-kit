# Getting Started with River Reviewer

River Reviewer is a flow-based AI review agent for your software development lifecycle. It travels from Upstream design to Midstream implementation and Downstream QA.

This tutorial helps you run your first review using the GitHub Action.

## 1. Install / Enable

Add the following workflow (replace `{org}` with your organization or user):

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
      - uses: actions/checkout@v4
      - uses: {org}/river-reviewer@v1
```

> Note: `{org}/river-reviewer@v1` is a placeholder. Point this to the published River Reviewer action in your org or the official repository.

## 2. Run the review

Create a PR. River Review will automatically:

- detect changed files
- load relevant skills
- validate schema
- output structured review comments

You're ready to flow.
