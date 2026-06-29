import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeFindingBreakdown } from '../../src/lib/scoring/breakdown.mjs';

describe('computeFindingBreakdown', () => {
  it('returns all required fields', () => {
    const result = computeFindingBreakdown({
      evidence: [],
      confidence: 'medium',
      severity: 'major',
      ruleId: 'test',
    });
    assert.ok('evidenceStrength' in result);
    assert.ok('reproducibility' in result);
    assert.ok('blastRadius' in result);
    assert.ok('reviewerAgreement' in result);
    assert.ok('actionability' in result);
    assert.ok('composite' in result);
  });

  it('actionability reflects the suggestion/fix presence', () => {
    assert.equal(
      computeFindingBreakdown({ suggestion: 'Add a null guard before access' }).actionability,
      1.0
    );
    assert.equal(
      computeFindingBreakdown({ message: 'Finding: x. Fix: wrap in a guard clause' }).actionability,
      1.0
    );
    assert.equal(computeFindingBreakdown({ suggestion: 'tweak' }).actionability, 0.5);
    assert.equal(computeFindingBreakdown({}).actionability, 0.0);
    // Fix spanning a newline still matches ([\s\S]); a word like Prefix: does not.
    assert.equal(
      computeFindingBreakdown({ message: 'Finding: x.\nFix:\n- wrap in a guard clause' })
        .actionability,
      1.0
    );
    assert.equal(
      computeFindingBreakdown({ message: 'Prefix: not a real fix here' }).actionability,
      0.0
    );
  });

  it('actionability does not change the composite score', () => {
    const withFix = computeFindingBreakdown({
      evidence: ['abc'],
      confidence: 'medium',
      severity: 'major',
      suggestion: 'Add a null guard before access',
    });
    const withoutFix = computeFindingBreakdown({
      evidence: ['abc'],
      confidence: 'medium',
      severity: 'major',
    });
    assert.equal(withFix.composite, withoutFix.composite);
    assert.notEqual(withFix.actionability, withoutFix.actionability);
  });

  it('composite is in range 0.0–1.0', () => {
    const cases = [
      { evidence: [], confidence: 'low', severity: 'info', ruleId: 'foo' },
      {
        evidence: ['x'.repeat(200)],
        confidence: 'high',
        severity: 'critical',
        ruleId: 'security-check',
      },
      {
        evidence: ['abc'],
        confidence: 'medium',
        severity: 'major',
        ruleId: 'test-existence',
      },
    ];
    for (const finding of cases) {
      const { composite } = computeFindingBreakdown(finding);
      assert.ok(composite >= 0.0 && composite <= 1.0, `composite out of range: ${composite}`);
    }
  });

  describe('evidenceStrength', () => {
    it('returns 0.0 for empty evidence array', () => {
      const { evidenceStrength } = computeFindingBreakdown({ evidence: [] });
      assert.equal(evidenceStrength, 0.0);
    });

    it('returns 0.0 when evidence field is missing', () => {
      const { evidenceStrength } = computeFindingBreakdown({});
      assert.equal(evidenceStrength, 0.0);
    });

    it('returns 0.3 for total chars <= 50', () => {
      const { evidenceStrength } = computeFindingBreakdown({ evidence: ['hello'] });
      assert.equal(evidenceStrength, 0.3);
    });

    it('returns 0.6 for total chars in 51–150', () => {
      const { evidenceStrength } = computeFindingBreakdown({ evidence: ['x'.repeat(100)] });
      assert.equal(evidenceStrength, 0.6);
    });

    it('returns 1.0 for total chars > 150', () => {
      const { evidenceStrength } = computeFindingBreakdown({ evidence: ['x'.repeat(151)] });
      assert.equal(evidenceStrength, 1.0);
    });

    it('sums chars across multiple evidence items', () => {
      const { evidenceStrength } = computeFindingBreakdown({
        evidence: ['x'.repeat(100), 'y'.repeat(60)],
      });
      assert.equal(evidenceStrength, 1.0);
    });
  });

  describe('reproducibility', () => {
    it('high confidence → 1.0', () => {
      const { reproducibility } = computeFindingBreakdown({
        confidence: 'high',
        severity: 'major',
      });
      assert.equal(reproducibility, 1.0);
    });

    it('medium confidence → 0.5', () => {
      const { reproducibility } = computeFindingBreakdown({
        confidence: 'medium',
        severity: 'major',
      });
      assert.equal(reproducibility, 0.5);
    });

    it('low confidence → 0.2', () => {
      const { reproducibility } = computeFindingBreakdown({ confidence: 'low', severity: 'major' });
      assert.equal(reproducibility, 0.2);
    });

    it('critical severity adds 0.2 (clamped to 1.0)', () => {
      const { reproducibility } = computeFindingBreakdown({
        confidence: 'high',
        severity: 'critical',
      });
      assert.equal(reproducibility, 1.0);
    });

    it('critical severity adds 0.2 to medium base', () => {
      const { reproducibility } = computeFindingBreakdown({
        confidence: 'medium',
        severity: 'critical',
      });
      assert.equal(reproducibility, 0.7);
    });

    it('minor severity subtracts 0.1', () => {
      const { reproducibility } = computeFindingBreakdown({
        confidence: 'medium',
        severity: 'minor',
      });
      assert.equal(reproducibility, 0.4);
    });

    it('minor severity reduces low base to 0.1', () => {
      const { reproducibility } = computeFindingBreakdown({ confidence: 'low', severity: 'minor' });
      assert.equal(reproducibility, 0.1);
    });
  });

  describe('blastRadius', () => {
    it('critical → 1.0', () => {
      const { blastRadius } = computeFindingBreakdown({ severity: 'critical', ruleId: 'foo' });
      assert.equal(blastRadius, 1.0);
    });

    it('major → 0.7', () => {
      const { blastRadius } = computeFindingBreakdown({ severity: 'major', ruleId: 'foo' });
      assert.equal(blastRadius, 0.7);
    });

    it('minor → 0.3', () => {
      const { blastRadius } = computeFindingBreakdown({ severity: 'minor', ruleId: 'foo' });
      assert.equal(blastRadius, 0.3);
    });

    it('info → 0.1', () => {
      const { blastRadius } = computeFindingBreakdown({ severity: 'info', ruleId: 'foo' });
      assert.equal(blastRadius, 0.1);
    });

    it('security ruleId multiplies by 1.2 (major: 0.7 * 1.2 = 0.84)', () => {
      const { blastRadius } = computeFindingBreakdown({
        severity: 'major',
        ruleId: 'security-xss',
      });
      assert.ok(Math.abs(blastRadius - 0.84) < 1e-9, `expected 0.84, got ${blastRadius}`);
    });

    it('security ruleId with critical clamps to 1.0', () => {
      const { blastRadius } = computeFindingBreakdown({
        severity: 'critical',
        ruleId: 'security-injection',
      });
      assert.equal(blastRadius, 1.0);
    });
  });

  describe('reviewerAgreement', () => {
    it('high confidence → 0.9', () => {
      const { reviewerAgreement } = computeFindingBreakdown({ confidence: 'high', ruleId: 'foo' });
      assert.equal(reviewerAgreement, 0.9);
    });

    it('medium confidence → 0.7', () => {
      const { reviewerAgreement } = computeFindingBreakdown({
        confidence: 'medium',
        ruleId: 'foo',
      });
      assert.equal(reviewerAgreement, 0.7);
    });

    it('low confidence → 0.4', () => {
      const { reviewerAgreement } = computeFindingBreakdown({ confidence: 'low', ruleId: 'foo' });
      assert.equal(reviewerAgreement, 0.4);
    });

    it('missing confidence defaults to medium → 0.7', () => {
      const { reviewerAgreement } = computeFindingBreakdown({ ruleId: 'foo' });
      assert.equal(reviewerAgreement, 0.7);
    });
  });
});
