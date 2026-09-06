// Contract tests for src/lib/flow-runner.mjs (Epic #2011 AC7, P1 of 5).
//
// The runner never reads `flows/` itself (tests/flow-definitions.test.mjs
// keeps src/lib/flow-loader.mjs the only reader); this test reads the shipped
// Flow documents and hands them in as `resolveFlowEntry().document` would.
//
// Pinned here:
//   - every shipped Flow yields one record per step, in index order, with an
//     outcome from the closed STEP_OUTCOMES set;
//   - the three unsatisfied events (when / missing capability / throwing
//     capability) follow `onUnsatisfied` per the transition table in the
//     module header, with observe mode recording `not-implemented` for a
//     missing capability instead of stopping;
//   - stop reasons are GATE_REASON_CODES values, not hand-written strings;
//   - reserved primitives stay `not-implemented` whatever is injected, and
//     `judgment` is accepted but not yet wired;
//   - parallel runs keep index order even with out-of-order async delays;
//   - Human authority is unchanged: no agent contract can approve a merge.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

import {
  executeFlow,
  FLOW_RUN_MODES,
  FlowRunnerError,
  ON_UNSATISFIED_OUTCOMES,
  RESERVED_PRIMITIVES,
  REVIEWER_CAPABILITY_KEY,
  STEP_OUTCOMES,
  STOP_REASON_MISSING_INPUT,
  STOP_REASON_NOT_EXECUTED,
} from '../src/lib/flow-runner.mjs';
import { GATE_REASON_CODES } from '../src/lib/gate-decision.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const FLOWS_DIR = resolve(REPO_ROOT, 'flows');
const CONTRACTS_DIR = resolve(REPO_ROOT, 'agents', 'contracts');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const flows = readdirSync(FLOWS_DIR)
  .filter((name) => name.endsWith('.flow.json'))
  .sort()
  .map((name) => ({ name, document: readJson(join(FLOWS_DIR, name)) }));

const contracts = readdirSync(CONTRACTS_DIR)
  .filter((name) => name.endsWith('.agent.json'))
  .sort()
  .map((name) => ({ name, contract: readJson(join(CONTRACTS_DIR, name)) }));

/** Every declared input present, so no `when` clause blocks the walk. */
const allInputsOf = (document) =>
  Object.fromEntries((document.inputs ?? []).map((input) => [input.name, `<${input.name}>`]));

const stepIdOf = (step) => step.use ?? step.reviewer;
const outcomesOf = (result) => result.steps.map((record) => record.outcome);

describe('flow-runner: shipped Flow documents', () => {
  test('the shipped Flow documents were found', () => {
    assert.ok(flows.length > 0, 'no *.flow.json under flows/');
  });

  for (const { name, document } of flows) {
    test(`${name}: one record per step, in index order, outcomes in the closed set`, async () => {
      const result = await executeFlow({ document, inputs: allInputsOf(document) });
      assert.equal(result.stopped, false);
      assert.equal(result.stopReason, undefined);
      assert.equal(result.mode, 'observe');
      assert.deepEqual(result.missingInputs, []);
      assert.equal(result.steps.length, document.steps.length);
      assert.deepEqual(
        result.steps.map((record) => record.index),
        document.steps.map((_, index) => index)
      );
      assert.deepEqual(
        result.steps.map((record) => record.id),
        document.steps.map(stepIdOf)
      );
      for (const record of result.steps) {
        assert.ok(
          STEP_OUTCOMES.includes(record.outcome),
          `${name}[${record.index}] ${record.outcome}`
        );
        assert.ok(['primitive', 'reviewer'].includes(record.kind));
      }
    });

    test(`${name}: with nothing injected every step is not-implemented (observe)`, async () => {
      const result = await executeFlow({ document, inputs: allInputsOf(document) });
      assert.deepEqual([...new Set(outcomesOf(result))], ['not-implemented']);
    });

    test(`${name}: execute mode with nothing injected stops at the first non-reserved step`, async () => {
      const result = await executeFlow({
        document,
        inputs: allInputsOf(document),
        mode: 'execute',
      });
      const firstDispatchable = document.steps.findIndex(
        (step) => !(step.use && RESERVED_PRIMITIVES.includes(step.use))
      );
      // Every shipped Flow's first step is dispatchable and carries no
      // onUnsatisfied, so the safe default (stop) ends the walk there.
      assert.equal(firstDispatchable, 0, name);
      assert.equal(result.stopped, true, name);
      assert.equal(result.stopReason, STOP_REASON_NOT_EXECUTED, name);
      assert.equal(result.steps.length, 1, name);
      assert.equal(result.steps[0].outcome, 'stopped', name);
    });

    test(`${name}: parallel runs are contiguous and the walk is deterministic`, async () => {
      const inputs = allInputsOf(document);
      const first = await executeFlow({ document, inputs });
      const second = await executeFlow({ document, inputs });
      assert.deepEqual(first, second);
      let previousRun = null;
      for (const record of first.steps) {
        if (!record.parallel) {
          assert.equal(record.parallelRun, null);
          previousRun = null;
          continue;
        }
        assert.equal(typeof record.parallelRun, 'number');
        assert.ok(previousRun == null || record.parallelRun === previousRun);
        previousRun = record.parallelRun;
      }
    });
  }
});

describe('flow-runner: required inputs', () => {
  test('a missing required input stops before the first step', async () => {
    const withRequired = flows.filter(({ document }) =>
      (document.inputs ?? []).some((input) => input.required === true)
    );
    assert.ok(withRequired.length > 0, 'at least one Flow declares a required input');
    for (const { name, document } of withRequired) {
      for (const mode of FLOW_RUN_MODES) {
        const result = await executeFlow({ document, inputs: {}, mode });
        assert.equal(result.stopped, true, `${name} ${mode}`);
        assert.equal(result.stopReason, 'DETERMINISTIC_UNRUNNABLE', `${name} ${mode}`);
        assert.ok(result.missingInputs.length > 0, `${name} ${mode}`);
        if (mode === 'execute') {
          assert.deepEqual(result.steps, [], `${name} ${mode}`);
          continue;
        }
        // Observe mode never leaves steps empty: every step is listed, stopped.
        assert.equal(result.steps.length, document.steps.length, `${name} ${mode}`);
        assert.deepEqual(
          result.steps.map((record) => record.id),
          document.steps.map(stepIdOf),
          `${name} ${mode}`
        );
        assert.deepEqual([...new Set(outcomesOf(result))], ['stopped'], `${name} ${mode}`);
        for (const record of result.steps) {
          assert.match(record.reason, /required input missing: /, `${name} ${mode}`);
          for (const missing of result.missingInputs) assert.ok(record.reason.includes(missing));
        }
      }
    }
  });

  test('every stop reason the runner can emit is a GATE_REASON_CODES value', async () => {
    assert.ok(GATE_REASON_CODES.includes(STOP_REASON_MISSING_INPUT));
    assert.ok(GATE_REASON_CODES.includes(STOP_REASON_NOT_EXECUTED));
    const document = {
      id: 'x',
      inputs: [{ name: 'diff', required: true }],
      steps: [{ use: 'resolve-intent' }],
    };
    const missing = await executeFlow({ document, inputs: {} });
    assert.ok(GATE_REASON_CODES.includes(missing.stopReason), `"${missing.stopReason}"`);
    const unavailable = await executeFlow({ document, inputs: { diff: 'd' }, mode: 'execute' });
    assert.ok(GATE_REASON_CODES.includes(unavailable.stopReason), `"${unavailable.stopReason}"`);
    assert.notEqual(missing.stopReason, unavailable.stopReason);
  });

  test('a null input value counts as absent', async () => {
    const document = {
      id: 'x',
      inputs: [{ name: 'diff', required: true }],
      steps: [{ use: 'resolve-intent' }],
    };
    const result = await executeFlow({ document, inputs: { diff: null } });
    assert.equal(result.stopped, true);
    assert.deepEqual(result.missingInputs, ['diff']);
    assert.deepEqual(outcomesOf(result), ['stopped']);
    const execute = await executeFlow({ document, inputs: { diff: null }, mode: 'execute' });
    assert.deepEqual(execute.steps, []);
  });

  test('input names are compared after NFC normalisation', async () => {
    const nfd = 'étude';
    const nfc = nfd.normalize('NFC');
    assert.notEqual(nfd, nfc);
    const document = {
      id: 'x',
      inputs: [{ name: nfd, required: true }],
      steps: [{ use: 'resolve-intent' }],
    };
    const result = await executeFlow({ document, inputs: { [nfc]: 'x' } });
    assert.equal(result.stopped, false);
    assert.deepEqual(result.missingInputs, []);
  });
});

describe('flow-runner: when / onUnsatisfied', () => {
  const document = {
    id: 'x',
    inputs: [{ name: 'plan' }, { name: 'diff' }],
    steps: [
      { use: 'resolve-intent' },
      {
        use: 'cross-artifact-review',
        when: { input: 'plan', state: 'present' },
        onUnsatisfied: 'skip',
      },
      {
        use: 'cross-artifact-review',
        when: { input: 'diff', state: 'present' },
        onUnsatisfied: 'degrade',
      },
      { use: 'verify-findings' },
    ],
  };

  test('onUnsatisfied maps exactly onto the three schema values', () => {
    assert.deepEqual(Object.keys(ON_UNSATISFIED_OUTCOMES).sort(), ['degrade', 'skip', 'stop']);
    for (const outcome of Object.values(ON_UNSATISFIED_OUTCOMES)) {
      assert.ok(STEP_OUTCOMES.includes(outcome));
    }
    assert.deepEqual([...FLOW_RUN_MODES], ['observe', 'execute']);
  });

  test('unsatisfied when -> skipped; degrade without a capability -> not-implemented (observe)', async () => {
    const result = await executeFlow({ document, inputs: {} });
    assert.equal(result.stopped, false);
    assert.deepEqual(outcomesOf(result), [
      'not-implemented',
      'skipped',
      'not-implemented',
      'not-implemented',
    ]);
    assert.match(result.steps[1].reason, /input "plan" is absent/);
  });

  test('degrade with a capability dispatches it with degraded: true and a reason', async () => {
    const contexts = [];
    const result = await executeFlow({
      document,
      inputs: {},
      capabilities: { 'cross-artifact-review': (context) => contexts.push(context) },
    });
    assert.deepEqual(outcomesOf(result), [
      'not-implemented',
      'skipped',
      'degraded',
      'not-implemented',
    ]);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].degraded, true);
    assert.match(contexts[0].reason, /input "diff" is absent/);
    assert.match(result.steps[2].reason, /input "diff" is absent/);
  });

  test('a satisfied when dispatches with degraded: false', async () => {
    const contexts = [];
    const result = await executeFlow({
      document,
      inputs: { plan: 'p', diff: 'd' },
      capabilities: { 'cross-artifact-review': (context) => contexts.push(context) },
    });
    assert.deepEqual(outcomesOf(result), [
      'not-implemented',
      'executed',
      'executed',
      'not-implemented',
    ]);
    assert.deepEqual(
      contexts.map((context) => [context.degraded, context.reason]),
      [
        [false, null],
        [false, null],
      ]
    );
  });

  test('state: absent is honoured', async () => {
    const doc = {
      id: 'x',
      inputs: [{ name: 'plan' }],
      steps: [
        { use: 'resolve-intent', when: { input: 'plan', state: 'absent' }, onUnsatisfied: 'skip' },
      ],
    };
    const present = await executeFlow({ document: doc, inputs: { plan: 'p' } });
    assert.equal(present.steps[0].outcome, 'skipped');
    const absent = await executeFlow({ document: doc, inputs: {} });
    assert.equal(absent.steps[0].outcome, 'not-implemented');
  });

  test('onUnsatisfied absent means stop: the walk ends there with the input reason', async () => {
    const doc = {
      id: 'x',
      inputs: [{ name: 'plan' }],
      steps: [
        { use: 'resolve-intent' },
        { use: 'cross-artifact-review', when: { input: 'plan', state: 'present' } },
        { use: 'verify-findings' },
      ],
    };
    for (const mode of FLOW_RUN_MODES) {
      const result = await executeFlow({
        document: doc,
        inputs: {},
        mode,
        capabilities: { 'resolve-intent': () => 'ok' },
      });
      assert.equal(result.stopped, true, mode);
      assert.equal(result.stopReason, STOP_REASON_MISSING_INPUT, mode);
      assert.deepEqual(outcomesOf(result), ['executed', 'stopped'], mode);
    }
  });

  test('a when naming an undeclared input is a Flow author error', async () => {
    const doc = {
      id: 'x',
      inputs: [{ name: 'plan' }],
      steps: [{ use: 'resolve-intent', when: { input: 'diff', state: 'present' } }],
    };
    await assert.rejects(executeFlow({ document: doc, inputs: { diff: 'd' } }), FlowRunnerError);
  });
});

describe('flow-runner: capabilities', () => {
  test('an injected primitive capability is executed with the step context', async () => {
    const calls = [];
    const document = { id: 'x', steps: [{ use: 'resolve-intent' }, { use: 'select-skills' }] };
    const result = await executeFlow({
      document,
      inputs: { diff: 'd' },
      capabilities: {
        'resolve-intent': (context) => {
          calls.push(context);
          return { ok: true };
        },
      },
    });
    assert.deepEqual(outcomesOf(result), ['executed', 'not-implemented']);
    assert.deepEqual(result.steps[0].result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].index, 0);
    assert.equal(calls[0].step, document.steps[0]);
    assert.deepEqual(calls[0].inputs, { diff: 'd' });
  });

  test('reviewer steps dispatch through the single "reviewer" capability key', async () => {
    const seen = [];
    const document = {
      id: 'x',
      steps: [
        { reviewer: 'security-scanner', parallel: true },
        { reviewer: 'dependency-reviewer', parallel: true },
      ],
    };
    const result = await executeFlow({
      document,
      capabilities: { [REVIEWER_CAPABILITY_KEY]: ({ step }) => seen.push(step.reviewer) },
    });
    assert.deepEqual(seen, ['security-scanner', 'dependency-reviewer']);
    assert.deepEqual(
      result.steps.map((record) => [record.kind, record.outcome, record.parallelRun]),
      [
        ['reviewer', 'executed', 0],
        ['reviewer', 'executed', 0],
      ]
    );
  });

  test('async capabilities with out-of-order delays still record in Flow order', async () => {
    const started = [];
    const finished = [];
    const document = {
      id: 'x',
      steps: [
        { use: 'select-skills', parallel: true },
        { use: 'select-agents', parallel: true },
        { use: 'verify-findings' },
      ],
    };
    const delayed = (ms) => async (context) => {
      started.push(context.step.use);
      await sleep(ms);
      finished.push(context.step.use);
      return ms;
    };
    const result = await executeFlow({
      document,
      capabilities: {
        'select-skills': delayed(20),
        'select-agents': delayed(1),
        'verify-findings': delayed(5),
      },
    });
    assert.deepEqual(
      result.steps.map((record) => record.id),
      ['select-skills', 'select-agents', 'verify-findings']
    );
    assert.deepEqual(
      result.steps.map((record) => record.result),
      [20, 1, 5]
    );
    // P1 awaits each capability before dispatching the next, so completion
    // order equals Flow order too; a Promise.all rewrite would break this.
    assert.deepEqual(finished, ['select-skills', 'select-agents', 'verify-findings']);
    assert.deepEqual(started, finished);
  });

  test('capability keys are own properties only (no prototype lookup)', async () => {
    const document = { id: 'x', steps: [{ use: 'constructor' }, { use: 'toString' }] };
    const result = await executeFlow({ document, capabilities: {} });
    assert.deepEqual(outcomesOf(result), ['not-implemented', 'not-implemented']);
  });

  test('capability keys are compared after NFC normalisation', async () => {
    const nfd = 'étude';
    const document = { id: 'x', steps: [{ use: nfd }] };
    const result = await executeFlow({
      document,
      capabilities: { [nfd.normalize('NFC')]: () => 'ok' },
    });
    assert.deepEqual(outcomesOf(result), ['executed']);
  });

  test('reserved primitives stay not-implemented even when a capability is injected', async () => {
    assert.deepEqual([...RESERVED_PRIMITIVES].sort(), ['derive-gate', 'human-escalation']);
    let called = 0;
    const document = { id: 'x', steps: RESERVED_PRIMITIVES.map((use) => ({ use })) };
    const capabilities = Object.fromEntries(
      RESERVED_PRIMITIVES.map((use) => [use, () => (called += 1)])
    );
    for (const mode of FLOW_RUN_MODES) {
      const result = await executeFlow({ document, capabilities, mode });
      assert.deepEqual(outcomesOf(result), ['not-implemented', 'not-implemented'], mode);
      assert.equal(result.stopped, false, mode);
      for (const record of result.steps) assert.match(record.reason, /reserved primitive/);
    }
    assert.equal(called, 0);
  });

  test('judgment is accepted but not wired in P1: derive-gate stays not-implemented', async () => {
    let called = 0;
    const document = { id: 'x', steps: [{ use: 'derive-gate' }] };
    const result = await executeFlow({
      document,
      mode: 'execute',
      judgment: { deriveGate: () => (called += 1) },
    });
    assert.equal(called, 0);
    assert.deepEqual(outcomesOf(result), ['not-implemented']);
    await assert.rejects(executeFlow({ document, judgment: 'x' }), FlowRunnerError);
  });

  test('Human authority is unchanged: every agent contract declares canApproveMerge: false', () => {
    assert.ok(contracts.length > 0, 'no *.agent.json under agents/contracts/');
    for (const { name, contract } of contracts) {
      assert.equal(typeof contract.authority, 'object', `${name} has an authority block`);
      assert.equal(contract.authority.canApproveMerge, false, `${name} canApproveMerge`);
    }
  });
});

describe('flow-runner: execute mode (onUnsatisfied for missing / failing capabilities)', () => {
  const doc = (onUnsatisfied) => ({
    id: 'x',
    steps: [
      { use: 'resolve-intent', ...(onUnsatisfied ? { onUnsatisfied } : {}) },
      { use: 'verify-findings' },
    ],
  });
  const boom = () => {
    throw new Error('boom');
  };
  const ok = () => 'ok';

  test('missing capability: stop (default) ends the walk with NOT_EXECUTED', async () => {
    const result = await executeFlow({ document: doc(), mode: 'execute' });
    assert.equal(result.stopped, true);
    assert.equal(result.stopReason, STOP_REASON_NOT_EXECUTED);
    assert.deepEqual(outcomesOf(result), ['stopped']);
    assert.match(result.steps[0].reason, /capability unavailable/);
  });

  test('missing capability: skip / degrade continue', async () => {
    const skipped = await executeFlow({
      document: doc('skip'),
      mode: 'execute',
      capabilities: { 'verify-findings': ok },
    });
    assert.deepEqual(outcomesOf(skipped), ['skipped', 'executed']);
    const degraded = await executeFlow({
      document: doc('degrade'),
      mode: 'execute',
      capabilities: { 'verify-findings': ok },
    });
    assert.deepEqual(outcomesOf(degraded), ['degraded', 'executed']);
    assert.match(degraded.steps[0].reason, /capability unavailable/);
  });

  test('missing capability in observe mode never stops, whatever onUnsatisfied says', async () => {
    for (const onUnsatisfied of [undefined, 'stop', 'skip', 'degrade']) {
      const result = await executeFlow({ document: doc(onUnsatisfied), mode: 'observe' });
      assert.equal(result.stopped, false, String(onUnsatisfied));
      assert.deepEqual(outcomesOf(result), ['not-implemented', 'not-implemented']);
    }
  });

  test('throwing capability follows onUnsatisfied in both modes and never escapes', async () => {
    for (const mode of FLOW_RUN_MODES) {
      const stopped = await executeFlow({
        document: doc(),
        mode,
        capabilities: { 'resolve-intent': boom, 'verify-findings': ok },
      });
      assert.equal(stopped.stopped, true, mode);
      assert.equal(stopped.stopReason, STOP_REASON_NOT_EXECUTED, mode);
      assert.deepEqual(outcomesOf(stopped), ['stopped'], mode);
      assert.match(stopped.steps[0].reason, /failed: boom/);

      const skipped = await executeFlow({
        document: doc('skip'),
        mode,
        capabilities: { 'resolve-intent': boom, 'verify-findings': ok },
      });
      assert.deepEqual(outcomesOf(skipped), ['skipped', 'executed'], mode);
      assert.match(skipped.steps[0].reason, /failed: boom/);

      const degraded = await executeFlow({
        document: doc('degrade'),
        mode,
        capabilities: { 'resolve-intent': boom, 'verify-findings': ok },
      });
      assert.deepEqual(outcomesOf(degraded), ['degraded', 'executed'], mode);
      assert.match(degraded.steps[0].reason, /failed: boom/);
    }
  });

  test('a rejected promise is a failure too', async () => {
    const result = await executeFlow({
      document: doc('skip'),
      capabilities: { 'resolve-intent': async () => Promise.reject(new Error('later')) },
    });
    assert.deepEqual(outcomesOf(result), ['skipped', 'not-implemented']);
    assert.match(result.steps[0].reason, /failed: later/);
  });

  test('the result echoes the mode it ran in', async () => {
    for (const mode of FLOW_RUN_MODES) {
      const result = await executeFlow({ document: doc('skip'), mode });
      assert.equal(result.mode, mode);
    }
  });
});

describe('flow-runner: invalid arguments are loud', () => {
  test('a document without steps[] throws FlowRunnerError', async () => {
    await assert.rejects(executeFlow({ document: { id: 'x' } }), FlowRunnerError);
    await assert.rejects(executeFlow({}), FlowRunnerError);
  });

  test('a step carrying both use and reviewer throws', async () => {
    const document = { id: 'x', steps: [{ use: 'resolve-intent', reviewer: 'bug-hunter' }] };
    await assert.rejects(executeFlow({ document }), FlowRunnerError);
  });

  test('an unknown onUnsatisfied value throws instead of guessing', async () => {
    const document = {
      id: 'x',
      inputs: [{ name: 'plan' }],
      steps: [
        { use: 'resolve-intent', when: { input: 'plan', state: 'present' }, onUnsatisfied: 'x' },
      ],
    };
    await assert.rejects(executeFlow({ document, inputs: {} }), FlowRunnerError);
  });

  test('an unknown mode throws', async () => {
    const document = { id: 'x', steps: [{ use: 'resolve-intent' }] };
    await assert.rejects(executeFlow({ document, mode: 'dry-run' }), FlowRunnerError);
  });
});
