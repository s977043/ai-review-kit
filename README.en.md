# River Reviewer

![River Reviewer logo](assets/logo/river-reviewer-logo.svg)

English edition. The primary Japanese README lives in `README.md`.  
[日本語の README はここ](./README.md) — the Japanese copy is the source of truth; English may lag.

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
      - uses: actions/checkout@v5
      - name: Run River Reviewer (midstream)
        uses: s977043/river-reviewer@v1
        with:
          phase: midstream # upstream|midstream|downstream|all (future-ready)
```

Note: Replace `@v1` with the latest released tag when a newer version is available.

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

- `LICENSE`: Apache-2.0 for repository scaffolding/config
- `LICENSE-CODE`: MIT for code and scripts
- `LICENSE-CONTENT`: CC BY 4.0 for docs and media
