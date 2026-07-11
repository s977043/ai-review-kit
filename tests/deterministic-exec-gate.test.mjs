/**
 * Canary tests for the deterministic-exec double env-var gate (#1401 §11.8 c2).
 *
 * This predicate guards the ONLY activation point of the command executor (the
 * RCE path). A regression that loosens it — matching a near-miss env value, or
 * firing on a single var — would silently opt users into command execution.
 * These cases lock the gate to "both vars, exact, non-empty".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isDeterministicExecEnabled,
  runDeterministicExecGateIfEnabled,
} from '../src/lib/deterministic-exec-gate.mjs';

const ON_ENV = { RIVER_DETERMINISTIC_EXEC: '1', RIVER_TRUSTED_TREE: '/base' };

describe('isDeterministicExecEnabled — double env-var opt-in gate', () => {
  test('both vars set correctly → enabled', () => {
    assert.equal(
      isDeterministicExecEnabled({ RIVER_DETERMINISTIC_EXEC: '1', RIVER_TRUSTED_TREE: '/base' }),
      true
    );
  });

  test('default (no env) → disabled', () => {
    assert.equal(isDeterministicExecEnabled({}), false);
  });

  test('null / undefined env → disabled (no throw)', () => {
    assert.equal(isDeterministicExecEnabled(null), false);
    assert.equal(isDeterministicExecEnabled(undefined), false);
  });

  test('only RIVER_DETERMINISTIC_EXEC set → disabled (needs trusted tree)', () => {
    assert.equal(isDeterministicExecEnabled({ RIVER_DETERMINISTIC_EXEC: '1' }), false);
  });

  test('only RIVER_TRUSTED_TREE set → disabled (needs opt-in flag)', () => {
    assert.equal(isDeterministicExecEnabled({ RIVER_TRUSTED_TREE: '/base' }), false);
  });

  test('empty RIVER_TRUSTED_TREE → disabled (non-empty required)', () => {
    assert.equal(
      isDeterministicExecEnabled({ RIVER_DETERMINISTIC_EXEC: '1', RIVER_TRUSTED_TREE: '' }),
      false
    );
  });

  for (const near of ['0', 'true', 'TRUE', 'yes', ' 1', '1 ', '01', 1]) {
    test(`near-miss RIVER_DETERMINISTIC_EXEC=${JSON.stringify(near)} → disabled`, () => {
      assert.equal(
        isDeterministicExecEnabled({ RIVER_DETERMINISTIC_EXEC: near, RIVER_TRUSTED_TREE: '/base' }),
        false
      );
    });
  }
});

describe('runDeterministicExecGateIfEnabled — wiring + fail-safe (P2 #1434)', () => {
  test('opt-out (default env) → returns all-false WITHOUT importing the orchestrator', async () => {
    let imported = false;
    const result = await runDeterministicExecGateIfEnabled({
      env: {},
      selected: [],
      reviewSourceDir: '/src',
      changedFiles: [],
      importOrchestrator: async () => {
        imported = true;
        return { runDeterministicGates: async () => ({}) };
      },
    });
    assert.equal(imported, false, 'orchestrator must NOT be imported when opted out');
    assert.deepEqual(result, { strictBlock: false, deterministicUnrunnable: false });
  });

  test('opted in, orchestrator throws → fail-safe deterministicUnrunnable=true', async () => {
    const result = await runDeterministicExecGateIfEnabled({
      env: ON_ENV,
      selected: [],
      reviewSourceDir: '/src',
      changedFiles: [],
      importOrchestrator: async () => {
        throw new Error('infra failure (temp-dir/staging/spawn)');
      },
    });
    assert.deepEqual(result, { strictBlock: false, deterministicUnrunnable: true });
  });

  test('opted in, gate returns fail → strictBlock=true forwarded', async () => {
    const result = await runDeterministicExecGateIfEnabled({
      env: ON_ENV,
      selected: [],
      reviewSourceDir: '/src',
      changedFiles: [],
      importOrchestrator: async () => ({
        runDeterministicGates: async () => ({ strictBlock: true, deterministicUnrunnable: false }),
      }),
    });
    assert.deepEqual(result, { strictBlock: true, deterministicUnrunnable: false });
  });

  test('opted in, gate returns unrunnable → deterministicUnrunnable=true forwarded', async () => {
    const result = await runDeterministicExecGateIfEnabled({
      env: ON_ENV,
      selected: [],
      reviewSourceDir: '/src',
      changedFiles: [],
      importOrchestrator: async () => ({
        runDeterministicGates: async () => ({ strictBlock: false, deterministicUnrunnable: true }),
      }),
    });
    assert.deepEqual(result, { strictBlock: false, deterministicUnrunnable: true });
  });
});
