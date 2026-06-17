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
