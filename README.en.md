# River Review

**Codify your team's judgment into automated PR gates.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Documentation](https://img.shields.io/badge/docs-available-blue)](https://river-review.the3396.com/explanation/intro/)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13339/badge)](https://www.bestpractices.dev/projects/13339)

![River Review logo](assets/logo/river-review-logo.svg)

English edition. The primary Japanese README lives in `README.md`.
[日本語の README はここ](./README.md)—the Japanese copy is the source of truth; English may lag.

River Review is an OSS framework for turning review standards into versioned, repo-owned skills that can run across plans, diffs, tests, JUnit, and prior review artifacts.

It is built for teams using AI-assisted development (Claude Code, Codex, Cursor, and similar), where implementation can be generated quickly but **review judgment still needs to stay explicit, repeatable, and owned by the team**.

River Review helps you answer questions like:

- Does this diff match the approved implementation plan?
- Do the tests cover the boundary cases promised in the plan?
- Does this PR violate the team's migration, security, accessibility, or dependency policy?
- Did the implementation agent ignore feedback from a previous review?

> River Review does not replace human review with AI. By executing your team's review criteria as versioned skills, it lets human reviewers focus on the high-risk judgment that truly needs them ([Human Judgment Focus](https://river-review.the3396.com/explanation/human-judgment-focus/)).

## Why River Review?

| Axis                    | Existing AI review tools | River Review                                                              |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------- |
| Input                   | Mostly the diff          | Plan, diff, tests, JUnit, prior review artifacts                          |
| Judgment                | Vendor black box         | Versioned skills in your repository                                       |
| Knowledge ownership     | Provider-owned           | Repo-owned and reviewable                                                 |
| Gates                   | Usually PR-time only     | Design and implementation gates (verify gate planned)                     |
| Finding reproducibility | Varies per run           | Suppression memory, fixture-based regression tests, deterministic scoring |
| Agent workflow          | Standalone reviewer      | **Audit layer for AI-assisted implementation**                            |

River Review is not another prompt wrapper around a PR diff. It is a way to make your team's review judgment executable — an audit layer that checks AI-written code against your own rules.

## Core Model

**Skills define judgment.** A skill describes how a review decision should be made: security policy, accessibility, migration safety, dependency rules, plan conformance, and other team-specific standards.

**Gates execute judgment.** Plan and exec gates run those skills at the right point in the delivery flow — not only after the PR is already complete (a verify gate is planned in [#802](https://github.com/s977043/river-review/issues/802)).

**Riverbed remembers judgment.** Review outcomes, decisions, and reusable context become part of the operating memory so future reviews stay consistent (see [`pages/guides/use-riverbed-memory.en.md`](pages/guides/use-riverbed-memory.en.md), with suppression of WontFix items and prior-decision recall).

In AI-assisted workflows, River Review acts as the **team-owned audit layer**: implementation agents can write code, but River Review checks whether that work still follows the team's rules.

## Three core axes

River Review's value falls into three axes. All three derive from the same foundation: turning your team's review judgment into a versioned, repo-owned asset.

### 1. A capability pack that strengthens an AI agent's review ability

River Review's skill and agent definitions are a **capability pack** that brings your team's review judgment to AI agents such as Claude Code, Cursor, and Codex. In normal use the agent's own model applies the skills, so **no River Review LLM key is required**. A key is needed only for headless execution (GitHub Action / standalone `river run`); mechanically-decidable perspectives run even without one (see the [FAQ](#faq) for the execution model).

### 2. Review skills (the Skill Registry)

The foundation is the Skill Registry. Team-specific tacit knowledge — security, accessibility, migration safety, dependency policy, plan conformance, and more — is made explicit as a versioned, repo-owned review asset, then improved continuously with fixtures and golden outputs. See [Core Model](#core-model) for details.

### 3. A review agent plus a perspective-based review team

River Review offers three review-focused execution shapes.

- **Review agent definition**: `agents/river-review.md`, distributed as a plugin / sub-agent. It works as a skill-routed orchestrator and lets you invoke each specialist skill via `/river-review:<skill>`.
- **A review team that runs perspective-based reviewers in parallel**: roles such as bug-hunter, security-scanner, test-gap, dependency-reviewer, frontend-reviewer, and ci-cd-reviewer run in parallel inside a single orchestrator (`src/lib/reviewer-orchestrator.mjs`), and their findings are merged via connected-components. Pass `--reviewers auto` to select perspectives automatically from the diff type.
- **A verdict-bearing critic (the Agent layer)**: in a generate → review → revise loop, it emits findings plus a verdict (decision material). The Reference Loop lives in `examples/loop-reference-agent/`, and the convergence contract in [`pages/reference/loop-convergence-contract.en.md`](pages/reference/loop-convergence-contract.en.md) (Agent-layer Epic [#1150](https://github.com/s977043/river-review/issues/1150)).

> **Role split and HITL boundary**: the review team emits findings plus a verdict, but the GO / NO-GO decision, iteration, and stopping remain the caller's or human's responsibility. It does not auto-approve or auto-merge. The review team here means "perspective-based reviewer roles run in parallel inside one orchestrator with their findings merged," not a set of fully autonomous independent agents. River Review keeps the "River Review reviews / PlanGate stops or passes" role split.

## Getting Started

The shortest no-install path is the bundled plugin: add the marketplace and ask the `river-review` agent to review the current diff — see [Installing the river-review plugin](#installing-the-river-review-plugin). For CI, use GitHub Actions ([Quick start](#quick-start-github-actions)).

> **Once the `river` CLI is published**, you will also be able to try it locally with `npx river run . --dry-run`. The npm publish workflow and `publishConfig` are implemented ([#942](https://github.com/s977043/river-review/pull/942)); the package is **not yet on npm** — publishing is enabled by setting the `NPM_TOKEN` secret ([#800](https://github.com/s977043/river-review/issues/800)). Until then, use the plugin or GitHub Actions paths above.

| Goal                                    | Destination                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| Try it in 5 minutes                     | [Quick start (GitHub Actions)](#quick-start-github-actions)                             |
| Install as a Claude Code / Codex plugin | [Installing the plugin](#installing-the-river-review-plugin)                            |
| Add to an existing repo                 | [Setup guide](https://river-review.the3396.com/guides/github-actions/)                  |
| Start with a bundled Skill Pack         | [Using Skill Packs](pages/guides/use-skill-packs.en.md)                                 |
| Create your first skill                 | [Skill tutorial](https://river-review.the3396.com/tutorials/creating-your-first-skill/) |
| Estimate run cost                       | [Cost estimation guide](pages/guides/cost-estimation.en.md)                             |
| Use W-check (double review)             | [W-check guide](pages/guides/w-check.en.md)                                             |
| Use from an AI agent                    | [Agent workflow guide](pages/guides/agent-workflow.en.md)                               |
| Repo-wide aware review                  | [Repo-wide review guide](pages/guides/repo-wide-review.en.md)                           |
| Understand the design                   | [Architecture docs](https://river-review.the3396.com/explanation/river-architecture/)   |

See [docs/runbook/dev.md](docs/runbook/dev.md) for the development runbook. License details are at the [bottom of this file](#license).

## FAQ

### Why not just use ESLint, type checks, or SonarQube?

Keep using them. River Review is not a replacement for static analysis.

Linters and static analyzers are best at deterministic checks inside code: syntax, types, unsafe APIs, style rules, complexity, duplication, and known security patterns.

River Review handles review judgment that **crosses artifacts**:

- Does the implementation diff still match the approved plan?
- Do the tests cover the boundary cases promised in the plan?
- Does this migration follow the team's rollout policy?
- Is this dependency acceptable under the repository's policy?
- Did the PR address feedback already raised by another reviewer?

These usually require context from plans, diffs, tests, prior comments, and team-specific standards. River Review handles that layer with LLM-backed, structured, testable skills.

> **Usually no LLM key is needed**: River Review's skills are a **capability pack that strengthens an AI agent's** (Claude Code / Cursor / Codex …) review ability. In normal use the agent's own model applies the skills, so **no River Review LLM key is required**. A key is needed only for **headless execution (GitHub Action / standalone `river run`)** — and some mechanically-decidable perspectives run even without one. See [What is River Review § Execution model](pages/explanation/what-is-river-review.en.md).

### Where does our code and review data go?

River Review is designed around **repo-owned configuration** and **provider-agnostic execution**.

Skills live in your repository. The review rules are versioned with your code, not hidden inside a vendor account. Runtime behavior depends on the provider (OpenAI / Anthropic / Google) and runner (GitHub Actions / CLI / Node API) you configure, so teams can choose the data boundary that matches their security requirements.

For sensitive repositories, start with narrow inputs, explicit artifact contracts, and CI-controlled execution.

### Is River Review dependent on PlanGate?

No. PlanGate is one useful workflow shape, but River Review is not tied to a single planning methodology.

The core contract is **artifact-based**: River Review can evaluate plans, diffs, tests, JUnit output, prior review comments, or other structured inputs. A team can adopt only PR-time checks first, then add plan and verify gates later.

### How do we control cost?

Treat skills like CI jobs.

Run cheap deterministic checks first. Run River Review only on the artifacts and skills that matter for the change. Start with a small official skill pack, then add repository-specific skills where human review cost or regression risk is high.

Good skills should include fixtures and golden outputs so teams can measure whether the review signal is worth the runtime cost. With the Anthropic provider, prompt caching is applied automatically, and `RIVER_USAGE_TELEMETRY=1` persists usage as JSONL.

<a id="philosophy"></a>

## The Philosophy (Why we built it)

> **We stopped believing "polish the prompt and you win."**

The biggest barrier to production AI review is not prompt quality but repeatability of review findings and operating cost.
River Review is not just a tool that lets an AI read code.

We define team-specific judgment criteria and review procedures as reusable **Agent Skills (a toolbox with manuals)**, so they can be grown as durable organizational assets.

🔗 **Read the full story (Japanese):**
[「プロンプトを磨けば勝てる」をやめた：AIレビューを運用に乗せる“Agent Skills”設計](https://note.com/mine_unilabo/n/nd21c3f1df22e)

## Flow story

- **Upstream (design)**: ADR-aware checks keep architecture decisions aligned before code drifts.
- **Midstream (implementation)**: style and maintainability guardrails guide everyday coding.
- **Downstream (tests/QA)**: test-focused skills highlight coverage gaps and failure paths.
- **Phase-aware routing**: skills are selected by `phase` and file metadata, so feedback matches where you are in the stream.

## Positioning: artifact-driven review agent

River Review is an **artifact-driven review agent**. It consumes externally supplied artifacts (`plan` / `diff` / `test-cases` / `junit`, etc.) and produces review results that include `findings`. The input contract is defined in the [Artifact Input Contract](pages/reference/artifact-input-contract.en.md), and the output schema in the [Review Artifact](pages/reference/review-artifact.en.md) reference.

The primary integration today is with **PlanGate v6**: River Review receives `plan` / `pbi-input` artifacts produced by PlanGate and inspects them for design integrity and implementation conformance using dedicated skills.

### Four use cases

> **Note**: The `river review plan` and `river review exec` CLI commands are stable as of v0.53.0. `river review exec --plan` replay execution shipped in v0.68.0 (#935). The `river review verify` command is not yet implemented (placeholder only).

- **Design review**: pass `pbi-input` / `plan` to check plan integrity and completeness with upstream skills (e.g. `skills/upstream/rr-upstream-plangate-plan-integrity-001/`).
- **Implementation review**: pass `plan` + `diff` to check that the code change matches the plan (e.g. `skills/upstream/rr-upstream-plangate-exec-conformance-001/`).
- **QA review**: pass `test-cases` / `junit` / `coverage` so downstream skills can surface coverage gaps and failure paths.
- **Double-check (W-check)**: pass existing AI or human review output as `review-self` / `review-external` to review the review itself.

### CLI examples

See [`river review plan` CLI spec](pages/reference/cli-review-plan-spec.en.md) and [`river review exec` CLI spec](pages/reference/cli-review-exec-spec.en.md) for full details.

```bash
# Design review: inspect the plan alone
river review plan --artifact plan=./artifacts/plan.md

# Implementation review: check the diff against the plan
river review exec \
  --artifact plan=./artifacts/plan.md \
  --artifact diff=./artifacts/diff.patch

# QA review: add test-related artifacts
river review exec \
  --artifact diff=./artifacts/diff.patch \
  --artifact test-cases=./artifacts/test-cases.md \
  --artifact junit=./artifacts/junit.xml
```

## Quick start (GitHub Actions)

Minimal workflow using the v1 action tag. `phase` is a future/optional input that will route skills per SDLC phase.

```yaml
name: River Review
on:
  pull_request:
    branches: [main]
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Run River Review (midstream)
        uses: s977043/river-review/runners/github-action@v1.14.0
        with:
          phase: midstream # upstream|midstream|downstream|all (future-ready)
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Pin to a release tag such as `@v1.14.0` for stability. Alternatively, use the floating major-version alias `@v1`, which always points at the latest 1.x release.

<!-- x-release-please-start-version -->

Latest release: [v1.30.1](https://github.com/s977043/river-review/releases/latest)

<!-- x-release-please-end -->

> **ℹ️ Upgrading from v0.1.x:** v0.2.0 and later use the new GitHub Action path `runners/github-action` instead of `.github/actions/river-review`. See [Migration Guide](docs/migration/runners-architecture-guide.md) and [DEPRECATED.md](docs/deprecated.md) for details.

## Quick start (local)

1. Environment: Node 22+ recommended (CI runs on Node 22; Unit tests also validate Node 20.x)
2. Install dependencies: `npm install`
3. Validate skills: `npm run skills:validate`
4. Validate Agent Skills (optional): `npm run agent-skills:validate`
5. Tests: `npm test`
6. Planner evaluation (optional): `npm run planner:eval`
7. Review fixtures evaluation (optional): `npm run eval:fixtures` (must_include style)
8. Repo-wide evaluation (optional): `npm run eval:repo-context` (measures detection / context lift / false positive against the [#688](https://github.com/s977043/river-review/issues/688) repo-wide fixtures)
9. Docs development (optional): `npm run dev`

### Major features added in v0.21–v0.28

- **Suppression memory** ([#687](https://github.com/s977043/river-review/issues/687)): use `river suppression add --fingerprint <fp> --feedback accepted_risk` to stop re-surfacing accepted-risk findings. Set `memory.suppressionEnabled: false` to bypass the gate temporarily.
- **Secret redaction** ([#692](https://github.com/s977043/river-review/issues/692)): multi-stage redaction across repo-wide context and LLM prompts. Tune categories, allowlist, and denyFiles via `security.redact.*`.
- **Context budget / ranking / reviewMode** ([#689](https://github.com/s977043/river-review/issues/689)): `context.budget` for token / char caps, `context.ranking.enabled` for proximity-based reordering, `context.reviewMode: tiny | medium | large` for preset budgets.
- **Repo-wide eval suite** ([#688](https://github.com/s977043/river-review/issues/688)): `npm run eval:repo-context` reports detection rate, context lift, and false positive rate.

See [`pages/guides/repo-wide-review.md`](pages/guides/repo-wide-review.md) and [`pages/reference/config-schema.md`](pages/reference/config-schema.md) for details.

### Local review run (river run .)

> **Note**: the `river` CLI is [not yet published to npm](#getting-started), so `npx river` becomes available only after publishing. Inside the repo, run it with `npm run river -- ...`. The plugin review path is CLI-independent ([Installing the plugin](#installing-the-river-review-plugin)).

- Inside the repo, run `npm run river -- run . --dry-run` (after the CLI is published: `npx river run . --dry-run`) to print skill selection and placeholder review comments for the current diff without sending anything externally (local mode is currently planning/preview only)
- Add `--debug` to show merge base, changed files, token estimate, and a diff preview
- Specify phase via `--phase upstream|midstream|downstream`; defaults to `RIVER_PHASE` env or `midstream`
- Control contexts/dependencies (optional): set `RIVER_AVAILABLE_CONTEXTS=diff,tests` or `RIVER_AVAILABLE_DEPENDENCIES=code_search,test_runner` to skip skills that require unavailable inputs; if unset, dependency checks are bypassed for backward compatibility.
- Override via CLI flags: `--context diff,fullFile` and `--dependency code_search,test_runner` override the env vars (comma-separated).
- Enable stub dependencies: set `RIVER_DEPENDENCY_STUBS=1` to treat known dependencies (`code_search`, `test_runner`, `coverage_report`, `adr_lookup`, `repo_metadata`, `tracing`) as available so planning doesn’t skip them while provider implementations are being readied.

## Skills

Skills are Markdown files with YAML frontmatter; River Review uses the metadata to load and route them.

```markdown
---
id: rr-midstream-code-quality-sample-001
name: Sample Code Quality Pass
description: Checks common code quality and maintainability risks.
category: midstream
phase: midstream # kept for backward compatibility
applyTo:
  - 'src/**/*.ts'
tags: [style, maintainability, midstream]
severity: minor
---

- Instruction text for the reviewer goes here.
```

- Sample skills: `skills/upstream/sample-architecture-review.md`, `skills/midstream/sample-code-quality.md`, `skills/downstream/sample-test-review.md`
- Examples: `examples/README.md`
- Schemas: `schemas/skill.schema.json` (skill metadata) and `schemas/output.schema.json` (structured review output)
- References: Skill schema details live in `pages/reference/skill-schema-reference.md`; Riverbed Memory v1 (shipped in #474) is documented in `pages/explanation/riverbed-memory.md` and `pages/guides/use-riverbed-memory.md`.
- Known limitations: `pages/reference/known-limitations.md`
- Troubleshooting: `pages/guides/troubleshooting.md`

## Installing the river-review plugin

### Claude Code

river-review ships as a Claude Code plugin from a same-repo marketplace.

1. Add the marketplace (GitHub shorthand):

   ```text
   /plugin marketplace add s977043/river-review
   ```

   Pin to a tag if you want reproducible installs: `/plugin marketplace add s977043/river-review@v1.14.0`.

2. Install the plugin:

   ```text
   /plugin install river-review@river-review-marketplace
   ```

3. Activate without restarting:

   ```text
   /reload-plugins
   ```

What you get (namespaced by plugin name):

- Commands: `/river-review:review-local`, `/river-review:challenge`, `/river-review:skill`, `/river-review:check`, `/river-review:pr`
- Agent: `river-review` (skill-routed code-review orchestrator)
- Skills: the orchestrator plus `river-review-code`, `river-review-security`, `river-review-performance`, `river-review-architecture`, `river-review-testing`, `adversarial-review`, and `river-review-docs` — addressable as `/river-review:<skill-name>`

Manage: `/plugin enable|disable|uninstall river-review@river-review-marketplace`.

Local development / testing without installing:

```text
claude --plugin-dir .
```

### Codex

Codex also supports the same plugin marketplace. Both tools share the same `.claude-plugin/marketplace.json`, so installation uses the same flow as Claude Code:

```text
codex plugin marketplace add s977043/river-review
```

Pin to a tag if you want reproducible installs: `codex plugin marketplace add s977043/river-review@v1.14.0`.

Codex reads its skills and interface metadata from the repo's `.codex-plugin/plugin.json` (the Codex-native manifest). Adding the marketplace natively registers the specialist review skills (`river-review-code` / `-security` / `-performance` / `-architecture` / `-testing` / `adversarial-review` / `-docs`).

#### Alternative: manual copy-in (fallback)

For environments without the marketplace, you can copy the template and skills in by hand.

1. Copy the Codex integration template into your project:

   ```text
   cp templates/agent-workflow/codex/AGENTS.md ./AGENTS.md
   ```

2. Make the review skills available to Codex by copying the skills directory into your project (or pointing Codex at a checkout of this repo):

   ```text
   cp -R skills/agent-skills ./skills
   ```

3. Reference the skills from your `AGENTS.md` and add your own `.codex/config.toml` (`approval_policy`, `sandbox`) to taste — the repo's `.codex/` config is environment-specific and not shipped as a template.

See `templates/agent-workflow/README.md` for the full Codex (and Cursor) setup. With manual copy-in, the Codex side is versioned by git only; re-copy on upgrade.

## AI Review Standard Policy

River Review follows a standard review policy to maintain consistent quality and reproducibility. The policy defines evaluation principles, output format, and prohibited actions to ensure constructive and specific feedback.

- **Evaluation Principles**: Intent understanding, risk identification, impact assessment
- **Output Format**: Summary, Comments (specific findings), Suggestions (improvement proposals)
- **Prohibited Actions**: Excessive speculation, abstract reviews, inappropriate tone, out-of-scope findings

For details, see [AI Review Standard Policy](pages/reference/review-policy.en.md).

## Documentation design

River Review’s technical documentation follows the
[Diátaxis documentation framework](https://diataxis.fr/). Japanese is the default language; English editions use the `.en.md` suffix and are maintained on a best-effort basis.

We organize content into four types, mapped by directory under `pages/` and served at `/docs`:

- Tutorials—step-by-step lessons for new users (`pages/tutorials/*.md` / `*.en.md`)
- Guides—recipes for achieving specific tasks (`pages/guides/*.md` / `*.en.md`)
- Reference—accurate technical facts (`pages/reference/*.md` / `*.en.md`)
- Explanation—background and reasoning (`pages/explanation/*.md` / `*.en.md`)

## Roadmap

Following the concept refresh (2026-05), the roadmap is organized into the following seven epics. The Status column reflects the latest stable release.

| Epic                                       | Description                                                                                                          | Status                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Epic 0**: Official Skill Pack            | Official skill pack and minimal registry (security / a11y / migration-safety / dependency-policy / plan-conformance) | Partial — community-tier modern-web-semantic / modern-web-performance landed ([#873](https://github.com/s977043/river-review/pull/873) / [#875](https://github.com/s977043/river-review/pull/875)). Official-tier registry not yet wired                                                                                                                                       |
| **Epic 1**: First-Run Adoption             | npm distribution, `npx river try`, 10-minute Quick Start                                                             | Partial — B1 design + dry-run packaging audit landed ([#886](https://github.com/s977043/river-review/pull/886)). publish workflow + `publishConfig` shipped ([#942](https://github.com/s977043/river-review/pull/942)); activate by setting `NPM_TOKEN` secret ([#800](https://github.com/s977043/river-review/issues/800)). `npx river try` experience is planned separately. |
| **Epic 2**: SDLC Gates                     | Stabilize `plan` / `exec` / `verify` CLI, artifact-input-contract v1                                                 | Partial — `plan` / `exec` stable as of v0.53.0. `exec --plan` replay execution shipped in v0.68.0 ([#935](https://github.com/s977043/river-review/pull/935)). `verify` execution not implemented                                                                                                                                                                               |
| **Epic 3**: Concept Refresh                | README / vision / intro overhaul                                                                                     | Implemented — landed in v0.51.0 ([#860](https://github.com/s977043/river-review/pull/860))                                                                                                                                                                                                                                                                                     |
| **Epic 4**: Skill Authoring and Governance | `npx river create skill`, catalog, contribution policy                                                               | Planned — registry.yaml extensions and contribution policy untouched                                                                                                                                                                                                                                                                                                           |
| **Epic 5**: Evaluation Observability       | CI regression, skill badges, dashboard                                                                               | Planned — per-skill promptfoo eval scaffold in place, dashboard / aggregation not yet                                                                                                                                                                                                                                                                                          |
| **Epic 6**: Docs IA and Onboarding         | First-run / skill authoring / CI operation onboarding paths                                                          | Partial — `docs/review/troubleshooting.md` covers silent-skip diagnosis ([#866](https://github.com/s977043/river-review/pull/866), [#872](https://github.com/s977043/river-review/pull/872)). Quick Start / skill-authoring onboarding tracks with Epic 1                                                                                                                      |

Legend: **Implemented** = primary acceptance criteria met / **Partial** = some scope landed, more remaining / **Planned** = not yet started.

Earlier pillars (phase-aware review, Riverbed Memory, Evals/CI integration) remain in scope and are absorbed by the epics above.

Milestones and the repository Projects are the source of truth for progress (this README list is only a high-level overview).

- Milestones: [river-review/milestones](https://github.com/s977043/river-review/milestones)
- Projects: [Repository Projects page](https://github.com/s977043/river-review/projects)

(Optional) Add one of `m1-public` / `m2-dx` / `m3-smart` / `m4-community` to an issue.
This will auto-assign the corresponding milestone (`.github/workflows/auto-milestone.yml`).

## Contributing

See `CONTRIBUTING.md` for guidance. Issues and PRs are welcome as we expand River Review.

- Review checklist: `pages/contributing/review-checklist.md`

## License

This repository uses multiple licenses by asset type.

- `LICENSE-CODE` (MIT): code and scripts
  - Examples: `src/**`, `scripts/**`, `tests/**`
- `LICENSE-CONTENT` (CC BY 4.0): documentation, text, and media
  - Examples: `pages/**`, `skills/**`, `assets/**`, root `*.md`
- `LICENSE` (Apache-2.0): repository scaffolding and configuration
  - Examples: `.github/**`, `docusaurus.config.js`, `sidebars.js`, `package*.json`, `*.config.*`, `.*rc*`

If you're unsure which license applies to newly added files, please call it out in the PR and discuss it.
