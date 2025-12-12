# River Reviewer

![River Reviewer logo](assets/logo/river-reviewer-logo.svg)

English edition. The primary Japanese README lives in `README.md`.  
[日本語の README はここ](./README.md)—the Japanese copy is the source of truth; English may lag.

Review that Flows With You. 流れに寄り添う AI レビューエージェント。

River Reviewer is a flow-based, metadata-driven AI review agent. It travels the SDLC so design intent, implementation choices, and test coverage stay connected.

## Flow story

- **Upstream (design)**: ADR-aware checks keep architecture decisions aligned before code drifts.
- **Midstream (implementation)**: style and maintainability guardrails guide everyday coding.
- **Downstream (tests/QA)**: test-focused skills highlight coverage gaps and failure paths.
- **Phase-aware routing**: skills are selected by `phase` and file metadata, so feedback matches where you are in the stream.

## Quick start (GitHub Actions)

Minimal workflow using the v1 action tag. `phase` is a future/optional input that will route skills per SDLC phase.

```yaml
name: River Reviewer
on:
  pull_request:
    branches: [main]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Run River Reviewer (midstream)
        uses: s977043/river-reviewer/.github/actions/river-reviewer@main
        with:
          phase: midstream # upstream|midstream|downstream|all (future-ready)
```

Use `@main` until a release tag is published; then pin to `@v1` (or later) for stability.

## Quick start (local)

1. Environment: Node 20+ recommended (CI also runs on Node 20 series)
2. Install dependencies: `npm install`
3. Validate skills: `npm run skills:validate`
4. Tests: `npm test`
5. Planner evaluation (optional): `npm run planner:eval`
6. Docs development (optional): `npm run dev`

### Local review run (river run .)

- After installation, run `npx river run . --dry-run` to print skill selection and placeholder review comments for the current diff without sending anything externally (local mode is currently planning/preview only)
- Add `--debug` to show merge base, changed files, token estimate, and a diff preview
- Specify phase via `--phase upstream|midstream|downstream`; defaults to `RIVER_PHASE` env or `midstream`
- Control contexts/dependencies (optional): set `RIVER_AVAILABLE_CONTEXTS=diff,tests` or `RIVER_AVAILABLE_DEPENDENCIES=code_search,test_runner` to skip skills that require unavailable inputs; if unset, dependency checks are bypassed for backward compatibility.
- Override via CLI flags: `--context diff,fullFile` and `--dependency code_search,test_runner` override the env vars (comma-separated).
- Enable stub dependencies: set `RIVER_DEPENDENCY_STUBS=1` to treat known dependencies (`code_search`, `test_runner`, `coverage_report`, `adr_lookup`, `repo_metadata`, `tracing`) as available so planning doesn’t skip them while provider implementations are being readied.

## Skills

Skills are Markdown files with YAML frontmatter; River Reviewer uses the metadata to load and route them.

```markdown
---
id: rr-midstream-code-quality-sample-001
name: Sample Code Quality Pass
description: Checks common code quality and maintainability risks.
phase: midstream
applyTo:
  - 'src/**/*.ts'
tags: [style, maintainability, midstream]
severity: minor
---

- Instruction text for the reviewer goes here.
```

- Sample skills: `skills/upstream/sample-architecture-review.md`, `skills/midstream/sample-code-quality.md`, `skills/downstream/sample-test-review.md`
- Schemas: `schemas/skill.schema.json` (skill metadata) and `schemas/output.schema.json` (structured review output)
- References: Skill schema details live in `pages/reference/skill-schema-reference.md`; Riverbed Memory design draft lives in `pages/explanation/riverbed-memory.md`.

## AI Review Standard Policy

River Reviewer follows a standard review policy to maintain consistent quality and reproducibility. The policy defines evaluation principles, output format, and prohibited actions to ensure constructive and specific feedback.

- **Evaluation Principles**: Intent understanding, risk identification, impact assessment
- **Output Format**: Summary, Comments (specific findings), Suggestions (improvement proposals)
- **Prohibited Actions**: Excessive speculation, abstract reviews, inappropriate tone, out-of-scope findings

For details, see [AI Review Standard Policy](pages/reference/review-policy.en.md).

## Documentation design

River Reviewer’s technical documentation follows the
[Diátaxis documentation framework](https://diataxis.fr/). Japanese is the default language; English editions use the `.en.md` suffix and are maintained on a best-effort basis.

We organize content into four types, mapped by directory under `pages/` and served at `/docs`:

- Tutorials—step-by-step lessons for new users (`pages/tutorials/*.md` / `*.en.md`)
- Guides—recipes for achieving specific tasks (`pages/guides/*.md` / `*.en.md`)
- Reference—accurate technical facts (`pages/reference/*.md` / `*.en.md`)
- Explanation—background and reasoning (`pages/explanation/*.md` / `*.en.md`)

## Roadmap

- Phase-aware review expansion across upstream → midstream → downstream
- Riverbed Memory to retain ADR links, WontFix decisions, and past findings
- Evals/CI integration to keep the agent trustworthy over time

## Contributing

See `CONTRIBUTING.md` for guidance. Issues and PRs are welcome as we expand River Reviewer.

## License

This repository uses multiple licenses by asset type.

- `LICENSE-CODE` (MIT): code and scripts
  - Examples: `src/**`, `scripts/**`, `tests/**`
- `LICENSE-CONTENT` (CC BY 4.0): documentation, text, and media
  - Examples: `pages/**`, `skills/**`, `assets/**`, `README*.md`
- `LICENSE` (Apache-2.0): repository scaffolding and configuration
  - Examples: `.github/**`, `docusaurus.config.js`, `sidebars.js`, `package*.json`, `*.config.*`, `.*rc*`

If you're unsure which license applies to newly added files, please call it out in the PR and discuss it.
