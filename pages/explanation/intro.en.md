---
id: intro-en
title: Welcome to River Review
---

River Review (RR) is an OSS framework that **turns your team's review judgment into versioned, repo-owned skills and runs them across SDLC gates**. It operates over artifacts such as plan, diff, test-cases, JUnit, and prior review outputs, acting as the **team-owned audit layer** for AI-assisted development.

The foundation stays the same: it turns your team's tacit knowledge into versioned, repo-owned **Skills (the Skill Registry)** that you reuse as a shared asset. River Review delivers that foundation along three core axes:

- **Capability pack**: a bundle of skills / agent definitions that strengthens an AI agent's review ability. It usually needs no LLM key; only the headless GitHub Action / `river run` path requires one.
- **Review skills (Skill Registry)**: the foundation that shares team judgment criteria as versioned, repo-owned Skills.
- **Review team**: a dedicated review agent (`agents/river-review.md`) plus a review team that runs perspective-based reviewers in parallel. In a generate → review → revise loop it acts as the verdict-bearing critic for the review stage.

## Core Model

- **Skills define judgment** — A skill describes how a review decision should be made (security, accessibility, migration safety, dependency policy, plan conformance, ...). Skills are written as YAML frontmatter + Markdown and validated against `schemas/skill.schema.json`.
- **Gates execute judgment** — `river review plan` / `exec` / `verify` run those skills at the right point in the delivery flow — not only after the PR is already complete.
- **Riverbed remembers judgment** — Review outcomes and decisions persist as operating memory, with suppression and prior-decision recall keeping future reviews consistent ([Riverbed Memory](./riverbed-memory.en.md)).

This documentation covers:

- **Explanation**: Design philosophy and the three-layer model in depth.
- **Tutorials**: Hands-on guides for creating skills.
- **How-to**: Practical guides for GitHub Actions integration, tracing, etc.
- **Reference**: Schema definitions and CLI references.

Start with [What is River Review](./what-is-river-review.en.md) for the concept overview, then explore tutorials or references as needed. For why River Review does **not** replace human review, see [Human Judgment Focus](./human-judgment-focus.en.md). The SSoT for the full vision lives at [`docs/vision.md`](https://github.com/s977043/river-review/blob/main/docs/vision.md) in the repository root.
