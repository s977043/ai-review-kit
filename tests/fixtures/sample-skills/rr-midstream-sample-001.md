---
id: rr-midstream-sample-001
name: Sample midstream skill
phase: midstream
applyTo:
  - '**/*.ts'
description: Check simple TypeScript functions.
severity: minor
inputContext:
  - diff
outputKind:
  - findings
modelHint: balanced
---

- Ensure functions handle edge cases.
- Avoid returning default values on unexpected input without logging.
