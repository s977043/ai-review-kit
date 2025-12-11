---
id: rr-downstream-test-review-sample-001
name: 'Sample Test Coverage Review'
description: 'Evaluates downstream tests for coverage and edge cases.'
phase: downstream
applyTo:
  - 'tests/**/*.ts'
  - 'tests/**/*.js'
  - 'tests/**/*.py'
tags:
  - tests
  - coverage
  - downstream
severity: 'major'
inputContext:
  - diff
  - tests
outputKind:
  - tests
  - findings
  - summary
  - actions
modelHint: balanced
dependencies:
  - test_runner
  - coverage_report
---

# Instruction

- Check that new behaviors have positive and negative test cases, including edge inputs.
- Look for flaky-test risks (time sensitivity, randomness, external dependencies).
- Call out missing assertions around failure paths and error messaging.
- Suggest small, focused test additions instead of broad rewrites.
