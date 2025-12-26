---
id: what-is-river-reviewer-en
title: What is River Reviewer
---

River Reviewer is a flow-based agent that carries review perspectives along three phases: Upstream, Midstream, and Downstream.

## Purpose

- Detect drift and risks early in the design phase.
- Standardize review perspectives without stalling implementation reviews.
- Reduce regression and coverage gaps before test/release.

## Positioning

River Reviewer does not replace human reviewers. By handling skill-based checks to reduce oversights, it allows humans to focus on intent and team-specific judgments.

## Flow Connection

- **Upstream**: Check requirements, design, and ADRs to reduce downstream risks.
- **Midstream**: Review code and PRs, ensuring alignment between design intent and implementation diffs.
- **Downstream**: Check tests, QA, and release readiness to prevent regression and quality degradation.
