/**
 * Tests for src/lib/gate-exit.mjs (Epic #1347 S4 PR-C, #1351).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { gateDecisionExitCode, combineExitCodes } from '../src/lib/gate-exit.mjs';

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
