---
id: rr-midstream-code-quality-sample-001
name: 'Sample Code Quality Pass'
description: 'Checks common code quality and maintainability risks.'
phase: midstream
applyTo:
  - 'src/**/*.ts'
  - 'src/**/*.js'
  - 'src/**/*.py'
inputContext:
  - diff
outputKind:
  - findings
  - actions
modelHint: balanced
dependencies:
  - code_search
tags:
  - style
  - maintainability
  - midstream
severity: 'minor'
---

# Instruction

- Scan changed code for readability regressions (naming, dead code, commented-out blocks).
- Flag missing error handling around I/O, network, and boundary calls.
- Highlight duplicated logic that should be extracted into helpers.
- Point out missing tests when risky logic is introduced.
- Keep suggestions lightweight and actionable for the PR author.
