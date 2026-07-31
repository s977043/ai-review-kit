---
id: index-en
title: River Review docs (English)
---

[日本語版はこちら](/)—Japanese is the default and source of truth.

River Review documentation follows the [Diátaxis documentation framework](https://diataxis.fr/). English editions use the same filename with a `.en.md` suffix and may lag behind the Japanese originals.

We group docs into four types:

- Tutorials—step-by-step lessons for new users
- Guides—recipes for specific tasks
- Reference—technical specifications, APIs, and schemas
- Explanation—background, design decisions, and concepts

Docs live under `pages/` and are served at `/docs`. Diátaxis is expressed via directories; language is expressed via filenames:

- `tutorials/getting-started.md` (ja) / `tutorials/getting-started.en.md` (en)
- `guides/quickstart.md` / `guides/quickstart.en.md`
- `reference/skill-schema-reference.md` / `reference/skill-schema-reference.en.md`
- `explanation/riverbed-memory.md` / `explanation/riverbed-memory.en.md`

## Understand the concept

- [Concept: turning review into an organizational judgment asset](./explanation/concept.en.md) — the problems, the core model, the review targets, the responsibility boundary, and the non-goals.
- [Welcome to River Review](./explanation/intro.en.md) — a short introduction for first-time readers.
- [What is River Review](./explanation/what-is-river-review.en.md) — a product overview covering features, usage, and the execution model.

## Get started

- [Getting started with River Review](/tutorials/getting-started.en)
- [Quickstart](/guides/quickstart.en)

## Advanced usage

- [W-check (double review)](/guides/w-check.en) — feed review results from other AI or human reviewers back in for re-verification, and check whether each finding is real.
- [Repo-wide review](/guides/repo-wide-review.en) — how to adopt and tune a review that reads repository context around the changed files, not just the PR diff.
- [Cost estimation and optimization](/guides/cost-estimation.en) — estimating monthly cost with `--estimate` and `--max-cost`, then validating the estimate against measured usage.
- [Agent workflow (`--reviewers auto`)](/guides/agent-workflow.en) — choosing between the entry points that call River Review from an AI agent (CLI, sub-agent, `/review-local`).
- [Independent review synthesis](/guides/use-independent-review-synthesis.en) — the synthesis pattern that merges several AI and human review results to support a merge decision.
