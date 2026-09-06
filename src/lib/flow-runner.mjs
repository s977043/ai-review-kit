// Flow runner skeleton (Epic #2011 AC7, P1 of 5).
//
// Walks the `steps[]` of one Flow document in index order and records, for
// every step, what a conforming runtime WOULD do with it. P1 is the skeleton:
// it decides the order, the `when` gating and the stop / skip / degrade
// bookkeeping, and it dispatches to a capability only when the caller has
// injected one. Nothing here reviews, selects, verifies or gates.
//
// Boundaries (ADR-009 D3, RA-1..RA-4):
//   - this module never reads the Flow assets from disk. The document arrives
//     already loaded and validated as `resolveFlowEntry().document`
//     (src/lib/flow-loader.mjs); the observe-mode scan in
//     tests/flow-definitions.test.mjs keeps flow-loader the ONLY reader;
//   - this module holds no judgment vocabulary. No severity, no gate, no
//     threshold, no decision. `derive-gate` and `human-escalation` are
//     reserved primitives that P1 records as `not-implemented` even when a
//     capability is injected under their name, so a Flow cannot reach a gate
//     or a human through this module yet. Human authority is unchanged
//     (`canApproveMerge: false` in agents/contracts/*.agent.json, pinned by
//     tests/flow-runner.test.mjs);
//   - the only reason code it emits is imported from the existing gate
//     vocabulary (`GATE_REASON_CODES`, src/lib/gate-decision.mjs). There is no
//     second reason-code system.
//
// Contract:
//   executeFlow({ document, capabilities = {}, inputs = {} })
//     -> { steps: StepOutcome[], stopped: boolean, stopReason?: GateReasonCode,
//          missingInputs: string[] }
//
//   StepOutcome = { index, id, kind: 'primitive' | 'reviewer', parallel,
//                   parallelRun: number | null, outcome, reason?, result? }
//   outcome is one of STEP_OUTCOMES (closed set):
//     executed         an injected capability ran for this step
//     skipped          `when` unsatisfied and `onUnsatisfied: "skip"`
//     degraded         `when` unsatisfied and `onUnsatisfied: "degrade"`
//     stopped          `when` unsatisfied and `onUnsatisfied` absent / "stop"
//     not-implemented  no capability injected for the step (or a reserved
//                      primitive); recorded and the walk continues
//
//   A required input (`document.inputs[].required === true`) missing from
//   `inputs` stops the Flow BEFORE the first step: `steps` is empty and
//   `stopReason` is `DETERMINISTIC_UNRUNNABLE`.
//
//   Capabilities are addressed by the primitive name for `use` steps and by
//   the key `reviewer` for `reviewer` steps. A capability is a function
//   `(context) => unknown | Promise<unknown>` receiving
//   `{ step, index, inputs, document }`; its return value is stored verbatim
//   as `result`. Errors are not caught in P1 — a failing capability is loud.
//
//   Steps marked `parallel: true` form contiguous runs (schema `steps`
//   description). P1 does not run them concurrently; it walks them in index
//   order and tags each member with its `parallelRun` ordinal, so the outcome
//   array is always in `steps` order and two calls with the same input are
//   deepEqual.

import { GATE_REASON_CODES } from './gate-decision.mjs';
import { requiredInputNames } from './flow-loader.mjs';
import { nonEmptyNfcString } from './promotion-candidates.mjs';

/** Closed outcome vocabulary of one step record. */
export const STEP_OUTCOMES = Object.freeze([
  'executed',
  'skipped',
  'degraded',
  'stopped',
  'not-implemented',
]);

/** Schema `onUnsatisfied` value -> step outcome. Absent key means `stop`. */
export const ON_UNSATISFIED_OUTCOMES = Object.freeze({
  stop: 'stopped',
  skip: 'skipped',
  degrade: 'degraded',
});

/** Capability key under which every `reviewer:` step is dispatched. */
export const REVIEWER_CAPABILITY_KEY = 'reviewer';

/**
 * Primitives P1 never dispatches, whatever the caller injects. Both are the
 * points where a Flow would touch judgment (a gate) or a human; wiring them is
 * a later phase with its own review, not a capability key.
 */
export const RESERVED_PRIMITIVES = Object.freeze(['derive-gate', 'human-escalation']);

/**
 * Pick one reason code out of the gate vocabulary. Throws at module load if
 * the name is not in `GATE_REASON_CODES`, so this module can never carry a
 * reason the gate does not know.
 */
function gateReasonCode(name) {
  if (!GATE_REASON_CODES.includes(name)) {
    throw new Error(`flow-runner: "${name}" is not a GATE_REASON_CODES value`);
  }
  return name;
}

/** Stop reason for a missing required input or a `when` that must stop. */
export const STOP_REASON_MISSING_INPUT = gateReasonCode('DETERMINISTIC_UNRUNNABLE');

export class FlowRunnerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'FlowRunnerError';
  }
}

const isPlainObject = (value) =>
  value != null && typeof value === 'object' && !Array.isArray(value);

/** An input counts as present when the key exists and the value is not nullish. */
function isInputPresent(inputs, name) {
  return Object.hasOwn(inputs, name) && inputs[name] != null;
}

/** `{ id, kind }` of a step, from its single `use` / `reviewer` key. */
function describeStep(step, index) {
  if (!isPlainObject(step)) {
    throw new FlowRunnerError(`step[${index}] is not an object.`);
  }
  const use = nonEmptyNfcString(step.use);
  const reviewer = nonEmptyNfcString(step.reviewer);
  if (use != null && reviewer == null) return { id: use, kind: 'primitive' };
  if (reviewer != null && use == null) return { id: reviewer, kind: 'reviewer' };
  throw new FlowRunnerError(`step[${index}] must carry exactly one of "use" or "reviewer".`);
}

/**
 * Evaluate a step's `when` clause against the inputs. Returns `null` when the
 * step has no clause or the clause holds, else the reason it does not.
 */
function unsatisfiedWhen(step, inputs, index) {
  const when = step.when;
  if (when == null) return null;
  const name = nonEmptyNfcString(when?.input);
  const state = when?.state;
  if (name == null || (state !== 'present' && state !== 'absent')) {
    throw new FlowRunnerError(`step[${index}] has an invalid "when" clause.`);
  }
  const present = isInputPresent(inputs, name);
  if ((state === 'present') === present) return null;
  return `when: input "${name}" is ${present ? 'present' : 'absent'}, required ${state}`;
}

/** Outcome for an unsatisfied step, from `onUnsatisfied` (absent -> stop). */
function unsatisfiedOutcome(step, index) {
  const key = step.onUnsatisfied ?? 'stop';
  const outcome = ON_UNSATISFIED_OUTCOMES[key];
  if (outcome == null) {
    throw new FlowRunnerError(`step[${index}] has an unknown onUnsatisfied "${key}".`);
  }
  return outcome;
}

/**
 * Execute (P1: walk) one Flow document.
 *
 * @param {object} params
 * @param {object} params.document  `resolveFlowEntry().document`
 * @param {Record<string, Function>} [params.capabilities]
 * @param {Record<string, unknown>} [params.inputs]
 * @returns {Promise<{ steps: object[], stopped: boolean, stopReason?: string, missingInputs: string[] }>}
 */
export async function executeFlow({ document, capabilities = {}, inputs = {} } = {}) {
  if (!isPlainObject(document) || !Array.isArray(document.steps)) {
    throw new FlowRunnerError('executeFlow: "document" must be a Flow document with steps[].');
  }
  if (!isPlainObject(capabilities)) {
    throw new FlowRunnerError('executeFlow: "capabilities" must be an object.');
  }
  if (!isPlainObject(inputs)) {
    throw new FlowRunnerError('executeFlow: "inputs" must be an object.');
  }

  const missingInputs = requiredInputNames(document).filter(
    (name) => !isInputPresent(inputs, name)
  );
  if (missingInputs.length > 0) {
    return { steps: [], stopped: true, stopReason: STOP_REASON_MISSING_INPUT, missingInputs };
  }

  const steps = [];
  let parallelRun = -1;
  let previousParallel = false;

  for (let index = 0; index < document.steps.length; index += 1) {
    const step = document.steps[index];
    const { id, kind } = describeStep(step, index);
    const parallel = step.parallel === true;
    if (parallel && !previousParallel) parallelRun += 1;
    previousParallel = parallel;
    const record = {
      index,
      id,
      kind,
      parallel,
      parallelRun: parallel ? parallelRun : null,
    };

    const whenReason = unsatisfiedWhen(step, inputs, index);
    if (whenReason != null) {
      const outcome = unsatisfiedOutcome(step, index);
      steps.push({ ...record, outcome, reason: whenReason });
      if (outcome === 'stopped') {
        return { steps, stopped: true, stopReason: STOP_REASON_MISSING_INPUT, missingInputs };
      }
      continue;
    }

    if (kind === 'primitive' && RESERVED_PRIMITIVES.includes(id)) {
      steps.push({ ...record, outcome: 'not-implemented', reason: `reserved primitive "${id}"` });
      continue;
    }

    const capabilityKey = kind === 'reviewer' ? REVIEWER_CAPABILITY_KEY : id;
    const capability = capabilities[capabilityKey];
    if (typeof capability !== 'function') {
      steps.push({
        ...record,
        outcome: 'not-implemented',
        reason: `no capability "${capabilityKey}"`,
      });
      continue;
    }

    const result = await capability({ step, index, inputs, document });
    steps.push({ ...record, outcome: 'executed', result });
  }

  return { steps, stopped: false, missingInputs };
}
