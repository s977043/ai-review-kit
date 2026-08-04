---
title: PlanGate CLI Stabilization Roadmap
---

`river review plan` / `river review exec` / `river review verify` are the CLI subcommands that take artifacts produced by upstream workflows such as PlanGate and run review planning, execution, and re-audit. They are River Review's biggest differentiator, but **there is drift between the spec and the implementation, CI, and distribution**, so adopters cannot use them in a stable manner.

This document addresses [Issue #802](https://github.com/s977043/river-review/issues/802) and defines (1) an inventory of the current contract drift, (2) the decision on the public entrypoint, (3) the stabilization target-version roadmap, and (4) the spec inconsistencies to resolve and the recommended unified contract.

> Related: [Artifact Input Contract](./artifact-input-contract.en.md) / [Stable Interfaces](./stable-interfaces.en.md) / [`river review plan` spec](./cli-review-plan-spec.en.md) / [`river review exec` spec](./cli-review-exec-spec.en.md) / [`river review verify` spec](./cli-review-verify-spec.en.md) / `docs/CLI-architecture.md`

## Contract drift inventory

The following is the gap between the contract the specs declare and the reality of the implementation, CI, and distribution.

| Item                         | What the spec declares                                                                                                                   | Reality of implementation / distribution                                                                                                             | Impact                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Location of `river review *` | All 3 specs describe it as "a contract that can be called stably from CI"                                                                | The `review` subcommand exists only in the **Runner CLI** (`runners/cli/`, npm-unpublished / private bin). See `docs/CLI-architecture.md`            | `npx river review …` is **resolved to the main CLI and errors as unknown command**          |
| Public entrypoint            | Implicitly presents `river review plan/exec/verify` as a public contract                                                                 | The main CLI (`src/cli.mjs`, registered in `package.json#bin`) has no `review` command                                                               | No stable path for adopters to call from `npx` / CI                                         |
| Artifact config path         | [Artifact Input Contract](./artifact-input-contract.en.md) describes the `artifacts` section under `river.config.*` as "already defined" | `src/config/schema.mjs` has no `artifacts` key                                                                                                       | Artifact path specification via config file does not actually work                          |
| `--output` semantics         | `plan` spec: `--output <format>` (`text`/`markdown`/`json`) + `--output-file <path>`                                                     | `exec` / `verify` spec: `--output <path>` (output path, `-`=stdout) + `--format <value>`                                                             | **The same flag has opposite meanings in plan vs exec/verify**. CI scripts cannot be shared |
| Exit codes                   | `plan` spec: `0`/`1`/`2`/`3` (4 values, `3`=config error)                                                                                | `exec` / `verify` spec: `0`/`1`/`2` (3 values, `2`=config error)                                                                                     | The config-error exit code is inconsistent across subcommands                               |
| GitHub Action mapping        | `plan` spec: "provides a mapping from `action.yml` inputs to this CLI"                                                                   | The spec body explicitly states "not implemented, to be addressed separately"                                                                        | No stable path established via the Action                                                   |
| CI job                       | —                                                                                                                                        | `.github/workflows/plangate-review.yml` runs placeholder behavior gated by the `PLANGATE_REVIEW_CLI_READY` flag (can pass even with CLI unconnected) | CI green does not guarantee the CLI works (false-positive risk)                             |

## Public entrypoint decision (fixed)

**The stable public entrypoint for `river review plan` / `river review exec` / `river review verify` will be implemented on the main CLI (`src/cli.mjs`, the `river` / `river-review` `package.json#bin`).**

Rationale:

- The main CLI is the only stable path registered in the npm `bin` and used in the GitHub Action production path (`runners/github-action` → `src/cli.mjs`).
- The Runner CLI (`runners/cli/`) is npm-unpublished, an experimental interface for skill developers, and `docs/CLI-architecture.md` explicitly states there is no replacement plan. The Runner CLI's `review` keeps its **quick-check** positioning and does not bear the stable CI contract.
- This decision **uniquely fixes the location of the public API** when [Issue #801](https://github.com/s977043/river-review/issues/801) (separating the review engine and docs site into packages) designs the separation boundary. #801 must not break this boundary (the `review` subcommand on `src/cli.mjs` and the import boundary of the `src/lib/*` it depends on).

> This entrypoint decision only makes the "decision" within the scope of #802. The implementation (adding the `review` subcommand to the main CLI) is done in a later phase (Phase 3 below) with design approval.

## Stabilization target-version roadmap

Stability labels follow the vocabulary in [Stable Interfaces](./stable-interfaces.en.md). The target for each subcommand is defined in 3 stages.

| Subcommand            | Current                 | Alpha (contract fixed)                                                              | Beta (dry-run E2E)                                 | Stable (CI-integratable)                                           |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `river review plan`   | spec only (unconnected) | spec inconsistencies resolved + main CLI impl + `--plan-only --output json`         | E2E with PlanGate sample fixtures (dry-run)        | switch the `plangate-review.yml` feature flag to a live connection |
| `river review exec`   | spec only (unconnected) | spec inconsistencies resolved (unify to the same output/exit-code contract as plan) | linked plan→exec E2E (advisory)                    | provide Action inputs mapping                                      |
| `river review verify` | spec only (unconnected) | spec inconsistencies resolved (same shape as exec)                                  | linked exec→verify E2E (META finding verification) | publish CI integration guide                                       |

Integration into the ai-agent-template C-1 / C-2 workflows is "plannable" once each subcommand reaches **Beta (dry-run E2E passing)**, and "executable for integration" at **Stable**.

## Spec inconsistencies to resolve and recommended unified contract

The following are the inconsistencies across specs and the recommended unification, which are prerequisites for stabilization (Alpha). **Because they involve breaking contract changes, the finalization and spec revisions will be done in a later PR with design approval** (this document only presents the recommended proposals).

### 1. Unify `--output` / `--format` semantics

- Current: `plan` uses `--output <format>` + `--output-file <path>`; `exec`/`verify` spec uses `--output <path>` + `--format <value>`.
- **Decision (#802 Phase 3, approved 2026-05-18): unify to the `plan` side** (`--output <format>` = format, `--output-file <path>` = destination). The `exec`/`verify` spec is revised so `--output <path>` becomes `--output-file <path>` and `--format` becomes `--output <format>`. `--format` is accepted as a compatibility alias in the review namespace (plan/exec/verify); the canonical flag is `--output <format>`. If both `--output` and `--format` are given and disagree, it is a configuration error (exit 3).
  - Why the original recommendation (unify to the `exec`/`verify` `--output <path>` side) was withdrawn: it inverts the meaning of the global `--output <mode>` (`river run`, `text|markdown|json|yaml`) and contradicts the actual `river review plan` implementation (which never honored `--output`, always emits JSON, destination via `--output-file`) and `plangate-review.yml`'s own `--output json --output-file` invocation. Unifying to the `plan` side keeps the global flag, the implementation, and the workflow consistent with minimal breakage.
  - Versioning: `review plan --output` was never honored and `exec`/`verify` are unimplemented, so there is no runtime breakage. Call it out in the release notes as a Beta spec correction.

### 2. Unify exit codes

- Current: `plan` uses `0`/`1`/`2`/`3` (`2`=warnings only, `3`=config error); `exec`/`verify` use `0`/`1`/`2` (`2`=config error).
- Recommendation: **unify to 4 values (`0`/`1`/`2`/`3`)**. `2`=warnings only, `3`=config error. `exec`/`verify` currently use `2`=config error, but as long as CI treats `!= 0` as failure, backward compatibility is preserved (and it is not incompatible with the minimal `0`/`1` contract in [Stable Interfaces](./stable-interfaces.en.md)). Making `plan`'s `--warn-on`/`advisory` distinction common across all 3 subcommands unifies the gating logic.
  - **Superseded (#1709, settled 2026-08)**: the part of "`3`=config error" that covered argument errors is superseded. Argument errors detected in the parse layer (unknown options, surplus positionals, missing or invalid values) are unified to `1` across every command, and `3` is limited to handler-layer configuration errors and the `--gate` ESCALATE decision.

### 3. Artifact config schema

- Current: [Artifact Input Contract](./artifact-input-contract.en.md) presumes the `artifacts` section under `river.config.*`, but it is undefined in `src/config/schema.mjs`.
- Recommendation: **add a generic `artifacts.<artifactId>` to `src/config/schema.mjs`, not a PlanGate-specific `plangate.artifacts.*`**. The Artifact Input Contract itself states PlanGate independence, so a PlanGate-specific key runs counter to the design. If a default path set for PlanGate is needed, add it later as an optional profile such as `artifacts.profiles.plangate`.

## Phase plan

| Phase   | Content                                                                                                                   | Autonomous-executable?                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Phase 1 | Publish this roadmap (drift inventory, entrypoint decision, stabilization-version definition, proposals)                  | Yes (docs only, additive)                  |
| Phase 2 | Add a generic `artifacts.*` schema to `src/config/schema.mjs` + artifact resolver + unit tests                            | Requires design approval (schema)          |
| Phase 3 | Minimal `river review plan --plan-only --output json` impl on the main CLI + PlanGate fixture E2E + workflow flag cleanup | Requires design approval (`src/` CLI impl) |

From Phase 2 onward, work proceeds on the premise of the policy fixed in this roadmap (entrypoint, unified contract), presenting the design and obtaining approval in each PR before starting. Each PR passes `npm run lint && npm test` on its own, and runs `npm run check:links:local` when `pages/` changes.

## Related documents

- [Artifact Input Contract](./artifact-input-contract.en.md) — the input artifact contract
- [`river review plan` spec](./cli-review-plan-spec.en.md) / [`river review exec` spec](./cli-review-exec-spec.en.md) / [`river review verify` spec](./cli-review-verify-spec.en.md)
- [Stable Interfaces](./stable-interfaces.en.md) — vocabulary and versioning of stable contracts
- [Review Artifact](./review-artifact.en.md) — output JSON schema
