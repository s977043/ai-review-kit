---
id: output-format-yaml-en
title: YAML Output Format (Scoring + Verdict)
description: River Review YAML output format with scoring and verdict model.
---

River Review emits a structured YAML block plus a human-readable summary when you pass `--output yaml` (CLI) or `output_format: yaml` (GitHub Action). This format targets external CI integrations and BI dashboards.

## CLI

```bash
npx river run . --output yaml
```

## GitHub Action

```yaml
- uses: s977043/river-review/runners/github-action@v1.22.0
  with:
    output_format: yaml
```

## Sample output

```yaml
review:
  phase: midstream
  timestamp: '2026-04-18T00:00:00Z'
  verdict: human-review-recommended
  scores:
    overall: 86
    readability: 100
    extensibility: 100
    performance: 80
    security: 100
    maintainability: 90
  derived: true # scores are heuristic, not AI-generated
  high_risk_reasons:
    - security
  summary: '2 findings: 1 major / 1 minor. Overall score 86/100 (human-review-recommended).'
  findings:
    - severity: major
      category: performance
      file: 'src/Repository/OrderRepository.php'
      line: 128
      title: 'N+1 query in loop'
      detail: 'Eager load relations'
      suggestion: 'Use with()'
```

A Japanese human-readable summary (result / verdict / breakdown / finding counts) follows the YAML block.

## Scoring model

### 5 axes

| axis            | Japanese       | Area                                                       |
| --------------- | -------------- | ---------------------------------------------------------- |
| readability     | 可読性         | Naming, structure, clarity                                 |
| extensibility   | 拡張性         | Architecture, dependency direction, separation of concerns |
| performance     | パフォーマンス | N+1, loop I/O, query efficiency                            |
| security        | セキュリティ   | Input validation, auth, sensitive data handling            |
| maintainability | 保守性         | Test quality, pattern conformance                          |

### Axis classification

The `ruleId` prefix of each finding determines the axis. Patterns live in `src/lib/scoring/rubric.mjs` as `AXIS_PATTERNS`.

| Pattern                                       | axis                       |
| --------------------------------------------- | -------------------------- |
| `rr-*-sec-*`, `*-security-*`, `*-auth-*`      | security                   |
| `rr-*-perf-*`, `*-n-plus-one-*`, `*-query-*`  | performance                |
| `rr-*-arch-*`, `*-depend-*`, `*-layer-*`      | extensibility              |
| `rr-*-read-*`, `*-naming-*`, `*-complexity-*` | readability                |
| `rr-*-test-*`, `*-coverage-*`                 | maintainability            |
| (otherwise)                                   | maintainability (fallback) |

### Deduction table

Each axis starts at 100 and is deducted per finding by severity.

| severity | security | other axes |
| -------- | -------- | ---------- |
| critical | -50      | -30        |
| major    | -30      | -20        |
| minor    | -15      | -10        |
| info     | -5       | -3         |

`overall` is the arithmetic mean of the 5 axis scores.

## Verdict

| verdict                    | Condition                                               | Meaning                                                                                         |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `auto-approve`             | overall ≥90 AND security ≥95 AND critical=0 AND major=0 | Recommended for auto-approval. **HITL policy still applies**; humans make the final merge call. |
| `human-review-recommended` | Not the above AND critical=0 AND overall ≥70            | Human review recommended.                                                                       |
| `human-review-required`    | critical ≥1 OR overall &lt;70                           | Human review required.                                                                          |

## Important caveats

- **`derived: true` flag**: The score is a deterministic, heuristic indicator—not an LLM-generated qualitative judgment. Do not use it as the sole merge criterion.
- **`auto-approve` does not override HITL**: River Review's policy assumes human review. The `auto-approve` verdict is an informational signal for automation tools, not a delegation of merge authority.
- **Rubric customization**: Currently hardcoded in `src/lib/scoring/rubric.mjs`. Per-project tuning via `config/scoring-rubric.json` is a future work item.

## References

- `src/lib/scoring/engine.mjs` — scoring implementation
- `src/lib/scoring/rubric.mjs` — axis patterns and deduction table
- `src/lib/output-formatters/yaml.mjs` — YAML emitter
- `schemas/review-artifact.schema.json` — internal schema (v1, compatible with this output)
