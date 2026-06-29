# Cost Control Mode Design (#921)

Design-only note. **No workflow YAML ships from this doc.** Per Codex judgment,
the 3-mode branching cannot be designed correctly without real adopter
observation—building a full workflow now would bake in speculative
assumptions. This doc fixes the contract, the observability needed to validate
it, a skeleton, and the explicit conditions under which implementation starts.

## Status

- Parent: #911 (Independent Review Synthesis epic, closed). Slice C carved out.
- This issue (#921) is **parked**. Reopen conditions are in the issue body.
- This doc reduces the future implementation cost; it does not lift the park.

## Why CLI stays out of it

The synthesis CLI (`river review exec --ensemble`, #917) is stateless: it runs
whatever inputs it is given. PR state (draft / ready / base branch) is a
**workflow** concern. Pushing PR-state awareness into the CLI would couple the
tool to GitHub's PR model and break provider-agnosticism. Cost control belongs
in the GitHub Action layer that already knows the event context.

## The 3-mode branching contract

| PR state                   | Mode                | Intended behavior                                                                         | Cost posture   |
| -------------------------- | ------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| draft                      | `skip` or `dry-run` | Run synthesis skill selection + plan only, OR skip entirely. No LLM call.                 | Zero / minimal |
| ready-for-review           | `high-risk-only`    | Run synthesis only on files matching `risk-map.yaml` escalate/require_human_review rules. | Bounded        |
| base == main (merge-bound) | `full`              | Full synthesis across all changed files. Current default.                                 | Full           |

### Decision inputs

- `github.event.pull_request.draft` (boolean)—captured at workflow start (see failure scenario 1).
- `github.event.pull_request.base.ref`—`main` → merge-bound.
- `.river/risk-map.yaml` presence—required for `high-risk-only`; absent → fall back to `full` with a loud warning (not silent skip).

### Mode resolution (pseudocode, NOT shipped)

```text
if pr.draft:            mode = DRAFT_MODE      # default: dry-run
elif pr.base == main:   mode = full
else:                   mode = high-risk-only  # ready, non-main base
```

`DRAFT_MODE` is a workflow input (`dry-run` | `skip`) so teams choose whether
draft PRs get a zero-cost plan preview or nothing.

## Observability needed to VALIDATE this design

The design is speculative until these signals exist. **Implementing telemetry
is the actual first deliverable of #921**, before any mode-branching workflow:

1. **Per-run token / cost estimate** emitted by the synthesis path (the engine
   already has cost estimation; surface it in `debug.execution`).
2. **PR-state tag** on each run (draft / ready / main-bound) so cost can be
   bucketed by state.
3. **Comment-engagement signal** (optional, harder): did a human read/react to
   the synthesis comment? Distinguishes "useful full run" from "wasted draft run".

Without (1) and (2), there is no way to confirm that `high-risk-only` on ready
PRs actually saves meaningful cost, or that draft full-runs are actually wasted.

## Workflow skeleton (illustrative, commented—do NOT activate)

```yaml
# .github/workflows/synthesis-cost-control.yml  (NOT YET SHIPPED — see #921)
# on:
#   pull_request:
#     types: [opened, synchronize, ready_for_review]
# jobs:
#   resolve-mode:
#     # outputs: mode = dry-run | high-risk-only | full
#     # reads: pull_request.draft, pull_request.base.ref, .river/risk-map.yaml
#   synthesize:
#     needs: resolve-mode
#     if: needs.resolve-mode.outputs.mode != 'skip'
#     # invokes: river review exec --ensemble ./.river/reviews [--high-risk-only]
#     # NOTE: --high-risk-only flag does NOT exist; it is part of the
#     #       implementation slice, gated on observation (see hold conditions).
```

## Implementation hold conditions (when to actually build)

Build the telemetry slice (observability 1+2) when:

- A maintainer wants cost data to make the draft/ready/main call with evidence.

Build the mode-branching workflow when **all** of:

- Telemetry from the slice above shows a measurable cost delta between modes
  (e.g. ready PRs spending >X on files a risk-map would have excluded).
- A `--high-risk-only` (or equivalent) CLI/selection mechanism exists, scoped
  in its own issue.
- At least one adopter confirms the draft/ready/main mapping matches their
  workflow (avoids designing for a hypothetical team).

## Failure scenarios (Codify-then-validate, for the future impl)

1. **`pull_request.draft` flips mid-run**: read it once at `resolve-mode` job
   start; downstream jobs use the resolved output, not a fresh API read.
2. **`risk-map.yaml` absent in `high-risk-only` mode**: fall back to `full` with
   a `::warning::`, never silently skip the review.
3. **Mode misconfiguration hides a real finding**: `full` is the safe default;
   any ambiguity resolves toward more review, not less. `skip` is opt-in only.

## Out of scope

- `--high-risk-only` CLI flag (separate issue when telemetry justifies it).
- Per-token / per-reviewer budget quotas (different epic).
- Auto-running synthesis on every PR (this doc is about _gating_ it, not
  enabling it by default).

## References

- Parent epic: #911 (closed)
- This tracker: #921
- CLI input mechanism already shipped: #917 (`--ensemble`)
- Synthesis skill: `skills/midstream/community/independent-review-synthesis/`
- Retrospective on stop-condition discipline: `docs/development/retrospectives/2026-05-21-25.md`
