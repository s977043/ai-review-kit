---
id: reviewer-lens-taxonomy-en
title: Reviewer Lens Taxonomy
---

A Reviewer Lens is an explanatory term for organizing River Review's existing review machinery by **evaluation purpose**. It is not a new registry or schema column; it is a vocabulary that maps the existing **implementation-area routers** and **review team roles** onto evaluation purposes.

:::info[Scope of this document]
This document is an explanatory mapping only. It changes no code and no schema. A Lens is not promoted to a schema enum or a registry ID; it stays a doc-level term. See Issue #1545 for the full analysis behind it.
:::

## Provenance

The Lens framing imports concepts from three external frameworks. The references are nominative only and assert no endorsement or affiliation.

- g-stack — purpose-specific specialist review (CEO / engineering / design / DevEx, and so on)
- Superpowers — review against the spec, with traceability
- Matt Pocock skills — conformance review of alignment artifacts

:::warning[Primary sources unverified]
The primary sources for the three frameworks above could not be retrieved at the time of writing. The content therefore treats the Issue #1545 summary as authoritative. If the originals become available, re-check the Lens definitions for gaps or excess.
:::

## What a Lens Is

A Lens expresses "with which evaluation function do we review." River Review already carries two taxonomies side by side.

- Implementation-area routers — the seven skills `skills/agent-skills/river-review-{architecture,code,docs,frontend,performance,security,testing}`
- Review team roles — `REVIEWER_ROLES` in `src/lib/reviewer-orchestrator.mjs` (six roles)

A Lens is not a third taxonomy. It is a reading that maps those two onto evaluation purposes. The policy is to avoid growing reviewers without bound, and to add a Lens only when its purpose, applicability, and expected outcome are clear.

## Mapping Table

Each Lens maps onto the existing routers, review team roles, and the registry skills in `skills/registry.yaml`.

| Lens         | Core question                                             | Implementation-area router           | Review team role                | Registry skills (examples)                                                            | Coverage |
| ------------ | --------------------------------------------------------- | ------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| engineering  | Are design, maintainability, and extensibility sound?     | `river-review-code`                  | `bug-hunter`                    | `existing-pattern-conformance` / `async-correctness` / `nullability-contract`         | Covered  |
| security     | Are authn, authz, input, and data protection safe?        | `river-review-security`              | `security-scanner`              | `security-basic` / `secret-credential-scan` / `trust-boundaries-authz`                | Covered  |
| qa           | Are acceptance criteria, edges, and regressions covered?  | `river-review-testing`               | `test-gap`                      | `test-existence` / `coverage-gap` / `flaky-test`                                      | Covered  |
| design       | Are UX, legibility, usability, and a11y sound?            | `river-review-frontend`              | `frontend-reviewer`             | `design-system-component-reuse` / `design-token-enforcement` / `a11y-accessible-name` | Covered  |
| architecture | Do boundaries, deps, dataflow, and contracts hold?        | `river-review-architecture`          | (no dedicated role)             | `architecture-boundaries` / `architecture-traceability` / `data-flow-state-ownership` | Covered  |
| operability  | Are monitoring, incident response, config, deploy safe?   | `river-review-performance` (partial) | `ci-cd-reviewer` (partial)      | `operability-slo` / `failure-modes-observability` / `availability-architecture`       | Covered  |
| devex        | Does it avoid harming API, CLI, setup, and debugging?     | `river-review-docs` (partial)        | (no dedicated role)             | `api-design` / `openapi-contract` / `api-compatibility` / `doc-hygiene`               | Covered  |
| release      | Are migration, compatibility, and rollback safe?          | (no dedicated router)                | `dependency-reviewer` (partial) | `migration-rollout-rollback` / `migration-safety` / `api-versioning-compat`           | Covered  |
| product      | Does it fit requirements, user value, and business rules? | (no dedicated router)                | (no dedicated role)             | (none)                                                                                | Gap      |

Read the coverage column as follows.

- Covered — some combination of router, role, and registry skills provides a mapping target for the evaluation purpose.
- Gap — no mapping target exists; consider adding one when the need arises.

:::info[Coverage recomputed with registry skills included (#1545 Phase 1.5 / U2)]
The first version of this table counted only the seven routers and six roles, ignoring the registry skills in `skills/registry.yaml`. As a result operability, release, devex, and architecture were shown as Partial even though they were covered, which invites the wrong investment decision — "there are many Gaps, so add more Lenses." After the recomputation the only true Gap is product. A Lens counts as Covered when registry skills satisfy its evaluation purpose, even with no dedicated role.
:::

## Cross-Cutting Lens: rationale

rationale (rationale traceability) is not a row in the mapping table. It is a **reading that cuts across the existing Lenses** (option C from Issue #1783 Phase 0). The placement principle — How in the code, What in the tests, Why in the Issue / Plan / PR, Why not in comments / ADRs — is layered on top of the engineering, qa, architecture, and product Lenses.

No separate review gate is added. The list of 13 finding codes and their mapping targets is consolidated in `docs/review/rationale-traceability.md` in the repository (Japanese only; there is no English edition under `docs/`). The severity vocabulary remains owned by `.claude/rules/review-core.md` and the review policy by `pages/reference/review-policy.md`; that document is a derivative that only records the mapping. Like every other Lens, this one stays a doc-level vocabulary and is not promoted to a schema enum or a registry ID.

## Handling Gaps

Gap Lenses (currently product only) are added as registry skills only when a real gap is observed in practice. Reviewers are not grown ahead of that signal. Lenses that need out-of-code artifacts, such as product or design, receive those artifacts through the [artifact input contract](../reference/artifact-input-contract.en.md).

## Design Decisions

- For per-Lens effectiveness aggregation (Issue #1545 Phase 3), `lens` is not stored as a field on a feedback entry. It is derived at aggregation time from `skillId` through the mapping table in this document.
- Storing it would break the idempotency of Issue #1574 contract 4 (content-addressed candidate ID) and the clusterKey compatibility of contract 5 whenever the mapping table is revised.

## Boundary with PlanGate

The vocabulary definition of a Lens has River Review as its SSoT. River Review owns "defining, running, and remembering review perspectives" and does not own GO / NO-GO, stop, approval, or merge. PlanGate (Issue #851) consumes River Review's findings and references Lenses as mode / risk inputs. To avoid double definition, the Lens vocabulary lives only in this document.

Related documents:

- Review team execution flow — `skills/agent-skills/review-team/SKILL.md`
- Review-perspective axes — [Upstream, Midstream, Downstream](./upstream-midstream-downstream.en.md)
- Artifact input contract — [artifact-input-contract](../reference/artifact-input-contract.en.md)

## Notes for Human Review

- This document covers mapping only; it adds no new vocabulary, schema, or registry.
- Primary sources are unverified; re-check the Lens definitions once the originals are available.
- The review team roles are dual-managed across SKILL.md and `reviewer-orchestrator.mjs`. This document stays a mapping and does not worsen that duplication.
