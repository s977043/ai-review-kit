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

Each Lens maps onto the existing routers and roles. The coverage column corresponds to the Issue #1545 coverage analysis (Covered / Partial / Gap).

| Lens         | Core question                                             | Implementation-area router           | Review team role                | Coverage |
| ------------ | --------------------------------------------------------- | ------------------------------------ | ------------------------------- | -------- |
| engineering  | Are design, maintainability, and extensibility sound?     | `river-review-code`                  | `bug-hunter`                    | Covered  |
| security     | Are authn, authz, input, and data protection safe?        | `river-review-security`              | `security-scanner`              | Covered  |
| qa           | Are acceptance criteria, edges, and regressions covered?  | `river-review-testing`               | `test-gap`                      | Covered  |
| design       | Are UX, legibility, usability, and a11y sound?            | `river-review-frontend`              | `frontend-reviewer`             | Covered  |
| architecture | Do boundaries, deps, dataflow, and contracts hold?        | `river-review-architecture`          | (no dedicated role)             | Partial  |
| operability  | Are monitoring, incident response, config, deploy safe?   | `river-review-performance` (partial) | `ci-cd-reviewer` (partial)      | Partial  |
| devex        | Does it avoid harming API, CLI, setup, and debugging?     | `river-review-docs` (partial)        | (no dedicated role)             | Partial  |
| release      | Are migration, compatibility, and rollback safe?          | (no dedicated router)                | `dependency-reviewer` (partial) | Partial  |
| product      | Does it fit requirements, user value, and business rules? | (no dedicated router)                | (no dedicated role)             | Gap      |

Read the coverage column as follows.

- Covered — both a router and a role have a mapping target.
- Partial — only one side, or only a partial target, exists.
- Gap — no dedicated target exists; consider adding one when the need arises.

## Handling Gaps

The Gap and Partial Lenses (product, the dedicated architecture role, privacy, accessibility, release) are added as registry skills only when a real gap is observed in practice. Reviewers are not grown ahead of that signal. Lenses that need out-of-code artifacts, such as product or design, receive those artifacts through the artifact input contract (`pages/reference/artifact-input-contract.md`).

## Boundary with PlanGate

The vocabulary definition of a Lens has River Review as its SSoT. River Review owns "defining, running, and remembering review perspectives" and does not own GO / NO-GO, stop, approval, or merge. PlanGate (Issue #851) consumes River Review's findings and references Lenses as mode / risk inputs. To avoid double definition, the Lens vocabulary lives only in this document.

Related documents:

- Review team execution flow — `skills/agent-skills/review-team/SKILL.md`
- Review-perspective axes — [Upstream, Midstream, Downstream](./upstream-midstream-downstream.en.md)
- Artifact input contract — [config-schema](../reference/config-schema.en.md)

## Notes for Human Review

- This document covers mapping only; it adds no new vocabulary, schema, or registry.
- Primary sources are unverified; re-check the Lens definitions once the originals are available.
- The review team roles are dual-managed across SKILL.md and `reviewer-orchestrator.mjs`. This document stays a mapping and does not worsen that duplication.
