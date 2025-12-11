---
id: rr-upstream-architecture-sample-001
name: 'Sample Architecture Consistency Review'
description: 'Checks design/ADR docs for consistency and missing decisions.'
phase: upstream
applyTo:
  - 'docs/architecture/**/*.md'
  - 'docs/adr/**/*.md'
tags:
  - design
  - architecture
  - upstream
severity: 'minor'
inputContext:
  - diff
outputKind:
  - findings
  - summary
  - questions
  - actions
modelHint: balanced
dependencies:
  - adr_lookup
---

# Instruction

- Read the latest ADRs and architecture diagrams for divergence.
- Call out missing decisions, unstated assumptions, or conflicting constraints.
- Verify boundary definitions (APIs, data contracts, failure modes) remain aligned with team standards.
- Prefer concrete references to filenames/sections when highlighting gaps.
- If a finding is uncertain, mark it as a question rather than a defect.
