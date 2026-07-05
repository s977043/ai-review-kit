/**
 * Tests for src/lib/run-gate.mjs deriveRunGate (Epic #1347 S3/S4).
 * Focus: the S4 strict_block forwarding link — a runLocalReview result carrying
 * `strictBlock: true` must derive a NO_GO / STRICT_BLOCK gate.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { deriveRunGate } from '../src/lib/run-gate.mjs';

const okResult = {
  status: 'ok',
  dryRun: false,
  findings: [],
  changedFiles: ['src/lib/foo.mjs'],
  plan: {},
  config: {},
};

describe('deriveRunGate — strict_block forwarding (Epic #1347 S4)', () => {
  test('a clean result with no strict block gates GO', () => {
    const { gate } = deriveRunGate(okResult);
    assert.equal(gate.decision, 'GO');
  });

  test('result.strictBlock === true → NO_GO / STRICT_BLOCK', () => {
    const { gate } = deriveRunGate({ ...okResult, strictBlock: true });
    assert.equal(gate.decision, 'NO_GO');
    assert.equal(gate.reasonCode, 'STRICT_BLOCK');
  });

  test('strictBlock forces NO_GO even with zero blocking findings', () => {
    const { gate } = deriveRunGate({ ...okResult, findings: [], strictBlock: true });
    assert.equal(gate.decision, 'NO_GO');
    assert.equal(gate.reasonCode, 'STRICT_BLOCK');
  });

  test('a missing strictBlock field is treated as false (backward compatible)', () => {
    const { gate } = deriveRunGate(okResult);
    assert.notEqual(gate.reasonCode, 'STRICT_BLOCK');
  });

  test('a null result yields the fail-soft shape (no throw)', () => {
    const { decision, gate } = deriveRunGate(null);
    assert.equal(decision, undefined);
    assert.equal(gate, undefined);
  });
});
