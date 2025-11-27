# Getting Started with River Reviewer

River Reviewer is a flow-based AI review agent that travels with your software development lifecycle, from Upstream design to Midstream implementation and Downstream QA.

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
    steps:
      - uses: actions/checkout@v4
      - uses: s977043/river-reviewer@v0
```

## 2. Run the review

Create a PR. River Review will automatically:

* detect changed files
* load relevant skills
* validate schema
* output structured review comments

You're ready to flow.
