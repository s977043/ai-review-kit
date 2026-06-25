/**
 * Adversarial regression set for mergeFindings (Epic #1171 item5).
 *
 * Locks in the cross-reviewer merge contract so #1170 F2 (non-transitive merge)
 * and fingerprint-tolerance regressions cannot silently return:
 *   - connected-components: A–B–C chains collapse into one cluster (order-free)
 *   - severity = max of cluster
 *   - evidence = deduplicated union
 *   - agreement = collected set of reviewer roles (NOT a majority vote)
 *   - line-shift tolerance (±2) and message-drift tolerance (edit-distance ≤ 10)
 *
 * Fixtures: tests/fixtures/review-team-adversarial/cases.json
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mergeFindings } from '../src/lib/reviewer-orchestrator.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(
  readFileSync(join(here, 'fixtures', 'review-team-adversarial', 'cases.json'), 'utf8')
);

const sorted = (a) => [...a].sort();

describe('mergeFindings — adversarial set (#1171 item5)', () => {
  test('transitive A–B–C chain collapses into ONE cluster (#1170 F2)', () => {
    const input = CASES.transitiveChain.findings;
    const merged = mergeFindings(input);
    assert.equal(merged.length, 1, 'chain must form a single cluster');
    // severity = max across the chain (minor + major + critical → critical)
    assert.equal(merged[0].severity, 'critical');
    // evidence = union of all three
    assert.deepEqual(sorted(merged[0].evidence), ['e-a', 'e-b', 'e-c']);
    // agreement = all three reviewer roles
    assert.deepEqual(sorted(merged[0].agreement), [
      'bug-hunter',
      'perf-auditor',
      'security-scanner',
    ]);
  });

  test('transitive merge is order-independent', () => {
    const input = CASES.transitiveChain.findings;
    const reversed = [...input].reverse();
    const merged = mergeFindings(reversed);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].severity, 'critical');
    // severity/evidence/agreement must be invariant under input order.
    assert.deepEqual(sorted(merged[0].evidence), ['e-a', 'e-b', 'e-c']);
    assert.deepEqual(sorted(merged[0].agreement), [
      'bug-hunter',
      'perf-auditor',
      'security-scanner',
    ]);
  });

  test('line-shift within ±2 merges; a 3-line gap does not', () => {
    const within = mergeFindings(CASES.lineShiftTolerance.withinTolerance);
    assert.equal(within.length, 1, '2-line shift should merge');

    const beyond = mergeFindings(CASES.lineShiftTolerance.beyondTolerance);
    assert.equal(beyond.length, 2, '3-line gap should NOT merge');
  });

  test('message drift within edit-distance ≤ 10 merges; large drift does not', () => {
    const small = mergeFindings(CASES.messageDrift.smallDrift);
    assert.equal(small.length, 1, 'singular/plural drift should merge');

    const large = mergeFindings(CASES.messageDrift.largeDrift);
    assert.equal(large.length, 2, 'unrelated messages must not merge');
  });

  test('cluster takes max severity and deduplicated evidence union', () => {
    const merged = mergeFindings(CASES.severityMaxAndEvidenceUnion.findings);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].severity, 'critical', 'minor + critical → critical');
    assert.deepEqual(sorted(merged[0].evidence), ['log-1', 'log-2', 'shared'], 'union, deduped');
  });

  test('agreement is the collected role set, not a majority vote', () => {
    const merged = mergeFindings(CASES.agreementNonMajority.findings);
    // Two cache.mjs findings merge; the solo other.mjs finding stays separate.
    assert.equal(merged.length, 2);

    const cluster = merged.find((f) => f.file === 'src/cache.mjs');
    assert.ok(cluster, 'should find merged cluster for src/cache.mjs');
    assert.deepEqual(sorted(cluster.agreement), ['bug-hunter', 'security-scanner']);

    const solo = merged.find((f) => f.file === 'src/other.mjs');
    assert.ok(solo, 'should find solo finding for src/other.mjs');
    assert.deepEqual(
      solo.agreement,
      ['perf-auditor'],
      'a 1-of-3 finding still records its single role'
    );
  });

  test('empty input → empty output', () => {
    assert.deepEqual(mergeFindings([]), []);
  });

  describe('consensusLevel', () => {
    test('single: passthrough finding with no agreement → consensusLevel "single"', () => {
      const merged = mergeFindings([
        {
          file: 'src/a.mjs',
          line: 10,
          message: 'solo finding',
          severity: 'minor',
          reviewerRole: 'bug-hunter',
        },
      ]);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].consensusLevel, 'single');
    });

    test('single: passthrough finding with 1 agreement role → consensusLevel "single"', () => {
      const merged = mergeFindings([
        {
          file: 'src/b.mjs',
          line: 20,
          message: 'one reviewer',
          severity: 'info',
          reviewerRole: 'test-gap',
          agreement: ['test-gap'],
        },
      ]);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].consensusLevel, 'single');
    });

    test('multi: 2 reviewers flag same location → consensusLevel "multi"', () => {
      const merged = mergeFindings([
        {
          file: 'src/c.mjs',
          line: 30,
          message: 'duplicate finding',
          severity: 'major',
          reviewerRole: 'bug-hunter',
        },
        {
          file: 'src/c.mjs',
          line: 30,
          message: 'duplicate finding',
          severity: 'minor',
          reviewerRole: 'security-scanner',
        },
      ]);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].consensusLevel, 'multi');
    });

    test('consensus: 3+ reviewers flag same location → consensusLevel "consensus"', () => {
      const merged = mergeFindings([
        {
          file: 'src/d.mjs',
          line: 40,
          message: 'triple finding',
          severity: 'major',
          reviewerRole: 'bug-hunter',
        },
        {
          file: 'src/d.mjs',
          line: 40,
          message: 'triple finding',
          severity: 'major',
          reviewerRole: 'security-scanner',
        },
        {
          file: 'src/d.mjs',
          line: 40,
          message: 'triple finding',
          severity: 'minor',
          reviewerRole: 'test-gap',
        },
      ]);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].consensusLevel, 'consensus');
    });

    test('passthrough (no duplication) still has consensusLevel attached', () => {
      const merged = mergeFindings([
        {
          file: 'src/e.mjs',
          line: 50,
          message: 'unique A',
          severity: 'info',
          reviewerRole: 'bug-hunter',
        },
        {
          file: 'src/f.mjs',
          line: 60,
          message: 'unique B',
          severity: 'major',
          reviewerRole: 'security-scanner',
        },
      ]);
      assert.equal(merged.length, 2);
      for (const f of merged) {
        assert.ok('consensusLevel' in f, `consensusLevel missing from finding in ${f.file}`);
        assert.equal(f.consensusLevel, 'single');
      }
    });

    test('consensusLevel does not affect severity (no auto-escalation)', () => {
      // 3 reviewers agree → consensus, but severity stays at the max of inputs
      const merged = mergeFindings([
        {
          file: 'src/g.mjs',
          line: 70,
          message: 'minor issue',
          severity: 'minor',
          reviewerRole: 'bug-hunter',
        },
        {
          file: 'src/g.mjs',
          line: 70,
          message: 'minor issue',
          severity: 'minor',
          reviewerRole: 'security-scanner',
        },
        {
          file: 'src/g.mjs',
          line: 70,
          message: 'minor issue',
          severity: 'info',
          reviewerRole: 'test-gap',
        },
      ]);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].consensusLevel, 'consensus');
      assert.equal(merged[0].severity, 'minor', 'severity must NOT be escalated by consensusLevel');
    });
  });
});
