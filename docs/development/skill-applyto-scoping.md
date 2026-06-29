# Skill `applyTo` Scoping Rules

A skill's `applyTo` glob list is a **gating filter**: a skill is only considered for a PR when at least one changed file matches one of these globs (`runners/core/review-runner.mjs:matchesApplyTo`). An over-broad `applyTo` causes the skill to enter the candidate set on PRs where its review domain does not apply, increasing planner false-positive rate and prompt token spend.

This document codifies the scoping rules so reviewers can decide consistently whether an `applyTo` value is "over-broad" and how to narrow it without breaking routing.

## Definitions

### Over-broad

An `applyTo` value is **over-broad** when at least one of the following holds:

1. The pattern is unconstrained (`'**/*'`) and the skill is **not** a meta / process / sample skill. (Meta / process / sample skills intentionally apply universally—see "Allowed exceptions" below.)
2. The pattern is bounded only by file extension (e.g. `'**/*.ts'`, `'**/*.md'`) but the skill's review domain is stream-specific. Stream-specific means it should only fire on **upstream** (design / spec docs) **or** **midstream** (application source) **or** **downstream** (test code), not all three.
3. The pattern would match files explicitly outside the skill's domain when projected against a typical project layout. Examples:
   - midstream code-quality skill matching `tests/**` (pulls test files into a "production source" review)
   - upstream design-doc skill matching `CHANGELOG.md`, `README.md`, or auto-generated docs
   - downstream test skill matching `node_modules/**` or build artifacts

### Allowed exceptions

These three skill types are allowed to keep `'**/*'` even though it matches everything:

- **Sample / hello skills**—already excluded from planner-dataset eval by tag (`'sample'`, `'hello'`).
- **Process skills**—already excluded from planner-dataset eval by tag (`'process'`, `'policy'`, `'routing'`).
- **Meta-review / conformance guards** that are intentionally universal (e.g. `plangate-exec-conformance`, `review-automation-boundary`). These must declare a Pre-execution Gate in `SKILL.md` that filters to the relevant subset at runtime, since `applyTo` cannot.

Any skill keeping `'**/*'` must document the rationale in its `SKILL.md` body or a `Pre-execution Gate` section.

## Scoping rules per phase

When narrowing an over-broad pattern, prefer these conservative defaults. Each rule lists the directory roots that legitimately host the relevant artifact in this codebase (and is the same convention used by the existing planner-dataset diffs).

### upstream (design / spec / architecture)

| Domain                     | Recommended `applyTo` patterns                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Design / architecture docs | `docs/architecture/**/*.md`, `docs/**/*architecture*.md`, `docs/**/*design*.md`, `**/*.adr` |
| ADR                        | `docs/adr/**/*`                                                                             |
| API contracts              | `**/*openapi*.{yml,yaml,json}`, `**/openapi/**/*`, `specs/**/*.md`                          |
| Diagrams                   | `**/*c4*.{md,png,svg}`, `**/*diagram*.{md,png,svg}`, `**/*sequence*.md`                     |

Avoid bare `'**/*.md'` for upstream skills—it matches `CHANGELOG.md`, `README.md`, and auto-generated docs that the skill should not review.

### midstream (application source)

| Domain                  | Recommended `applyTo` patterns                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript / JavaScript | `src/**/*.{ts,tsx}`, `app/**/*.{ts,tsx}`, `lib/**/*.{ts,tsx}`, `packages/**/*.{ts,tsx}` (mirror with `.{js,jsx,mjs,cjs}` if relevant) |
| Frontend-only           | Add `**/*.tsx` / `**/*.jsx` only after the directory roots above                                                                      |
| Backend route / API     | `src/**/api/**`, `app/**/api/**`, `pages/api/**`                                                                                      |
| Config (in-tree)        | `*.config.{ts,js,mjs,cjs,json,yaml}`, `.river-review.{yaml,yml,json}`                                                                 |

Avoid bare `'**/*.ts'` for midstream skills—it pulls `tests/**/*.ts`, `*.test.ts`, `*.spec.ts`, `*.config.ts`, `node_modules/**` into the candidate set even though those have their own (test / config) review skills.

### downstream (test code)

| Domain              | Recommended `applyTo` patterns                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Test files          | `tests/**/*.{ts,tsx,js,jsx}`, `__tests__/**/*.{ts,tsx,js,jsx}`, `**/*.test.{ts,tsx,js,jsx}`, `**/*.spec.{ts,tsx,js,jsx}` |
| Coverage / fixtures | `tests/fixtures/**/*`, `coverage/**/*` (when applicable)                                                                 |
| Test plans          | `docs/qa/**/*.md`, `docs/test-plan/**/*.md`                                                                              |

Downstream skills that need to also see source code (to assess "do tests cover this change?") may include `src/**/*` etc., but should declare so explicitly in the skill body.

## Workflow for narrowing a skill

1. **Identify the over-broad pattern(s)** using the definitions above.
2. **Replace with the per-phase recommended set** from the tables.
3. **Run `npm run planner:eval:dataset` before and after** the change. Coverage and top1Match must remain unchanged (`coverage = 1.0`, `top1Match >= 0.9`). If they regress, the planner-dataset is exercising the old pattern; either widen the new pattern or add a planner-dataset case proving the narrow pattern still routes correctly.
4. **Bundle ≤ 10 skills per PR**. Group by stream to keep blast radius small.
5. **PR body must list each skill, the old pattern, the new pattern, and the planner-dataset metrics before / after.**

## Out of scope

- This document does not enumerate every existing skill's classification—that is per-PR work tracked under #762.
- Pre-execution Gate text in `SKILL.md` is a separate, complementary lever (it filters at the LLM-decision stage, not at planner-selection stage). This document is only about the `applyTo` glob list.

## References

- `runners/core/review-runner.mjs`—`matchesApplyTo`, `evaluateSkill`, `selectSkills`
- `tests/fixtures/planner-dataset/cases.json`—regression coverage for routing
- `tests/planner-dataset-eval.test.mjs`—coverage / top1Match thresholds
- Parent issue: [#762](https://github.com/s977043/river-review/issues/762)
