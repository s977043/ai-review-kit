/**
 * Contract test for the Reference Loop Agent (Epic #1171 item2).
 *
 * Proves a caller consuming River Review's loop contract reaches every terminal
 * outcome deterministically from fixed artifacts / run-diff fixtures — no LLM,
 * no filesystem, no network. This is the executable counterpart to
 * pages/reference/loop-convergence-contract.md.
 *
 * Asserts: CONVERGED, REVISE (→ eventual stop), ESCALATE_HUMAN,
 * STOP_OSCILLATED, STOP_MAX_ITERATIONS, plus the caller-only STOP_POLICY.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  decideLoopAction,
  runReferenceLoop,
  LOOP_ACTIONS,
} from '../examples/loop-reference-agent/reference-loop.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixDir = join(here, 'fixtures', 'loop-reference-agent');
const load = (name) => JSON.parse(readFileSync(join(fixDir, name), 'utf8'));

const REVISE = load('artifact-revise.json');
const CONVERGED = load('artifact-converged.json');
const ESCALATE = load('artifact-escalate.json');
const OSCILLATED_DIFF = load('runs-diff-oscillated.json');

// ---------------------------------------------------------------------------
// decideLoopAction — single-step decisions
// ---------------------------------------------------------------------------

describe('decideLoopAction', () => {
  test('CONVERGED → stop-converged', () => {
    const d = decideLoopAction({ artifact: CONVERGED, iteration: 1, maxIterations: 5 });
    assert.equal(d.signal, 'CONVERGED');
    assert.equal(d.action, LOOP_ACTIONS.STOP_CONVERGED);
  });

  test('blocking findings → revise', () => {
    const d = decideLoopAction({ artifact: REVISE, iteration: 1, maxIterations: 5 });
    assert.equal(d.signal, 'REVISE_REQUIRED');
    assert.equal(d.action, LOOP_ACTIONS.REVISE);
  });

  test('human-review-required → stop-escalate', () => {
    const d = decideLoopAction({ artifact: ESCALATE, iteration: 1, maxIterations: 5 });
    assert.equal(d.signal, 'ESCALATE_HUMAN');
    assert.equal(d.action, LOOP_ACTIONS.STOP_ESCALATE);
  });

  test('oscillation diff → stop-escalate (STOP_OSCILLATED)', () => {
    const d = decideLoopAction({
      artifact: REVISE,
      runsDiff: OSCILLATED_DIFF,
      iteration: 3,
      maxIterations: 5,
    });
    assert.equal(d.signal, 'STOP_OSCILLATED');
    assert.equal(d.action, LOOP_ACTIONS.STOP_ESCALATE);
  });

  test('blocking findings at the iteration cap → stop-max-iterations', () => {
    const d = decideLoopAction({ artifact: REVISE, iteration: 5, maxIterations: 5 });
    assert.equal(d.signal, 'STOP_MAX_ITERATIONS');
    assert.equal(d.action, LOOP_ACTIONS.STOP_MAX_ITERATIONS);
  });

  test('caller policy overrides everything → stop-policy', () => {
    const d = decideLoopAction({
      artifact: REVISE,
      iteration: 1,
      maxIterations: 5,
      policySignal: 'STOP_POLICY_REQUIRED',
    });
    assert.equal(d.action, LOOP_ACTIONS.STOP_POLICY);
  });

  test('CONVERGED at the cap is converged, not max-iterations', () => {
    const d = decideLoopAction({ artifact: CONVERGED, iteration: 5, maxIterations: 5 });
    assert.equal(d.action, LOOP_ACTIONS.STOP_CONVERGED);
  });

  test('invalid maxIterations falls back to default (no premature/absent cap)', () => {
    // null would coerce to 0 (iteration >= 0 → premature stop); guard must prevent it.
    const early = decideLoopAction({ artifact: REVISE, iteration: 1, maxIterations: null });
    assert.equal(early.action, LOOP_ACTIONS.REVISE);
    // and the default cap (5) still trips when reached.
    const capped = decideLoopAction({ artifact: REVISE, iteration: 5, maxIterations: null });
    assert.equal(capped.action, LOOP_ACTIONS.STOP_MAX_ITERATIONS);
  });
});

// ---------------------------------------------------------------------------
// runReferenceLoop — full loop drive
// ---------------------------------------------------------------------------

describe('runReferenceLoop', () => {
  test('revises until convergence', async () => {
    // Two revise rounds, then converge.
    const sequence = [REVISE, REVISE, CONVERGED];
    const result = await runReferenceLoop({
      review: ({ iteration }) => ({ artifact: sequence[iteration - 1] }),
      maxIterations: 5,
    });
    assert.equal(result.action, LOOP_ACTIONS.STOP_CONVERGED);
    assert.equal(result.iteration, 3);
    assert.equal(result.history.length, 3);
  });

  test('stops at max iterations when never converging', async () => {
    const result = await runReferenceLoop({
      review: () => ({ artifact: REVISE }),
      maxIterations: 3,
    });
    assert.equal(result.action, LOOP_ACTIONS.STOP_MAX_ITERATIONS);
    assert.equal(result.iteration, 3);
  });

  test('escalates immediately on human-review-required', async () => {
    const result = await runReferenceLoop({
      review: () => ({ artifact: ESCALATE }),
      maxIterations: 5,
    });
    assert.equal(result.action, LOOP_ACTIONS.STOP_ESCALATE);
    assert.equal(result.iteration, 1);
  });

  test('escalates on oscillation surfaced from runs diff', async () => {
    // First two rounds revise; third round surfaces oscillation via runsDiff.
    const result = await runReferenceLoop({
      review: ({ iteration }) =>
        iteration >= 3 ? { artifact: REVISE, runsDiff: OSCILLATED_DIFF } : { artifact: REVISE },
      maxIterations: 10,
    });
    assert.equal(result.signal, 'STOP_OSCILLATED');
    assert.equal(result.action, LOOP_ACTIONS.STOP_ESCALATE);
    assert.equal(result.iteration, 3);
  });

  test('caller policy stops the loop mid-flight', async () => {
    const result = await runReferenceLoop({
      review: () => ({ artifact: REVISE }),
      maxIterations: 5,
      policyFor: ({ iteration }) => (iteration === 2 ? 'STOP_POLICY_REQUIRED' : null),
    });
    assert.equal(result.action, LOOP_ACTIONS.STOP_POLICY);
    assert.equal(result.iteration, 2);
  });

  test('awaits async review and policyFor callbacks', async () => {
    const result = await runReferenceLoop({
      review: async ({ iteration }) => ({ artifact: iteration >= 2 ? CONVERGED : REVISE }),
      maxIterations: 5,
      policyFor: async () => null,
    });
    assert.equal(result.action, LOOP_ACTIONS.STOP_CONVERGED);
    assert.equal(result.iteration, 2);
  });
});
