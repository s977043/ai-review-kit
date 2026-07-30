---
id: review-scope-en
title: Review scope and use cases
---

River Review is not a tool that reviews only the PR diff.

In AI-assisted development, many decisions happen before any code is written. When the interpretation of requirements, design direction, implementation plan, test policy, and the granularity of the completion report stay ambiguous, reviewing only after implementation leads to large rework.

River Review receives these decisions as **artifacts** and reviews them with team-owned skills.

## Implementation status

This page describes the **conceptual review targets** River Review aims for. The current CLI support status is as follows.

- The CLI subcommands map to the three phases: upstream / midstream / downstream.
- `review plan` and `review exec --plan` are available. `review verify` is not yet implemented ([#802](https://github.com/s977043/river-review/issues/802); it currently returns exit code 3).
- Pre-execution requirements/design review and post-execution report review are achieved by passing artifact inputs (review-self / review-external / pbi-input / plan, etc.). There is, however, no dedicated "requirements review" or "report review" CLI mode.

The conceptual breakdown below remains valid; note that some targets do not map directly to a CLI command.

## Review targets

| Target       | Timing         | What River Review checks                                                             | Typical inputs                                  |
| ------------ | -------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Requirements | Pre-execution  | Whether goal, success criteria, scope, out-of-scope, and open questions are clear    | Issue, PBI, user request, acceptance criteria   |
| Design       | Pre-execution  | Whether it is consistent with existing design, has proper separation, not over-built | ADR, design memo, architecture direction        |
| Plan         | Pre-execution  | Whether work breakdown, blast radius, risks, and test policy are in place            | Plan, Work Packet, verification policy          |
| Diff         | Post-execution | Whether the implementation is consistent with requirements / design / plan           | PR diff, changed files, test diff               |
| Report       | Post-execution | Whether rationale, verification results, open items, and evidence remain             | Final report, review results, verification logs |

These five categories group the nine Artifact types listed in [Concept](./concept.en.md) into an introductory granularity. The mapping to the nine types lives on the concept page.

## Pre-execution review

The goal of pre-execution review is to reduce ambiguity and risk before an AI agent or developer starts work.

### Requirements Review

Requirements review checks whether what should be built is clear.

Key viewpoints:

- Whether there is a correspondence to the user request or Issue
- Whether the success criteria are concrete
- Whether scope and out-of-scope are stated explicitly
- Whether open questions are listed before implementation

### Design Review

Design review checks whether the implementation direction is consistent with the existing design.

Key viewpoints:

- Whether it conflicts with the existing architecture
- Whether responsibilities are properly separated
- Whether it is over-built
- Whether future extensibility and implementation cost are balanced

### Plan Review

Plan review checks whether the work is organized to the granularity needed to start implementation.

Key viewpoints:

- Whether the work is broken into Work Packets
- Whether the blast radius is stated explicitly
- Whether risks and constraints are listed
- Whether there is a test policy and verification commands
- Whether the conditions requiring human approval are stated explicitly

## Post-execution review

The goal of post-execution review is to check that what was built does not deviate from the plan or team standards.

### Diff Review

Diff review checks the PR diff and changed files.

Key viewpoints:

- Whether the implementation is consistent with requirements / design / plan
- Whether it contains unnecessary or oversized changes
- Whether it violates team standards such as security, accessibility, dependencies, or migration policy
- Whether the test diff matches the change

### Report Review

Report review checks the rationale and verification results at completion.

Key viewpoints:

- Whether it explains what was changed
- Whether it records which verification was performed
- Whether open items and known constraints are stated explicitly
- Whether information that can be traced later as evidence remains

## Relationship with PlanGate

River Review and PlanGate do not compete; they have different roles.

| Tool         | Role                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------- |
| River Review | Reviews requirements / design / plan / diff / report and points out issues, risks, and missing info |
| PlanGate     | Based on River Review results and plan info, decides go/no-go such as GO / NO-GO / NEEDS_REVISION   |

In other words, River Review **reviews**; PlanGate **blocks / passes**.

Even when PlanGate owns the pre-implementation gate, River Review can provide the requirements / design / plan review results upstream of it.

## Examples of when to use each

| What you want to do                                                    | Review to use       |
| ---------------------------------------------------------------------- | ------------------- |
| Check whether an Issue is at an implementable granularity              | Requirements Review |
| Check whether the design direction conflicts with the architecture     | Design Review       |
| Check whether a plan handed to an AI agent is sufficient               | Plan Review         |
| Check whether the PR diff deviates from the plan                       | Diff Review         |
| Check whether the completion report retains verification and rationale | Report Review       |

## Important premise

River Review is not meant to replace human judgment.

It is a review engine that makes the team's judgment criteria explicit as skills, reduces oversights, and lets humans focus on the more important judgments.
