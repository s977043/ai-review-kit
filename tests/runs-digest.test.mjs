/**
 * Runs digest tests (Epic #1347 S3 / #1350 PR-B).
 *
 * Pure-function coverage of the supervision digest: decision distribution,
 * fallback-streak / circuit-breaker / observation-expiry / override-mismatch
 * warnings, and escape CANDIDATES (a reference list, never a rate — the
 * markdown must carry the attribution disclaimer).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildRunsDigest, formatDigestMarkdown } from '../src/lib/runs-digest.mjs';

const T0 = Date.parse('2026-07-01T00:00:00Z');
const hoursAfter = (h) => new Date(T0 + h * 3_600_000).toISOString();
const NOW = () => new Date(T0 + 200 * 3_600_000); // 200h after T0

function runRecord({
  runId,
  hours = 0,
  decision = 'GO',
  reasonCode = 'CONVERGED_CLEAN',
  humanApprovalMode = null,
  maxConsecutiveAutoGo = 5,
  observation = null,
  changedFiles = [],
  findings = [],
  override = null,
}) {
  return {
    runId,
    timestamp: hoursAfter(hours),
    changedFiles,
    findings,
    ...(override ? { override } : {}),
    gate: {
      decision,
      reasonCode,
      tier: decision === 'ESCALATE' ? 'cliff' : 'field',
      inputs: { humanApprovalMode },
      inputsHash: 'aaaaaaaaaaaaaaaa',
      configSnapshot: { expiresInHours: 72, maxConsecutiveAutoGo },
      ...(observation ? { observation } : {}),
      schemaVersion: '1',
    },
  };
}

describe('buildRunsDigest', () => {
  test('aggregates decision distribution and auto-GO share', () => {
    const d = buildRunsDigest(
      [
        runRecord({ runId: 'a', hours: 0, decision: 'GO' }),
        runRecord({ runId: 'b', hours: 1, decision: 'NO_GO', reasonCode: 'BLOCKING_FINDINGS' }),
        runRecord({
          runId: 'c',
          hours: 2,
          decision: 'ESCALATE',
          reasonCode: 'GATE_CONFIG_CHANGED',
        }),
        runRecord({
          runId: 'd',
          hours: 3,
          decision: 'GO_WITH_OBSERVATION',
          reasonCode: 'MINOR_FINDINGS_OBSERVE',
        }),
      ],
      { now: NOW }
    );
    assert.equal(d.runsWithGate, 4);
    assert.equal(d.decisions.GO, 1);
    assert.equal(d.autoGoShare, 0.5);
    assert.deepEqual(d.escalateReasons, { GATE_CONFIG_CHANGED: 1 });
  });

  test('warns on a regex-fallback streak (silently disabled LOW tier)', () => {
    const runs = [1, 2, 3].map((i) =>
      runRecord({ runId: `r${i}`, hours: i, humanApprovalMode: 'regex-fallback' })
    );
    const d = buildRunsDigest(runs, { now: NOW });
    assert.ok(d.warnings.some((w) => w.kind === 'regex-fallback-streak'));
    // below threshold → no warning
    const d2 = buildRunsDigest(runs.slice(0, 2), { now: NOW });
    assert.ok(!d2.warnings.some((w) => w.kind === 'regex-fallback-streak'));
  });

  test('a RESOLVED streak (checkpoint happened) does not warn forever (M2)', () => {
    const runs = [
      ...[1, 2, 3].map((i) =>
        runRecord({ runId: `g${i}`, hours: i, decision: 'GO', maxConsecutiveAutoGo: 2 })
      ),
      // human checkpoint happened — the streak is broken
      runRecord({
        runId: 'esc',
        hours: 4,
        decision: 'ESCALATE',
        reasonCode: 'RISK_MAP_HUMAN_REVIEW',
      }),
      runRecord({ runId: 'after', hours: 5, decision: 'GO', maxConsecutiveAutoGo: 2 }),
    ];
    const d = buildRunsDigest(runs, { now: NOW });
    assert.ok(
      !d.warnings.some((w) => w.kind === 'circuit-breaker-exceeded'),
      'past streaks must not cry wolf after a checkpoint'
    );
    const fallbackRuns = [
      ...[1, 2, 3].map((i) =>
        runRecord({ runId: `f${i}`, hours: i, humanApprovalMode: 'regex-fallback' })
      ),
      runRecord({ runId: 'ok', hours: 4, humanApprovalMode: 'llm-adjudicated' }),
    ];
    const d2 = buildRunsDigest(fallbackRuns, { now: NOW });
    assert.ok(!d2.warnings.some((w) => w.kind === 'regex-fallback-streak'));
  });

  test('warns when consecutive auto-GO exceeds the advisory circuit breaker', () => {
    const runs = [1, 2, 3].map((i) =>
      runRecord({ runId: `g${i}`, hours: i, decision: 'GO', maxConsecutiveAutoGo: 2 })
    );
    const d = buildRunsDigest(runs, { now: NOW });
    assert.ok(d.warnings.some((w) => w.kind === 'circuit-breaker-exceeded'));
  });

  test('lists expired observation windows (unreviewed changes)', () => {
    const d = buildRunsDigest(
      [
        runRecord({
          runId: 'obs',
          hours: 0, // now is 200h later, window is 72h
          decision: 'GO_WITH_OBSERVATION',
          observation: { expiresInHours: 72, onExpiry: 'stop', files: ['a.mjs'] },
        }),
      ],
      { now: NOW }
    );
    assert.equal(d.expiredObservations.length, 1);
    assert.ok(d.warnings.some((w) => w.kind === 'observation-expired'));
  });

  test('escape candidates: GO run followed by new blocking finding on overlapping files', () => {
    const d = buildRunsDigest(
      [
        runRecord({
          runId: 'x',
          hours: 0,
          decision: 'GO',
          changedFiles: ['src/db.mjs'],
          findings: [],
        }),
        runRecord({
          runId: 'y',
          hours: 1,
          decision: 'NO_GO',
          reasonCode: 'BLOCKING_FINDINGS',
          changedFiles: ['src/db.mjs'],
          findings: [
            {
              ruleId: 'sec-1',
              file: 'src/db.mjs',
              message: 'SQL injection',
              severity: 'critical',
              title: 'SQLi',
            },
          ],
        }),
      ],
      { now: NOW }
    );
    assert.equal(d.escapeCandidates.length, 1);
    assert.equal(d.escapeCandidates[0].goRunId, 'x');
  });

  test('no escape candidate without file overlap', () => {
    const d = buildRunsDigest(
      [
        runRecord({ runId: 'x', hours: 0, decision: 'GO', changedFiles: ['a.mjs'] }),
        runRecord({
          runId: 'y',
          hours: 1,
          decision: 'NO_GO',
          reasonCode: 'BLOCKING_FINDINGS',
          changedFiles: ['b.mjs'],
          findings: [{ ruleId: 'r', file: 'b.mjs', message: 'x', severity: 'major', title: 't' }],
        }),
      ],
      { now: NOW }
    );
    assert.equal(d.escapeCandidates.length, 0);
  });

  test('override entries are surfaced and hash mismatches warn', () => {
    const d = buildRunsDigest(
      [
        runRecord({
          runId: 'o1',
          hours: 0,
          decision: 'ESCALATE',
          reasonCode: 'RISK_MAP_HUMAN_REVIEW',
          override: {
            actor: 'alice',
            timestamp: hoursAfter(1),
            gateInputsHash: 'aaaaaaaaaaaaaaaa',
          },
        }),
        runRecord({
          runId: 'o2',
          hours: 2,
          decision: 'ESCALATE',
          reasonCode: 'RISK_MAP_HUMAN_REVIEW',
          override: {
            actor: 'mallory',
            timestamp: hoursAfter(3),
            gateInputsHash: 'bbbbbbbbbbbbbbbb',
          },
        }),
      ],
      { now: NOW }
    );
    assert.equal(d.overrides.length, 2);
    assert.equal(d.overrides[0].gateInputsHashMatch, true);
    assert.equal(d.overrides[1].gateInputsHashMatch, false);
    assert.ok(d.warnings.some((w) => w.kind === 'override-hash-mismatch'));
  });

  test('records without gate are counted but excluded from gate stats', () => {
    const d = buildRunsDigest(
      [
        { runId: 'legacy', timestamp: hoursAfter(0), findings: [] },
        runRecord({ runId: 'g', hours: 1 }),
      ],
      { now: NOW }
    );
    assert.equal(d.totalRuns, 2);
    assert.equal(d.runsWithGate, 1);
  });
});

describe('formatDigestMarkdown', () => {
  test('renders warnings, the escape disclaimer, and UNVERIFIED override label', () => {
    const digest = buildRunsDigest(
      [
        runRecord({
          runId: 'x',
          hours: 0,
          decision: 'GO',
          changedFiles: ['src/db.mjs'],
        }),
        runRecord({
          runId: 'y',
          hours: 1,
          decision: 'NO_GO',
          reasonCode: 'BLOCKING_FINDINGS',
          changedFiles: ['src/db.mjs'],
          findings: [
            { ruleId: 'r', file: 'src/db.mjs', message: 'm', severity: 'major', title: 'T' },
          ],
          override: { actor: 'bob', timestamp: hoursAfter(2), gateInputsHash: 'aaaaaaaaaaaaaaaa' },
        }),
      ],
      { now: NOW }
    );
    const md = formatDigestMarkdown(digest);
    assert.match(md, /runs digest/);
    assert.match(md, /NOT a rate/);
    assert.match(md, /Attribution is a human judgment/);
    assert.match(md, /UNVERIFIED/);
  });
});
