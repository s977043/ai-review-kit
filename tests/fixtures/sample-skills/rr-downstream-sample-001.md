---
id: rr-downstream-sample-001
name: Sample downstream skill
phase: downstream
applyTo:
  - '**/*.test.ts'
description: Validate test naming conventions.
severity: minor
inputContext:
  - diff
outputKind:
  - findings
modelHint: cheap
---

- Tests should describe behavior clearly.
- Prefer `it` blocks with plain language descriptions.
