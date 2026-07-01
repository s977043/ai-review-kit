import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFindings, SUPPRESS_REASONS } from '../src/lib/finding-factory.mjs';

function makeFinding(overrides = {}) {
  return {
    id: `rr-${Math.random().toString(36).slice(2)}`,
    ruleId: 'some-rule',
    file: 'src/foo.mjs',
    severity: 'major',
    confidence: 'high',
    evidence: ['This is clear evidence with more than thirty characters here.'],
    ...overrides,
  };
}

describe('classifyFindings', () => {
  it('places a normal finding in overview', () => {
    const f = makeFinding();
    const { overview, suppressed } = classifyFindings([f]);
    assert.equal(overview.length, 1);
    assert.equal(suppressed.length, 0);
  });

  it('suppresses low_confidence non-critical', () => {
    const f = makeFinding({ confidence: 'low', severity: 'major' });
    const { overview, suppressed } = classifyFindings([f]);
    assert.equal(overview.length, 0);
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.LOW_CONFIDENCE);
  });

  it('keeps low_confidence critical findings', () => {
    const f = makeFinding({ confidence: 'low', severity: 'critical' });
    const { overview, suppressed } = classifyFindings([f]);
    assert.equal(overview.length, 1);
    assert.equal(suppressed.length, 0);
  });

  it('suppresses insufficient_evidence when chars < 30', () => {
    const f = makeFinding({ evidence: ['short'] });
    const { overview, suppressed } = classifyFindings([f]);
    assert.equal(overview.length, 0);
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.INSUFFICIENT_EVIDENCE);
  });

  it('suppresses insufficient_evidence for empty evidence array', () => {
    const f = makeFinding({ evidence: [] });
    const { suppressed } = classifyFindings([f]);
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.INSUFFICIENT_EVIDENCE);
  });

  it('suppresses style_only for minor severity with readability ruleId', () => {
    const f = makeFinding({ severity: 'minor', ruleId: 'readability-variable-names' });
    const { suppressed } = classifyFindings([f]);
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.STYLE_ONLY);
  });

  it('suppresses style_only for minor severity with style ruleId', () => {
    const f = makeFinding({ severity: 'minor', ruleId: 'code-style-check' });
    const { suppressed } = classifyFindings([f]);
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.STYLE_ONLY);
  });

  it('does not suppress minor severity without readability/style ruleId', () => {
    const f = makeFinding({ severity: 'minor', ruleId: 'null-safety-check' });
    const { overview, suppressed } = classifyFindings([f]);
    assert.equal(overview.length, 1);
    assert.equal(suppressed.length, 0);
  });

  it('suppresses duplicate within same file (same ruleId)', () => {
    const f1 = makeFinding({ ruleId: 'null-check', file: 'src/a.mjs' });
    const f2 = makeFinding({ ruleId: 'null-check', file: 'src/a.mjs' });
    const { suppressed } = classifyFindings([f1, f2]);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.DUPLICATE);
  });

  it('suppresses duplicate within PR (same ruleId different files)', () => {
    const f1 = makeFinding({ ruleId: 'null-check', file: 'src/a.mjs' });
    const f2 = makeFinding({ ruleId: 'null-check', file: 'src/b.mjs' });
    const { overview, suppressed } = classifyFindings([f1, f2]);
    assert.equal(overview.length, 1);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.DUPLICATE);
  });

  it('keeps different ruleIds from different files', () => {
    const f1 = makeFinding({ ruleId: 'null-check', file: 'src/a.mjs' });
    const f2 = makeFinding({ ruleId: 'type-safety', file: 'src/b.mjs' });
    const { overview, suppressed } = classifyFindings([f1, f2]);
    assert.equal(overview.length, 2);
    assert.equal(suppressed.length, 0);
  });

  it('caps overview by maxOverview (medium=5)', () => {
    const findings = Array.from({ length: 8 }, (_, i) =>
      makeFinding({ ruleId: `rule-${i}`, id: `rr-${i}` })
    );
    const { overview, suppressed } = classifyFindings(findings, { reviewMode: 'medium' });
    assert.equal(overview.length, 5);
    assert.equal(
      suppressed.filter((f) => f.suppressReason === SUPPRESS_REASONS.COVERED_BY_HIGHER_LEVEL)
        .length,
      3
    );
  });

  it('caps overview by maxOverview (tiny=3)', () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      makeFinding({ ruleId: `rule-${i}`, id: `rr-${i}` })
    );
    const { overview } = classifyFindings(findings, { reviewMode: 'tiny' });
    assert.equal(overview.length, 3);
  });

  it('caps overview by maxOverview (large=8)', () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      makeFinding({ ruleId: `rule-${i}`, id: `rr-${i}` })
    );
    const { overview } = classifyFindings(findings, { reviewMode: 'large' });
    assert.equal(overview.length, 8);
  });

  it('always returns inlineCandidates as empty array', () => {
    const { inlineCandidates } = classifyFindings([makeFinding()]);
    assert.deepEqual(inlineCandidates, []);
  });

  it('handles empty findings array', () => {
    const { overview, suppressed, inlineCandidates } = classifyFindings([]);
    assert.deepEqual(overview, []);
    assert.deepEqual(suppressed, []);
    assert.deepEqual(inlineCandidates, []);
  });

  it('critical findings bypass low_confidence suppression', () => {
    const findings = [
      makeFinding({ confidence: 'low', severity: 'critical', ruleId: 'sql-injection' }),
    ];
    const { overview } = classifyFindings(findings);
    assert.equal(overview.length, 1);
  });

  it('adds suppressReason to suppressed findings without mutating original', () => {
    const f = makeFinding({ confidence: 'low', severity: 'major' });
    const original = { ...f };
    classifyFindings([f]);
    assert.equal(f.confidence, original.confidence);
    assert.ok(!('suppressReason' in f));
  });

  it('does not collapse multiple findings with ruleId=unknown (BUG-1)', () => {
    const f1 = makeFinding({ ruleId: 'unknown', file: 'src/a.mjs' });
    const f2 = makeFinding({ ruleId: 'unknown', file: 'src/b.mjs' });
    const f3 = makeFinding({ ruleId: 'unknown', file: 'src/c.mjs' });
    const { overview, suppressed } = classifyFindings([f1, f2, f3]);
    assert.equal(
      overview.length +
        suppressed.filter((f) => f.suppressReason === SUPPRESS_REASONS.DUPLICATE).length,
      3
    );
    assert.equal(
      suppressed.filter((f) => f.suppressReason === SUPPRESS_REASONS.DUPLICATE).length,
      0
    );
  });

  it('does not collapse same-file findings with ruleId=unknown (BUG-1 file-level)', () => {
    const f1 = makeFinding({ ruleId: 'unknown', file: 'src/a.mjs' });
    const f2 = makeFinding({ ruleId: 'unknown', file: 'src/a.mjs' });
    const { suppressed } = classifyFindings([f1, f2]);
    assert.equal(
      suppressed.filter((f) => f.suppressReason === SUPPRESS_REASONS.DUPLICATE).length,
      0
    );
  });

  it('does not suppress critical findings with short evidence (BUG-2)', () => {
    const f = makeFinding({ severity: 'critical', evidence: ['short'] });
    const { overview, suppressed } = classifyFindings([f]);
    assert.equal(overview.length, 1);
    assert.equal(suppressed.length, 0);
  });

  it('does not suppress critical findings with empty evidence (BUG-2)', () => {
    const f = makeFinding({ severity: 'critical', evidence: [] });
    const { overview } = classifyFindings([f]);
    assert.equal(overview.length, 1);
  });
});
