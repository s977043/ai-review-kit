/**
 * Tests for src/lib/gate-exit.mjs (Epic #1347 S4 PR-C, #1351).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  gateDecisionExitCode,
  combineExitCodes,
  resolveGateExitCode,
} from '../src/lib/gate-exit.mjs';

describe('gateDecisionExitCode', () => {
  test('GO-family decisions exit 0', () => {
    assert.equal(gateDecisionExitCode('GO'), 0);
    assert.equal(gateDecisionExitCode('GO_WITH_OBSERVATION'), 0);
  });

  test('NO_GO exits 1', () => {
    assert.equal(gateDecisionExitCode('NO_GO'), 1);
  });

  test('ESCALATE exits 3 (dedicated cliff code)', () => {
    assert.equal(gateDecisionExitCode('ESCALATE'), 3);
  });

  test('unknown / undefined fails safe to 1 (never 0)', () => {
    assert.equal(gateDecisionExitCode(undefined), 1);
    assert.equal(gateDecisionExitCode('WHATEVER'), 1);
    assert.equal(gateDecisionExitCode(null), 1);
  });
});

describe('combineExitCodes — severity precedence, not numeric max', () => {
  test('escalate(3) beats everything', () => {
    assert.equal(combineExitCodes(3, 1), 3);
    assert.equal(combineExitCodes(0, 3), 3);
    assert.equal(combineExitCodes(2, 3), 3);
  });

  test('fail(1) beats warn(2) — the key non-numeric case', () => {
    assert.equal(combineExitCodes(1, 2), 1);
    assert.equal(combineExitCodes(2, 1), 1);
  });

  test('warn(2) beats pass(0)', () => {
    assert.equal(combineExitCodes(2, 0), 2);
    assert.equal(combineExitCodes(0, 0, 2), 2);
  });

  test('all-pass stays 0', () => {
    assert.equal(combineExitCodes(0, 0), 0);
    assert.equal(combineExitCodes(), 0);
  });

  test('NO_GO(1) + warn(2) → 1 (a warn must not mask a hard block)', () => {
    assert.equal(combineExitCodes(2, 1), 1);
  });

  test('an unknown code (fail rank) is not masked by a later warn(2) (gemini #1404)', () => {
    assert.equal(combineExitCodes(99, 2), 99);
    assert.equal(combineExitCodes(2, 99), 99);
  });
});

describe('resolveGateExitCode — lazy thunks, output order, exit codes', () => {
  function captureConsoleError(fn) {
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.join(' '));
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        console.error = original;
      })
      .then((result) => ({ result, lines }));
  }

  test('no severity flag and no gate: both thunks stay unevaluated, exit 0', async () => {
    let gateInputCalls = 0;
    let gateObjectCalls = 0;
    const { result, lines } = await captureConsoleError(() =>
      resolveGateExitCode({
        failOn: undefined,
        warnOn: undefined,
        advisoryOnly: undefined,
        gate: undefined,
        getGateInput: () => {
          gateInputCalls += 1;
          return { findings: [] };
        },
        getGateObject: () => {
          gateObjectCalls += 1;
          return { decision: 'GO' };
        },
      })
    );
    assert.equal(result, 0);
    assert.equal(gateInputCalls, 0, 'getGateInput must not be called without a severity flag');
    assert.equal(gateObjectCalls, 0, 'getGateObject must not be called without --gate');
    assert.deepEqual(lines, []);
  });

  test('severity-only path (no --gate): getGateObject stays unevaluated', async () => {
    let gateObjectCalls = 0;
    const { result, lines } = await captureConsoleError(() =>
      resolveGateExitCode({
        failOn: 'critical',
        gate: false,
        getGateInput: () => ({ findings: [{ severity: 'critical' }] }),
        getGateObject: () => {
          gateObjectCalls += 1;
          return { decision: 'GO' };
        },
      })
    );
    assert.equal(result, 1);
    assert.equal(gateObjectCalls, 0, 'getGateObject must not be called when --gate is off');
    assert.deepEqual(lines, ['Review gate: FAIL (max severity: critical).']);
  });

  test('warn-only severity path returns 2', async () => {
    const { result, lines } = await captureConsoleError(() =>
      resolveGateExitCode({
        warnOn: 'major',
        gate: false,
        getGateInput: () => ({ findings: [{ severity: 'major' }] }),
        getGateObject: () => ({ decision: 'GO' }),
      })
    );
    assert.equal(result, 2);
    assert.deepEqual(lines, ['Review gate: WARN (max severity: major).']);
  });

  test('--gate set but no severity flag: getGateInput stays unevaluated', async () => {
    let gateInputCalls = 0;
    const { result, lines } = await captureConsoleError(() =>
      resolveGateExitCode({
        gate: true,
        getGateInput: () => {
          gateInputCalls += 1;
          return { findings: [{ severity: 'critical' }] };
        },
        getGateObject: () => ({ decision: 'NO_GO', reasonCode: 'R1' }),
      })
    );
    assert.equal(result, 1);
    assert.equal(gateInputCalls, 0, 'getGateInput must not be called without a severity flag');
    assert.deepEqual(lines, ['Gate: NO_GO (R1) → exit 1.']);
  });

  test('severity + gate: FAIL line precedes Gate line, stricter code wins', async () => {
    const { result, lines } = await captureConsoleError(() =>
      resolveGateExitCode({
        failOn: 'critical',
        gate: true,
        getGateInput: () => ({ findings: [{ severity: 'critical' }] }),
        getGateObject: () => ({ decision: 'ESCALATE', reasonCode: 'CLIFF' }),
      })
    );
    // severity fail(1) combined with escalate(3) → escalate wins.
    assert.equal(result, 3);
    assert.deepEqual(lines, [
      'Review gate: FAIL (max severity: critical).',
      'Gate: ESCALATE (CLIFF) → exit 3.',
    ]);
  });

  test('gate with undefined decision fails safe to 1 and logs UNKNOWN/n/a', async () => {
    const { result, lines } = await captureConsoleError(() =>
      resolveGateExitCode({
        gate: true,
        getGateInput: () => ({ findings: [] }),
        getGateObject: () => undefined,
      })
    );
    assert.equal(result, 1);
    assert.deepEqual(lines, ['Gate: UNKNOWN (n/a) → exit 1.']);
  });
});
