/**
 * Tests for src/lib/deterministic-gate.mjs (Epic #1347 S4, #1351).
 * computeStrictBlock joins review findings to their emitting skills and
 * reports whether any came from a deterministic strict_block skill.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStrictBlock,
  isStrictBlockSkill,
  STRICT_BLOCK,
  BYPASS_WARNING,
} from '../src/lib/deterministic-gate.mjs';

const deterministicStrict = {
  metadata: {
    id: 'lint-gate',
    evaluationType: 'deterministic',
    deterministicGate: { command: 'x' },
  },
};
const deterministicExplicitStrict = {
  metadata: {
    id: 'lint-gate-2',
    evaluationType: 'deterministic',
    deterministicGate: { command: 'x', failSeverity: STRICT_BLOCK },
  },
};
const deterministicBypass = {
  metadata: {
    id: 'lint-warn',
    evaluationType: 'deterministic',
    deterministicGate: { command: 'x', failSeverity: BYPASS_WARNING },
  },
};
const deterministicNoGate = {
  metadata: { id: 'det-advisory', evaluationType: 'deterministic' },
};
const agentic = { metadata: { id: 'security-review', evaluationType: 'agentic' } };

describe('isStrictBlockSkill', () => {
  test('deterministic + declared gate (failSeverity default) is strict_block', () => {
    assert.equal(isStrictBlockSkill(deterministicStrict), true);
    assert.equal(isStrictBlockSkill(deterministicExplicitStrict), true);
  });

  test('deterministic + bypass_warning gate is NOT strict_block', () => {
    assert.equal(isStrictBlockSkill(deterministicBypass), false);
  });

  test('an unknown/malformed failSeverity still blocks (fail-safe, self-review #1403)', () => {
    const weird = {
      metadata: {
        id: 'weird-sev',
        evaluationType: 'deterministic',
        deterministicGate: { command: 'x', failSeverity: 'not-a-real-value' },
      },
    };
    assert.equal(isStrictBlockSkill(weird), true);
  });

  test('deterministic WITHOUT a declared gate stays advisory (opt-in enforcement)', () => {
    assert.equal(isStrictBlockSkill(deterministicNoGate), false);
  });

  test('non-deterministic skills are never strict_block', () => {
    assert.equal(isStrictBlockSkill(agentic), false);
  });

  test('a malformed array deterministicGate does NOT read as a declared gate (gemini #1403)', () => {
    const arrayGate = {
      metadata: { id: 'weird', evaluationType: 'deterministic', deterministicGate: [] },
    };
    assert.equal(isStrictBlockSkill(arrayGate), false);
  });

  test('accepts a bare metadata object as well as a wrapped skill', () => {
    assert.equal(isStrictBlockSkill(deterministicStrict.metadata), true);
  });
});

describe('computeStrictBlock', () => {
  test('a finding from a deterministic strict_block skill sets strictBlock', () => {
    const { strictBlock, findings } = computeStrictBlock({
      findings: [{ ruleId: 'lint-gate', severity: 'minor' }],
      selected: [deterministicStrict],
    });
    assert.equal(strictBlock, true);
    assert.equal(findings.length, 1);
  });

  test('a finding from a bypass_warning skill does NOT set strictBlock', () => {
    const { strictBlock } = computeStrictBlock({
      findings: [{ ruleId: 'lint-warn', severity: 'critical' }],
      selected: [deterministicBypass],
    });
    assert.equal(strictBlock, false);
  });

  test('a finding from an agentic skill does NOT set strictBlock', () => {
    const { strictBlock } = computeStrictBlock({
      findings: [{ ruleId: 'security-review', severity: 'critical' }],
      selected: [agentic],
    });
    assert.equal(strictBlock, false);
  });

  test('matches by ruleId (= emitting skill id), ignoring findings from other skills', () => {
    const { strictBlock, findings } = computeStrictBlock({
      findings: [
        { ruleId: 'security-review', severity: 'critical' },
        { ruleId: 'lint-gate', severity: 'info' },
      ],
      selected: [deterministicStrict, agentic],
    });
    assert.equal(strictBlock, true);
    assert.deepEqual(
      findings.map((f) => f.ruleId),
      ['lint-gate']
    );
  });

  test('empty / missing inputs are safe (no strict block)', () => {
    assert.equal(computeStrictBlock({}).strictBlock, false);
    assert.equal(computeStrictBlock({ findings: [], selected: [] }).strictBlock, false);
    assert.equal(
      computeStrictBlock({ findings: [{ ruleId: 'lint-gate' }], selected: [] }).strictBlock,
      false
    );
  });

  test('null findings in the list are skipped without throwing', () => {
    const { strictBlock } = computeStrictBlock({
      findings: [null, { ruleId: 'lint-gate' }],
      selected: [deterministicStrict],
    });
    assert.equal(strictBlock, true);
  });
});
