import assert from 'node:assert/strict';
import test from 'node:test';

import { applySuppressions } from '../src/lib/suppression-apply.mjs';
import {
  findActiveSuppressions,
  formatUnparseableExpiresAtWarning,
} from '../src/lib/suppression.mjs';

const FP_A = 'a'.repeat(16);
const FP_B = 'b'.repeat(16);
const FP_C = 'c'.repeat(16);

function suppressionFor(fingerprint, contextOverride = {}) {
  return {
    id: 'suppression-' + fingerprint + '-1',
    type: 'suppression',
    content: 'rationale',
    metadata: { createdAt: '2026-04-01T00:00:00Z', author: 't', tags: ['suppression', 'active'] },
    context: { scope: 'file', active: true, fingerprint, ...contextOverride },
  };
}

function findingFor(fingerprint, severity, extra = {}) {
  return {
    id: 'f-' + fingerprint,
    fingerprint,
    severity,
    message: 'msg',
    file: 'src/x.ts',
    ...extra,
  };
}

test('applySuppressions returns inputs unchanged when no suppressions are loaded', () => {
  const findings = [findingFor(FP_A, 'minor')];
  const r = applySuppressions(findings, { suppressions: [] });
  assert.equal(r.keptFindings.length, 1);
  assert.equal(r.keptFindings[0], findings[0]); // identity preserved
  assert.equal(r.suppressedFindings.length, 0);
  assert.equal(r.applied.length, 0);
});

test('applySuppressions returns inputs unchanged when memoryContext is null/undefined', () => {
  const findings = [findingFor(FP_A, 'minor')];
  for (const ctx of [null, undefined, {}]) {
    const r = applySuppressions(findings, ctx);
    assert.equal(r.keptFindings.length, 1);
    assert.equal(r.suppressedFindings.length, 0);
    assert.equal(r.applied.length, 0);
  }
});

test('applySuppressions auto-suppresses minor finding with matching fingerprint', () => {
  const findings = [findingFor(FP_A, 'minor')];
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'false_positive' })],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.keptFindings.length, 0);
  assert.equal(r.suppressedFindings.length, 1);
  assert.equal(r.suppressedFindings[0].status, 'suppressed');
  assert.equal(r.suppressedFindings[0].suppressionRef, 'suppression-' + FP_A + '-1');
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].action, 'suppressed');
  assert.equal(r.applied[0].fingerprint, FP_A);
  assert.equal(r.applied[0].feedbackType, 'false_positive');
});

test('applySuppressions auto-suppresses info finding too', () => {
  const findings = [findingFor(FP_A, 'info')];
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'not_relevant' })],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.suppressedFindings.length, 1);
  assert.equal(r.applied[0].action, 'suppressed');
});

test('applySuppressions skips major finding when feedbackType is false_positive', () => {
  const findings = [findingFor(FP_A, 'major')];
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'false_positive' })],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.keptFindings.length, 1);
  assert.equal(r.suppressedFindings.length, 0);
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].action, 'skipped');
  assert.equal(r.applied[0].reason, 'high-severity-requires-accepted-risk');
});

test('applySuppressions skips critical finding when feedbackType is wont_fix', () => {
  const findings = [findingFor(FP_A, 'critical')];
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'wont_fix' })],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.keptFindings.length, 1);
  assert.equal(r.applied[0].action, 'skipped');
});

test('applySuppressions auto-suppresses major finding when feedbackType is accepted_risk', () => {
  const findings = [findingFor(FP_A, 'major')];
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'accepted_risk' })],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.keptFindings.length, 0);
  assert.equal(r.suppressedFindings.length, 1);
  assert.equal(r.applied[0].action, 'suppressed');
  assert.equal(r.applied[0].feedbackType, 'accepted_risk');
});

test('applySuppressions auto-suppresses critical finding when feedbackType is accepted_risk', () => {
  const findings = [findingFor(FP_A, 'critical')];
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'accepted_risk' })],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.suppressedFindings.length, 1);
  assert.equal(r.applied[0].action, 'suppressed');
});

test('applySuppressions respects per-suppression minSeverityToAutoSuppress cap', () => {
  // Suppression caps auto-suppression at `minor`. A `major` finding stays
  // even though the global P1 guard would *also* reject it; we still want
  // the cap to be the explicit reason recorded in `applied`.
  const findings = [findingFor(FP_A, 'major', { severity: 'major' })];
  const memoryContext = {
    suppressions: [
      suppressionFor(FP_A, {
        feedbackType: 'accepted_risk', // would normally allow even major
        minSeverityToAutoSuppress: 'minor',
      }),
    ],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.keptFindings.length, 1);
  assert.equal(r.applied[0].action, 'skipped');
  assert.equal(r.applied[0].reason, 'severity-above-min-severity-cap');
});

test('applySuppressions per-suppression cap allows below-cap severity', () => {
  const findings = [findingFor(FP_A, 'minor')];
  const memoryContext = {
    suppressions: [
      suppressionFor(FP_A, { feedbackType: 'false_positive', minSeverityToAutoSuppress: 'minor' }),
    ],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.suppressedFindings.length, 1);
  assert.equal(r.applied[0].action, 'suppressed');
});

test('applySuppressions ignores suppressions that lack a 16-hex fingerprint', () => {
  // Pre-#687 PR-A entries only carried `findingHash` — they cannot gate
  // findings safely so they must be ignored entirely.
  const findings = [findingFor(FP_A, 'minor')];
  const legacy = {
    id: 'suppression-legacy-1',
    type: 'suppression',
    content: 'r',
    metadata: { createdAt: '2026-01-01T00:00:00Z', author: 't' },
    context: { scope: 'file', active: true, findingHash: FP_A }, // no fingerprint
  };
  const r = applySuppressions(findings, { suppressions: [legacy] });
  assert.equal(r.keptFindings.length, 1);
  assert.equal(r.suppressedFindings.length, 0);
  assert.equal(r.applied.length, 0);
});

test('applySuppressions leaves findings without a fingerprint untouched', () => {
  const findings = [{ id: 'f1', severity: 'minor', message: 'msg' }]; // no fingerprint
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'false_positive' })],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.keptFindings.length, 1);
  assert.equal(r.suppressedFindings.length, 0);
  assert.equal(r.applied.length, 0);
});

test('applySuppressions leaves findings whose fingerprint does not match any suppression', () => {
  const findings = [findingFor(FP_B, 'minor')];
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'false_positive' })],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.keptFindings.length, 1);
  assert.equal(r.applied.length, 0);
});

test('applySuppressions bypasses entirely when config.memory.suppressionEnabled is false', () => {
  const findings = [findingFor(FP_A, 'minor')];
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'false_positive' })],
  };
  const r = applySuppressions(findings, memoryContext, {
    config: { memory: { suppressionEnabled: false } },
  });
  assert.equal(r.keptFindings.length, 1);
  assert.equal(r.suppressedFindings.length, 0);
  assert.equal(r.applied.length, 0);
});

test('applySuppressions is enabled by default (suppressionEnabled !== false)', () => {
  const findings = [findingFor(FP_A, 'minor')];
  const memoryContext = {
    suppressions: [suppressionFor(FP_A, { feedbackType: 'false_positive' })],
  };
  const r = applySuppressions(findings, memoryContext, { config: {} });
  assert.equal(r.suppressedFindings.length, 1);
});

test('applySuppressions handles a mix of matched, P1-guarded, and unmatched findings', () => {
  const findings = [
    findingFor(FP_A, 'minor'), // suppressed (false_positive ok for minor)
    findingFor(FP_B, 'critical'), // skipped (false_positive not ok for critical)
    findingFor(FP_C, 'major'), // kept (no matching suppression)
    { id: 'f4', severity: 'info', message: 'no fp' }, // kept (no fingerprint)
  ];
  const memoryContext = {
    suppressions: [
      suppressionFor(FP_A, { feedbackType: 'false_positive' }),
      suppressionFor(FP_B, { feedbackType: 'false_positive' }),
    ],
  };
  const r = applySuppressions(findings, memoryContext);
  assert.equal(r.suppressedFindings.length, 1);
  assert.equal(r.suppressedFindings[0].fingerprint, FP_A);
  assert.equal(r.keptFindings.length, 3); // FP_B (skipped P1), FP_C (no match), f4 (no fp)
  assert.equal(r.applied.length, 2); // 1 suppressed, 1 skipped
  const skipped = r.applied.find((a) => a.action === 'skipped');
  assert.equal(skipped.fingerprint, FP_B);
  assert.equal(skipped.reason, 'high-severity-requires-accepted-risk');
});

// --- Expiry (#1802) ---------------------------------------------------------
//
// Regression table pinning the three expiresAt forms the production review
// path must distinguish, plus the unparseable form (#1746/#1780 fail-safe).
// `now` is injected so the rows stay deterministic.

const EXPIRY_NOW = new Date('2026-06-01T00:00:00Z');

const EXPIRY_CASES = [
  { name: 'expired expiresAt', expiresAt: '2026-01-01T00:00:00Z', suppresses: false },
  { name: 'future expiresAt', expiresAt: '2027-01-01T00:00:00Z', suppresses: true },
  { name: 'no expiresAt', expiresAt: undefined, suppresses: true },
];

for (const row of EXPIRY_CASES) {
  test(`applySuppressions expiry table: ${row.name} → ${row.suppresses ? 'suppresses' : 'does not suppress'}`, () => {
    const findings = [findingFor(FP_A, 'minor')];
    const contextOverride = { feedbackType: 'false_positive' };
    if (row.expiresAt !== undefined) contextOverride.expiresAt = row.expiresAt;
    const memoryContext = { suppressions: [suppressionFor(FP_A, contextOverride)] };
    const r = applySuppressions(findings, memoryContext, { now: EXPIRY_NOW, warn: () => {} });
    if (row.suppresses) {
      assert.equal(r.suppressedFindings.length, 1);
      assert.equal(r.keptFindings.length, 0);
      assert.equal(r.applied[0].action, 'suppressed');
    } else {
      assert.equal(r.suppressedFindings.length, 0);
      assert.equal(r.keptFindings.length, 1);
      assert.equal(r.applied.length, 1);
      assert.equal(r.applied[0].action, 'skipped');
      assert.equal(r.applied[0].reason, 'suppression-expired');
    }
  });
}

test('applySuppressions treats an unparseable expiresAt as expired and warns once (#1801 parity)', () => {
  // Two findings matching the same suppression: the warning must fire once
  // per suppression, not once per finding, matching findActiveSuppressions.
  const findings = [
    findingFor(FP_A, 'minor'),
    findingFor(FP_A, 'info', { id: 'f-second-' + FP_A }),
  ];
  const suppression = suppressionFor(FP_A, {
    feedbackType: 'false_positive',
    expiresAt: 'notadate',
  });
  const warnings = [];
  const r = applySuppressions(
    findings,
    { suppressions: [suppression] },
    { now: EXPIRY_NOW, warn: (m) => warnings.push(m) }
  );
  assert.equal(r.suppressedFindings.length, 0);
  assert.equal(r.keptFindings.length, 2);
  assert.deepEqual(
    r.applied.map((a) => a.reason),
    ['suppression-expired', 'suppression-expired']
  );
  assert.deepEqual(warnings, [
    formatUnparseableExpiresAtWarning({ id: suppression.id, expiresAt: 'notadate' }),
  ]);
});

test('applySuppressions expiry verdict matches findActiveSuppressions for the same suppressions (#1802)', () => {
  // Cross-check against the EXISTING production implementation of the active
  // decision, not a re-derivation: for each suppression, whether
  // findActiveSuppressions returns it must equal whether applySuppressions
  // lets it suppress a matching low-severity finding. A self-consistent test
  // (comparing applySuppressions against isSuppressionExpired only) would
  // pass even if the two paths diverged — this one cannot.
  const fingerprints = ['1'.repeat(16), '2'.repeat(16), '3'.repeat(16), '4'.repeat(16)];
  const variants = [
    { expiresAt: '2026-01-01T00:00:00Z' }, // expired
    { expiresAt: '2027-01-01T00:00:00Z' }, // in force
    {}, // no deadline
    { expiresAt: 'notadate' }, // unparseable → fail-safe expired
  ];
  const suppressions = variants.map((v, i) => {
    const s = suppressionFor(fingerprints[i], {
      feedbackType: 'false_positive',
      ...v,
    });
    // matchesScopeFiles requires non-empty relatedFiles even for the file
    // scope match to fire; align them with the filePaths passed below so the
    // scope dimension (which applySuppressions replaces with fingerprint
    // matching) is neutralized and only the expiry verdict can differ.
    s.metadata.relatedFiles = ['src/x.ts'];
    return s;
  });
  const index = { entries: suppressions };

  const activeIds = new Set(
    findActiveSuppressions(index, ['src/x.ts'], { warn: () => {} }).map((s) => s.id)
  );

  for (const s of suppressions) {
    const r = applySuppressions(
      [findingFor(s.context.fingerprint, 'minor')],
      { suppressions },
      { warn: () => {} }
    );
    const suppressedByApply = r.suppressedFindings.length === 1;
    assert.equal(
      suppressedByApply,
      activeIds.has(s.id),
      `verdict mismatch for ${s.id} (expiresAt=${JSON.stringify(s.context.expiresAt)}): ` +
        `findActiveSuppressions=${activeIds.has(s.id)} applySuppressions=${suppressedByApply}`
    );
  }
});

test('applySuppressions does not mutate the input arrays', () => {
  const findings = Object.freeze([findingFor(FP_A, 'minor')]);
  const memoryContext = Object.freeze({
    suppressions: Object.freeze([suppressionFor(FP_A, { feedbackType: 'false_positive' })]),
  });
  // Frozen arrays cannot be mutated; if applySuppressions tries it would throw.
  assert.doesNotThrow(() => applySuppressions(findings, memoryContext));
});
