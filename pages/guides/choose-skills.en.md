# Choosing and Combining Skills

The skills catalog offers many options. This guide explains how to decide which skills to enable and how to combine them effectively.

> **See also**: For the full skill list see [Skills Catalog](../reference/skills-catalog.md). If a skill isn't triggering, see [Debug Skill Routing](./debug-skill-routing.md).

## 1. Filter by phase first

Every skill belongs to `upstream`, `midstream`, or `downstream`. Identifying the phase of your change narrows candidates significantly.

- Design docs / ADR changes → choose `upstream` skills
- Application code changes → choose `midstream` skills
- Test / QA config changes → choose `downstream` skills

## 2. Detect overlap using tags

Skills with the same tags may cover overlapping concerns. Check tags before combining.

| Tag combination             | Overlap risk                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript / type-safety`  | `typescript-nullcheck` and `typescript-strict` share identical `applyTo` globs — enabling both produces duplicate findings on the same files                                                      |
| `community / modern-web`    | The four skills `modern-web-semantic`, `modern-web-performance`, `modern-web-browser-compat`, and `modern-web-a11y-interactive` share the same globs — start with one or two that match your goal |
| `community / design-system` | `design-token-enforcement` (hardcoded values) and `design-system-component-reuse` (reimplemented components) cover different axes — enabling both has low overlap                                 |

## 3. Prioritize by severity

When multiple skills match the same file, prefer enabling higher-severity skills first.

- `critical` / `major` — can block merges; enable these first
- `minor` — improvement suggestions; add based on team capacity
- `info` — policy confirmation only; safe to enable at all times

## 4. Recommended starter sets by stack

### TypeScript frontend (Next.js / React)

- `typescript-strict` — type-safety baseline
- `security-basic` — XSS and secret leaks
- `nextjs-app-router-boundary` (if using Next.js App Router)
- `modern-web-a11y-interactive` — interactive UI accessibility
- `design-token-enforcement` (if a design system is in use)

### Python API

- `security-basic`
- `logging-observability`
- `coverage-gap`

### Design / documentation focus

- `adr-decision-quality`
- `architecture-boundaries`
- `security-privacy-design`

### Multi-agent / AI review integration

- Run `independent-review-synthesis` last to consolidate multiple review results.

## 5. Choosing between TypeScript nullcheck and strict

`typescript-nullcheck` and `typescript-strict` target the same globs.

- `strict-001` covers `any` types, unsafe assertions, and null handling broadly.
- `nullcheck-001` specializes in null/undefined safety with deeper checks.

For projects without `strictNullChecks` enabled, start with `nullcheck-001`. Once strict mode is in place, migrate to `strict-001` or enable both.
