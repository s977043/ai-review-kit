import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeFingerprint, annotateFingerprints } from '../src/lib/finding-factory.mjs';

function makeFinding(overrides = {}) {
  return {
    id: 'rr-1',
    ruleId: 'null-safety',
    file: 'src/foo.mjs',
    lineStart: 10,
    lineEnd: 10,
    title: 'Possible null dereference',
    message:
      'Finding: null-check Evidence: obj.foo called without guard Impact: crash Fix: add guard Severity: major Confidence: high',
    severity: 'major',
    confidence: 'high',
    status: 'open',
    evidence: ['obj.foo called without guard'],
    ...overrides,
  };
}

describe('computeFingerprint', () => {
  it('returns a 16-char hex string', () => {
    const fp = computeFingerprint(makeFinding());
    assert.match(fp, /^[0-9a-f]{16}$/);
  });

  it('is deterministic for same logical finding', () => {
    const f = makeFinding();
    assert.equal(computeFingerprint(f), computeFingerprint(f));
  });

  it('is stable when only lineStart changes (line shift tolerance)', () => {
    const f1 = makeFinding({ lineStart: 10, lineEnd: 10 });
    const f2 = makeFinding({ lineStart: 20, lineEnd: 20 });
    assert.equal(computeFingerprint(f1), computeFingerprint(f2));
  });

  it('differs when ruleId changes', () => {
    const f1 = makeFinding({ ruleId: 'null-safety' });
    const f2 = makeFinding({ ruleId: 'sql-injection' });
    assert.notEqual(computeFingerprint(f1), computeFingerprint(f2));
  });

  it('differs when file changes', () => {
    const f1 = makeFinding({ file: 'src/a.mjs' });
    const f2 = makeFinding({ file: 'src/b.mjs' });
    assert.notEqual(computeFingerprint(f1), computeFingerprint(f2));
  });

  it('differs when message changes substantially', () => {
    const f1 = makeFinding({ message: 'Finding: issue-A Evidence: context here' });
    const f2 = makeFinding({ message: 'Finding: issue-B Evidence: other context here' });
    assert.notEqual(computeFingerprint(f1), computeFingerprint(f2));
  });

  it('handles missing fields gracefully', () => {
    const fp = computeFingerprint({});
    assert.match(fp, /^[0-9a-f]{16}$/);
  });
});

describe('annotateFingerprints', () => {
  it('adds fingerprint field without mutating originals', () => {
    const f = makeFinding();
    const [annotated] = annotateFingerprints([f]);
    assert.ok('fingerprint' in annotated);
    assert.ok(!('fingerprint' in f), 'original must not be mutated');
  });

  it('returns same length array', () => {
    const findings = [makeFinding(), makeFinding({ ruleId: 'other' })];
    assert.equal(annotateFingerprints(findings).length, 2);
  });
});
