---
id: human-judgment-focus-en
title: Human Judgment Focus
---

River Review is **not a tool for replacing human review with AI**. It is a framework that executes your team's review criteria as versioned skills, so that humans can focus on the judgments that truly need them.

## "A review happened" is not "understanding is shared"

Confirming an implementation diff does not, on its own, guarantee shared system understanding or shared design intent. A diff shows _what_ changed, but not _why_ the change is sound or whether it is consistent with prior design decisions.

At the same time, having a human synchronize the full context on every PR does not scale.

- High cognitive load on reviewers
- Increased lead time from review queues
- Review perspectives become tied to individual reviewers
- Re-reading the full context from scratch on every review

River Review lowers this burden while letting humans concentrate on high-risk judgment.

## What River Review reduces / does not replace

The goal of River Review is not to **replace** human judgment, but to **focus** it on high-risk areas.

| Category                           | Content                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| What River Review reduces          | Indiscriminate human sync / shallow diff-only review / reviewer-specific tacit knowledge / re-reading context from zero     |
| What River Review does not replace | Final accountability / design decisions / business validity / critical security judgment / approval of irreversible changes |

River Review is a mechanism for increasing the evidence available for a decision — not for delegating responsibility. How much human supervision applies is not uniform: it is allocated across three risk tiers — cliff, hill, and field.

## Review allocation by risk tier

Weight your review effort across three tiers according to the risk of the change. The lower the risk, the more you lean on River Review skills; the higher the risk, the heavier the human supervision. The SSoT for the tier definitions is the "Direction of travel: risk-tiered human supervision" section of [Design Philosophy](./design-philosophy.en.md).

| Risk tier                  | Lean onto River Review                                                                   | Human supervision                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Cliff (ESCALATE)           | detection of auth / payment / personal data / security boundary / irreversible migration | Human approval is mandatory; escalate whenever anything is unclear     |
| Hill (GO_WITH_OBSERVATION) | plan-diff conformance / tests / migration policy / API contract                          | Time-boxed observation, plus a check of design intent and blast radius |
| Field (GO)                 | lint / format / naming / docs / simple refactors                                         | Autonomous convergence, audited after the fact via run-record / digest |

The common Low / Medium / High risk wording maps onto field / hill / cliff respectively.

For changes on the cliff, River Review goes as far as detection and presenting the evidence. The final "pass / block" decision is made by humans.

## Use cases

River Review reduces repetitive review synchronization and lets human reviewers focus on high-risk judgment.

- **Plan Review** — detect dangerous gaps in requirements, design, and plan before implementation
- **Diff Review** — confirm the implementation diff is consistent with the plan, design, and test policy
- **Test Review** — confirm tests are sufficient against the spec and the risks
- **Review Comment Review** — re-examine whether existing AI or human review comments are valid (see [W-check](../guides/w-check.en.md))

## Do not over-trust AI review

River Review increases the available evidence, but it is not a complete substitute for human approval. The following areas require human judgment.

- Security boundaries, authentication, and authorization
- Personal data, payments, and data migration
- Irreversible changes

Avoid merging based solely on AI review results in these risk areas. River Review's verdicts (`merge-ready` / `human-review` / `block`) support human judgment; they do not stand in for it.

## Related pages

- [Concept](./concept.en.md) — the overall picture: problems, core model, responsibility boundary
- [What is River Review](./what-is-river-review.en.md) — features, usage, and the execution model
- [Design Philosophy](./design-philosophy.en.md) — the design thinking, including risk-tiered human supervision
- [Review scope and use cases](./review-scope.en.md) — the breakdown of review targets
- [W-check (double review) guide](../guides/w-check.en.md) — re-examining existing review results
