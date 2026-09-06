// Contract tests for src/lib/flow-runner.mjs (Epic #2011 AC7, P1 of 5).
//
// The runner never reads `flows/` itself (tests/flow-definitions.test.mjs
// keeps src/lib/flow-loader.mjs the only reader); this test reads the shipped
// Flow documents and hands them in as `resolveFlowEntry().document` would.
//
// Pinned here:
//   - every shipped Flow yields one record per step, in index order, with an
//     outcome from the closed STEP_OUTCOMES set;
//   - `when` unsatisfied -> skipped / degraded / stopped per `onUnsatisfied`;
//   - a missing required input stops before the first step with the reason
//     code taken from GATE_REASON_CODES, not a hand-written string;
//   - a step with no injected capability is `not-implemented`, and the two
//     reserved primitives stay `not-implemented` even when one is injected;
//   - parallel runs keep index order and the walk is deterministic;
//   - Human authority is unchanged: no agent contract can approve a merge.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

import {
  executeFlow,
  FlowRunnerError,
  ON_UNSATISFIED_OUTCOMES,
  RESERVED_PRIMITIVES,
  REVIEWER_CAPABILITY_KEY,
  STEP_OUTCOMES,
  STOP_REASON_MISSING_INPUT,
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

/** Every declared input present, so no `when` clause blocks the walk. */
const allInputsOf = (document) =>
  Object.fromEntries((document.inputs ?? []).map((input) => [input.name, `<${input.name}>`]));

const stepIdOf = (step) => step.use ?? step.reviewer;

describe('flow-runner: shipped Flow documents', () => {
  test('8 Flow documents are shipped', () => {
    assert.equal(flows.length, 8);
  });

  for (const { name, document } of flows) {
    test(`${name}: one record per step, in index order, outcomes in the closed set`, async () => {
      const result = await executeFlow({ document, inputs: allInputsOf(document) });
      assert.equal(result.stopped, false);
      assert.equal(result.stopReason, undefined);
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

    test(`${name}: with nothing injected every step is not-implemented`, async () => {
      const result = await executeFlow({ document, inputs: allInputsOf(document) });
      assert.deepEqual(
        [...new Set(result.steps.map((record) => record.outcome))],
        ['not-implemented']
      );
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
      const result = await executeFlow({ document, inputs: {} });
      assert.equal(result.stopped, true, name);
      assert.equal(result.stopReason, 'DETERMINISTIC_UNRUNNABLE', name);
      assert.deepEqual(result.steps, [], name);
      assert.ok(result.missingInputs.length > 0, name);
    }
  });

  test('the stop reason is a GATE_REASON_CODES value (no second vocabulary)', async () => {
    assert.ok(GATE_REASON_CODES.includes(STOP_REASON_MISSING_INPUT));
    const document = {
      id: 'x',
      inputs: [{ name: 'diff', required: true }],
      steps: [{ use: 'resolve-intent' }],
    };
    const result = await executeFlow({ document, inputs: {} });
    assert.ok(
      GATE_REASON_CODES.includes(result.stopReason),
      `stopReason "${result.stopReason}" is not in GATE_REASON_CODES`
    );
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
  });

  test('unsatisfied when -> skipped / degraded, and the walk continues', async () => {
    const result = await executeFlow({ document, inputs: {} });
    assert.equal(result.stopped, false);
    assert.deepEqual(
      result.steps.map((record) => record.outcome),
      ['not-implemented', 'skipped', 'degraded', 'not-implemented']
    );
    assert.match(result.steps[1].reason, /input "plan" is absent/);
  });

  test('satisfied when -> the step is walked normally', async () => {
    const result = await executeFlow({ document, inputs: { plan: 'p', diff: 'd' } });
    assert.deepEqual(
      result.steps.map((record) => record.outcome),
      ['not-implemented', 'not-implemented', 'not-implemented', 'not-implemented']
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

  test('onUnsatisfied absent means stop: the walk ends there with the gate reason', async () => {
    const doc = {
      id: 'x',
      inputs: [{ name: 'plan' }],
      steps: [
        { use: 'resolve-intent' },
        { use: 'cross-artifact-review', when: { input: 'plan', state: 'present' } },
        { use: 'verify-findings' },
      ],
    };
    const result = await executeFlow({ document: doc, inputs: {} });
    assert.equal(result.stopped, true);
    assert.equal(result.stopReason, STOP_REASON_MISSING_INPUT);
    assert.deepEqual(
      result.steps.map((record) => record.outcome),
      ['not-implemented', 'stopped']
    );
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
    assert.deepEqual(
      result.steps.map((record) => record.outcome),
      ['executed', 'not-implemented']
    );
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

  test('reserved primitives stay not-implemented even when a capability is injected', async () => {
    assert.deepEqual([...RESERVED_PRIMITIVES].sort(), ['derive-gate', 'human-escalation']);
    let called = 0;
    const document = {
      id: 'x',
      steps: RESERVED_PRIMITIVES.map((use) => ({ use })),
    };
    const capabilities = Object.fromEntries(
      RESERVED_PRIMITIVES.map((use) => [use, () => (called += 1)])
    );
    const result = await executeFlow({ document, capabilities });
    assert.equal(called, 0);
    assert.deepEqual(
      result.steps.map((record) => record.outcome),
      ['not-implemented', 'not-implemented']
    );
    for (const record of result.steps) assert.match(record.reason, /reserved primitive/);
  });

  test('Human authority is unchanged: no agent contract can approve a merge', () => {
    const contracts = readdirSync(CONTRACTS_DIR).filter((name) => name.endsWith('.agent.json'));
    assert.ok(contracts.length >= 5);
    for (const name of contracts) {
      const contract = readJson(join(CONTRACTS_DIR, name));
      const flag = JSON.stringify(contract).includes('"canApproveMerge":false');
      assert.ok(flag, `${name} must declare canApproveMerge: false`);
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
});
