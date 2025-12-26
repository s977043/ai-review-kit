---
id: checklist-en
title: Part II—Comprehensive Checklist
---

The core of the AI reviewer is a reproducible **multi-dimensional checklist**.

## Functional Correctness & Logic

- Logic contradictions, boundaries/exceptions, error handling, race conditions

- **Alignment with Intent** (Consistency with PR description/ticket)

- Not passive but **Adversarial Test Generation** (Mutation / Symbolic execution)

## Maintainability, Readability, Complexity

- Cyclomatic/Cognitive complexity, Code smells, Naming, Comment quality

- Handle style guides by machine to avoid subjective debates

### Architecture Fit

- Principles like SOLID, Layering, Dependency direction, Separation of concerns

> Implementation Note: Connect with `guides/authoring-checks.md` in this repository, and declare check items in **machine-readable (e.g., YAML)** form -> Evaluate/Aggregate in CI.
