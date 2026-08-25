import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjudicateFindings,
  classifyFindings,
  prefilterFindings,
  rankFindingsForOutput,
  SUPPRESS_REASONS,
} from '../src/lib/finding-factory.mjs';

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
    const { overview, suppressed, overflow } = classifyFindings(findings, { reviewMode: 'medium' });
    assert.equal(overview.length, 5);
    // #1857 / ADR-007: the cap overflow is a ranking outcome, not a disposition.
    assert.equal(overflow.length, 3);
    assert.deepEqual(suppressed, []);
    for (const f of overflow) assert.ok(!('suppressReason' in f));
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

// ---------------------------------------------------------------------------
// #1857 Phase 1: the three stages, exercised directly rather than through the
// facade. Each block asserts the stage's OWN responsibility and, just as
// importantly, that it does NOT perform the neighbouring stage's job — that
// negative half is what keeps the split from silently collapsing back.
// Expectations are written as literals; none is read back from the
// implementation (see the header of tests/prompt-sections.test.mjs).
// ---------------------------------------------------------------------------

describe('prefilterFindings', () => {
  it('retains a finding that trips none of the four rules', () => {
    const { retained, suppressed } = prefilterFindings([makeFinding({ id: 'p-1' })]);
    assert.deepEqual(
      retained.map((f) => f.id),
      ['p-1']
    );
    assert.deepEqual(suppressed, []);
  });

  it('suppresses low_confidence non-critical and keeps low_confidence critical', () => {
    const low = makeFinding({ id: 'p-2', confidence: 'low', severity: 'major' });
    const crit = makeFinding({ id: 'p-3', confidence: 'low', severity: 'critical' });
    const { retained, suppressed } = prefilterFindings([low, crit]);
    assert.deepEqual(
      retained.map((f) => f.id),
      ['p-3']
    );
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].id, 'p-2');
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.LOW_CONFIDENCE);
  });

  it('suppresses insufficient_evidence at fewer than 30 chars, and keeps 30', () => {
    const short = makeFinding({ id: 'p-4', evidence: ['x'.repeat(29)] });
    const exact = makeFinding({ id: 'p-5', ruleId: 'other-rule', evidence: ['x'.repeat(30)] });
    const { retained, suppressed } = prefilterFindings([short, exact]);
    assert.deepEqual(
      retained.map((f) => f.id),
      ['p-5']
    );
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.INSUFFICIENT_EVIDENCE);
  });

  it('suppresses style_only for minor severity with a style-ish ruleId', () => {
    const f = makeFinding({ id: 'p-6', severity: 'minor', ruleId: 'readability-naming' });
    const { retained, suppressed } = prefilterFindings([f]);
    assert.deepEqual(retained, []);
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.STYLE_ONLY);
  });

  it('suppresses the second occurrence of a ruleId as duplicate', () => {
    const f1 = makeFinding({ id: 'p-7', ruleId: 'null-check', file: 'src/a.mjs' });
    const f2 = makeFinding({ id: 'p-8', ruleId: 'null-check', file: 'src/b.mjs' });
    const { retained, suppressed } = prefilterFindings([f1, f2]);
    assert.deepEqual(
      retained.map((f) => f.id),
      ['p-7']
    );
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].id, 'p-8');
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.DUPLICATE);
  });

  it('does NOT apply the overview cap (that is rankFindingsForOutput’s job)', () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      makeFinding({ id: `p-cap-${i}`, ruleId: `rule-${i}` })
    );
    const { retained, suppressed } = prefilterFindings(findings);
    assert.equal(retained.length, 10);
    assert.deepEqual(suppressed, []);
  });

  it('does not mutate the input findings', () => {
    const f = makeFinding({ id: 'p-9', confidence: 'low', severity: 'major' });
    prefilterFindings([f]);
    assert.ok(!('suppressReason' in f));
    assert.equal(f.confidence, 'low');
  });
});

describe('adjudicateFindings', () => {
  it('is the identity pass in Phase 1: every finding is retained, none suppressed', () => {
    const findings = [makeFinding({ id: 'a-1' }), makeFinding({ id: 'a-2', ruleId: 'other' })];
    const { retained, suppressed } = adjudicateFindings(findings);
    assert.deepEqual(
      retained.map((f) => f.id),
      ['a-1', 'a-2']
    );
    assert.deepEqual(suppressed, []);
  });

  it('retains a critical finding untouched (ADR-007 fail-safe direction)', () => {
    const f = makeFinding({ id: 'a-3', severity: 'critical', confidence: 'low', evidence: [] });
    const { retained, suppressed } = adjudicateFindings([f]);
    assert.equal(retained.length, 1);
    assert.equal(retained[0], f);
    assert.deepEqual(suppressed, []);
  });

  it('returns a fresh array rather than aliasing the input', () => {
    const findings = [makeFinding({ id: 'a-4' })];
    const { retained } = adjudicateFindings(findings);
    assert.notEqual(retained, findings);
  });

  it('handles an empty input', () => {
    const { retained, suppressed } = adjudicateFindings([]);
    assert.deepEqual(retained, []);
    assert.deepEqual(suppressed, []);
  });
});

describe('rankFindingsForOutput', () => {
  it('caps the overview at 5 in medium mode and reports the overflow', () => {
    const findings = Array.from({ length: 8 }, (_, i) =>
      makeFinding({ id: `r-${i}`, ruleId: `rule-${i}` })
    );
    const { overview, suppressed, overflow } = rankFindingsForOutput(findings, {
      reviewMode: 'medium',
    });
    assert.equal(overview.length, 5);
    assert.equal(overflow.length, 3);
    // #1857 / ADR-007: the cap is a ranking outcome, so nothing is suppressed
    // and no reason code is minted for it.
    assert.deepEqual(suppressed, []);
    for (const f of overflow) assert.ok(!('suppressReason' in f));
  });

  it('returns the ORIGINAL finding objects in overflow, like overview', () => {
    const findings = Array.from({ length: 6 }, (_, i) =>
      makeFinding({ id: `r-orig-${i}`, ruleId: `rule-orig-${i}`, severity: 'major' })
    );
    const { overview, overflow } = rankFindingsForOutput(findings, { reviewMode: 'medium' });
    const returned = new Set([...overview, ...overflow]);
    assert.equal(overflow.length, 1);
    for (const f of findings) assert.ok(returned.has(f));
  });

  it('accounts for every input finding across overview / suppressed / overflow', () => {
    const findings = [
      ...Array.from({ length: 7 }, (_, i) =>
        makeFinding({ id: `r-acc-${i}`, ruleId: `rule-${i}` })
      ),
      makeFinding({ id: 'r-acc-dup', ruleId: 'rule-0' }),
    ];
    const { overview, suppressed, overflow } = rankFindingsForOutput(findings, {
      reviewMode: 'medium',
    });
    assert.deepEqual(
      [...overview, ...suppressed, ...overflow].map((f) => f.id).sort(),
      findings.map((f) => f.id).sort()
    );
  });

  it('caps at 3 in tiny mode, 8 in large mode, and 5 with no mode given', () => {
    const findings = Array.from({ length: 12 }, (_, i) =>
      makeFinding({ id: `r2-${i}`, ruleId: `rule-${i}` })
    );
    assert.equal(rankFindingsForOutput(findings, { reviewMode: 'tiny' }).overview.length, 3);
    assert.equal(rankFindingsForOutput(findings, { reviewMode: 'large' }).overview.length, 8);
    assert.equal(rankFindingsForOutput(findings).overview.length, 5);
  });

  it('orders the overview by descending composite score', () => {
    const info = makeFinding({ id: 'r-info', ruleId: 'rule-info', severity: 'info' });
    const critical = makeFinding({ id: 'r-crit', ruleId: 'rule-crit', severity: 'critical' });
    const { overview } = rankFindingsForOutput([info, critical]);
    assert.deepEqual(
      overview.map((f) => f.id),
      ['r-crit', 'r-info']
    );
  });

  it('does NOT apply the prefilter rules (that is prefilterFindings’s job)', () => {
    const lowConfidence = makeFinding({ id: 'r-low', confidence: 'low', severity: 'major' });
    const shortEvidence = makeFinding({
      id: 'r-short',
      ruleId: 'other-rule',
      evidence: ['short'],
    });
    const { overview, suppressed, overflow } = rankFindingsForOutput([
      lowConfidence,
      shortEvidence,
    ]);
    assert.equal(overview.length, 2);
    assert.deepEqual(suppressed, []);
    assert.deepEqual(overflow, []);
  });

  it('collapses a repeated ruleId as a DUPLICATE disposition, not as overflow', () => {
    const f1 = makeFinding({ id: 'r-d1', ruleId: 'null-check' });
    const f2 = makeFinding({ id: 'r-d2', ruleId: 'null-check' });
    const { overview, suppressed, overflow } = rankFindingsForOutput([f1, f2]);
    assert.equal(overview.length, 1);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].id, 'r-d2');
    assert.equal(suppressed[0].suppressReason, SUPPRESS_REASONS.DUPLICATE);
    assert.deepEqual(overflow, []);
    // Cross-check against the production path that already owns this concept:
    // the reason string must be the SAME one prefilterFindings mints for the
    // same duplicate pair, not a parallel value that merely looks equivalent.
    const viaPrefilter = prefilterFindings([f1, f2]).suppressed;
    assert.equal(viaPrefilter.length, 1);
    assert.equal(suppressed[0].suppressReason, viaPrefilter[0].suppressReason);
  });

  // #1857 nit 2: the cross-check above compares two call sites that BOTH read
  // `SUPPRESS_REASONS.DUPLICATE`, so editing the constant moves both sides and
  // stays green. The value is persisted into `.river/runs/*.json` and is read
  // back by later tooling, so the literal itself is a compatibility contract and
  // is pinned here as a golden string.
  it('writes the literal string "duplicate", which run records persist', () => {
    const f1 = makeFinding({ id: 'r-g1', ruleId: 'null-check' });
    const f2 = makeFinding({ id: 'r-g2', ruleId: 'null-check' });
    const { suppressed } = rankFindingsForOutput([f1, f2]);
    assert.equal(suppressed[0].suppressReason, 'duplicate');
    assert.equal(SUPPRESS_REASONS.DUPLICATE, 'duplicate');
    // The retired code keeps its exact stored spelling too: records written
    // before the split still carry it and must stay readable.
    assert.equal(SUPPRESS_REASONS.COVERED_BY_HIGHER_LEVEL, 'covered_by_higher_level_finding');
  });

  it('does not mutate the input when collapsing a duplicate', () => {
    const f1 = makeFinding({ id: 'r-d3', ruleId: 'type-safety' });
    const f2 = makeFinding({ id: 'r-d4', ruleId: 'type-safety' });
    rankFindingsForOutput([f1, f2]);
    assert.ok(!('suppressReason' in f1));
    assert.ok(!('suppressReason' in f2));
  });

  it('always returns inlineCandidates as an empty array', () => {
    assert.deepEqual(rankFindingsForOutput([makeFinding()]).inlineCandidates, []);
  });
});

describe('classifyFindings facade composition (#1857 Phase 1)', () => {
  it('lists prefilter dispositions before the ranking overflow in suppressed', () => {
    const findings = [
      makeFinding({ id: 'f-low', ruleId: 'low-rule', confidence: 'low', severity: 'major' }),
      ...Array.from({ length: 8 }, (_, i) => makeFinding({ id: `f-${i}`, ruleId: `rule-${i}` })),
    ];
    const { overview, suppressed, overflow } = classifyFindings(findings, { reviewMode: 'medium' });
    assert.equal(overview.length, 5);
    assert.deepEqual(
      suppressed.map((f) => f.suppressReason),
      [SUPPRESS_REASONS.LOW_CONFIDENCE]
    );
    assert.equal(overflow.length, 3);
  });

  it('separates the duplicate disposition from the ranking overflow', () => {
    const findings = [
      ...Array.from({ length: 7 }, (_, i) => makeFinding({ id: `g-${i}`, ruleId: `rule-${i}` })),
      makeFinding({ id: 'g-dup', ruleId: 'rule-0' }),
    ];
    const { suppressed, overflow } = classifyFindings(findings, { reviewMode: 'medium' });
    assert.deepEqual(
      suppressed.map((f) => f.suppressReason),
      [SUPPRESS_REASONS.DUPLICATE]
    );
    assert.equal(suppressed[0].id, 'g-dup');
    assert.equal(overflow.length, 2);
    for (const f of overflow) assert.ok(!('suppressReason' in f));
  });

  it('never mints covered_by_higher_level_finding any more (#1857 / ADR-007)', () => {
    const findings = [
      ...Array.from({ length: 9 }, (_, i) => makeFinding({ id: `h-${i}`, ruleId: `rule-${i}` })),
      makeFinding({ id: 'h-dup', ruleId: 'rule-1' }),
      makeFinding({ id: 'h-low', ruleId: 'low-rule', confidence: 'low', severity: 'major' }),
    ];
    for (const reviewMode of ['tiny', 'medium', 'large']) {
      const { suppressed } = classifyFindings(findings, { reviewMode });
      assert.equal(
        suppressed.filter((f) => f.suppressReason === SUPPRESS_REASONS.COVERED_BY_HIGHER_LEVEL)
          .length,
        0,
        `reviewMode=${reviewMode}`
      );
    }
  });

  it('accounts for every input finding across overview / suppressed / overflow', () => {
    const findings = [
      ...Array.from({ length: 9 }, (_, i) => makeFinding({ id: `k-${i}`, ruleId: `rule-${i}` })),
      makeFinding({ id: 'k-dup', ruleId: 'rule-2' }),
      makeFinding({ id: 'k-low', ruleId: 'low-rule', confidence: 'low', severity: 'major' }),
    ];
    const { overview, suppressed, overflow } = classifyFindings(findings, { reviewMode: 'medium' });
    assert.deepEqual(
      [...overview, ...suppressed, ...overflow].map((f) => f.id).sort(),
      findings.map((f) => f.id).sort()
    );
  });
});
