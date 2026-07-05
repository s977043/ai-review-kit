# Loop Reference Agent

A deterministic, API-free reference for how a **caller** consumes River Review's
loop contract to drive a generate → review → revise loop.

River Review is the **review stage** only. It returns judgment material
(`decision`, finding severities, `oscillated`, `suggestedLoopSignal`, exit code).
Iteration, stopping, and escalation are the **caller's** responsibility
(the [#976 boundary](../../docs/ai/generate-review-revise-loop.md)). This example
encodes that caller-side logic exactly as the
[loop convergence contract](../../pages/reference/loop-convergence-contract.md)
specifies, so it works as both an executable demo and a contract test.

## Files

- `reference-loop.mjs` — pure decision logic (`decideLoopAction`) and a loop
  driver (`runReferenceLoop`). No LLM, filesystem, or network access.
- `../../tests/loop-reference-agent.test.mjs` — contract test asserting every
  terminal outcome.
- `../../tests/fixtures/loop-reference-agent/` — fixed Review Artifacts and a
  `runs diff` fixture.

## Decision precedence

`decideLoopAction` resolves one review result to one action, highest priority first:

| Priority | Condition                                        | Signal                 | Action                |
| -------- | ------------------------------------------------ | ---------------------- | --------------------- |
| 1        | Caller policy fires (cost cap, HITL label)       | `STOP_POLICY_REQUIRED` | `stop-policy`         |
| 2        | Oscillation (`runs diff` `oscillated` non-empty) | `STOP_OSCILLATED`      | `stop-escalate`       |
| 2        | `decision === 'human-review-required'`           | `ESCALATE_HUMAN`       | `stop-escalate`       |
| 3        | No blocking findings + auto-approve equivalent   | `CONVERGED`            | `stop-converged`      |
| 4        | Would revise but `iteration >= maxIterations`    | `STOP_MAX_ITERATIONS`  | `stop-max-iterations` |
| 5        | Blocking findings remain                         | `REVISE_REQUIRED`      | `revise`              |

`CONVERGED` / escalation take priority over the max-iterations guard: reaching
the cap on a converged or escalated result is not a "max iterations" stop.

## Gate consumption (Epic #1347 S4)

When the artifact carries a `gate` block (Epic #1347 S2), it is the
**authoritative** signal — it composes the risk tiers (cliff / hill / field)
with the loop signal. `decideLoopAction` maps it directly:

| `gate.decision`       | action                      | tier  |
| --------------------- | --------------------------- | ----- |
| `GO`                  | `stop-converged`            | field |
| `GO_WITH_OBSERVATION` | `continue-with-observation` | hill  |
| `NO_GO`               | `revise` (iteration-capped) | —     |
| `ESCALATE`            | `stop-escalate`             | cliff |

Two overrides still take priority over the gate block, because they express
information the gate does not carry: caller policy (`STOP_POLICY_REQUIRED`)
and Layer-2 oscillation (`STOP_OSCILLATED` from `runs diff`). A caller that
only read the gate would otherwise loop forever on an oscillating fix.

`continue-with-observation` **surfaces** the full observation contract on the
returned decision (`observationDeadline` hours + `observation.files` +
`observation.onExpiry`) so the caller can enforce it: on expiry, stop and
treat `observation.files` as unreviewed (re-review required). This reference
driver does not itself track wall-clock time — a revise loop terminates at
`continue-with-observation`, and expiry is a post-loop concern for the merged
change. External hosts verify their own enforcement against
`tests/fixtures/gate-conformance/`.

Older artifacts without a `gate` block fall back to the loop-signal path
below (backward compatible). The precedence, including the gate short-circuit,
is: caller policy → oscillation → **gate block** → loop signal.

Layers 1–2 (`CONVERGED` / `REVISE_REQUIRED` / `ESCALATE_HUMAN` / `STOP_OSCILLATED`)
are derived by River Review via `src/lib/loop-signal.mjs`. Layer 3
(`STOP_MAX_ITERATIONS` / `STOP_POLICY_REQUIRED`) is synthesized by the caller —
River Review deliberately never emits those.

## Usage sketch

`review` and `policyFor` may be sync or async — the driver awaits both, so real
callers can run `river run` subprocesses / LLM calls inside them.

```js
import { runReferenceLoop } from './reference-loop.mjs';

const result = await runReferenceLoop({
  // In production, `review` shells out to `river run ... --output json --save`
  // and returns the parsed artifact (+ `runs diff` once 3+ runs exist).
  review: async ({ iteration, history }) => ({
    artifact: await runRiverReview(iteration, history),
  }),
  maxIterations: 5,
  policyFor: ({ history }) => (costExceeded(history) ? 'STOP_POLICY_REQUIRED' : null),
});

// result.action ∈ stop-converged | stop-escalate | stop-max-iterations | stop-policy
```

## Run the contract test

```bash
node --test tests/loop-reference-agent.test.mjs
```
