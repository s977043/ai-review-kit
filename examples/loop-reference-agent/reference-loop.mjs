/**
 * Reference Loop Agent (Epic #1171 item2).
 *
 * A deterministic, API-free reference implementation of how a *caller* consumes
 * River Review's loop contract to drive a generate → review → revise loop.
 *
 * River Review only returns judgment material (`decision`, finding severities,
 * `oscillated`, `suggestedLoopSignal`). Iteration / stop / escalation is the
 * caller's responsibility (#976 boundary). This module encodes that caller-side
 * decision logic exactly as specified in
 * `pages/reference/loop-convergence-contract.md`, so it doubles as a contract
 * test fixture and an executable demo.
 *
 * All functions are pure / side-effect-free. The loop driver delegates the
 * actual "run River Review" step to an injected `review` callback, so tests feed
 * fixed artifacts and never touch a real LLM or the filesystem.
 */

import {
  deriveLoopSignalFromArtifact,
  deriveLoopSignalFromRunsDiff,
} from '../../src/lib/loop-signal.mjs';

/** Caller-side loop actions. */
export const LOOP_ACTIONS = Object.freeze({
  REVISE: 'revise',
  STOP_CONVERGED: 'stop-converged',
  STOP_ESCALATE: 'stop-escalate',
  STOP_MAX_ITERATIONS: 'stop-max-iterations',
  STOP_POLICY: 'stop-policy',
});

/**
 * Decide the next loop action for one review result. Pure.
 *
 * Precedence (highest first):
 * 1. caller policy (cost cap, HITL label, …) → STOP_POLICY  (Layer 3)
 * 2. STOP_OSCILLATED / ESCALATE_HUMAN        → STOP_ESCALATE (Layer 2/1)
 * 3. CONVERGED                                → STOP_CONVERGED
 * 4. would revise but hit the iteration cap   → STOP_MAX_ITERATIONS (Layer 3)
 * 5. otherwise (REVISE_REQUIRED / NO_SIGNAL)  → REVISE
 *
 * Note CONVERGED/ESCALATE take priority over the max-iterations guard: reaching
 * the cap on a converged/escalated result is not a "max iterations" stop.
 *
 * @param {object} params
 * @param {object} params.artifact - Latest Review Artifact (findings + decision).
 * @param {object|null} [params.runsDiff] - `runs diff` output when 3+ runs exist
 *   (enables STOP_OSCILLATED). Omit/null for single-run derivation.
 * @param {number} params.iteration - 1-based iteration counter.
 * @param {number} params.maxIterations - Divergence guard (recommended 3–5).
 * @param {string|null} [params.policySignal] - Caller-synthesized Layer 3 signal,
 *   e.g. 'STOP_POLICY_REQUIRED' when a cost cap or HITL label fires.
 * @returns {{signal: string, action: string, reason: string}}
 */
export function decideLoopAction({
  artifact,
  runsDiff = null,
  iteration,
  maxIterations,
  policySignal = null,
}) {
  // 1. Caller policy (Layer 3) — highest priority external override.
  if (policySignal === 'STOP_POLICY_REQUIRED') {
    return {
      signal: 'STOP_POLICY_REQUIRED',
      action: LOOP_ACTIONS.STOP_POLICY,
      reason: 'caller policy (cost cap / HITL label) requires stopping',
    };
  }

  // 2/3/5. River Review-derived signal (Layer 2 when a diff is supplied, else Layer 1).
  const signal = runsDiff
    ? deriveLoopSignalFromRunsDiff(runsDiff, artifact)
    : deriveLoopSignalFromArtifact(artifact);

  if (signal === 'STOP_OSCILLATED') {
    return {
      signal,
      action: LOOP_ACTIONS.STOP_ESCALATE,
      reason: 'oscillation detected — revise is re-introducing resolved findings',
    };
  }

  if (signal === 'ESCALATE_HUMAN') {
    return {
      signal,
      action: LOOP_ACTIONS.STOP_ESCALATE,
      reason: 'decision is human-review-required',
    };
  }

  if (signal === 'CONVERGED') {
    return {
      signal,
      action: LOOP_ACTIONS.STOP_CONVERGED,
      reason: 'no blocking findings and decision is auto-approve equivalent',
    };
  }

  // 4. We would revise (REVISE_REQUIRED or NO_SIGNAL) — apply the divergence guard.
  if (iteration >= maxIterations) {
    return {
      signal: 'STOP_MAX_ITERATIONS',
      action: LOOP_ACTIONS.STOP_MAX_ITERATIONS,
      reason: `reached max iterations (${maxIterations}) without converging`,
    };
  }

  return {
    signal,
    action: LOOP_ACTIONS.REVISE,
    reason: 'blocking findings remain — revise and re-run',
  };
}

/**
 * Drive the generate → review → revise loop until a stop action is reached.
 *
 * The `review` callback abstracts "run River Review for this iteration". In
 * production it would shell out to `river run` and parse the artifact; in tests
 * it returns a fixed artifact (and optional runsDiff) so the loop is fully
 * deterministic with no LLM / IO.
 *
 * @param {object} params
 * @param {(ctx: {iteration: number, history: object[]}) => ({artifact: object, runsDiff?: object|null})} params.review
 *   Returns the review result for the given iteration.
 * @param {number} [params.maxIterations=5] - Divergence guard.
 * @param {(ctx: {iteration: number, history: object[]}) => (string|null)} [params.policyFor]
 *   Returns 'STOP_POLICY_REQUIRED' to force a policy stop, else null.
 * @returns {{signal: string, action: string, reason: string, iteration: number, history: object[]}}
 */
export function runReferenceLoop({ review, maxIterations = 5, policyFor = () => null }) {
  const history = [];

  for (let iteration = 1; ; iteration++) {
    const { artifact, runsDiff = null } = review({ iteration, history });
    history.push(artifact);

    const decision = decideLoopAction({
      artifact,
      runsDiff,
      iteration,
      maxIterations,
      policySignal: policyFor({ iteration, history }),
    });

    if (decision.action !== LOOP_ACTIONS.REVISE) {
      return { ...decision, iteration, history };
    }
    // else: revise and continue to the next iteration.
  }
}
