import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildRunProvenance,
  buildRunRecord,
  saveRunRecord,
  listRunRecords,
  loadRunRecord,
  computeDashboard,
  formatDashboard,
  resolveStoreDir,
} from '../src/lib/result-store.mjs';
// #1715: the consumer of the fields this module produces. Imported so the
// producer assertions are cross-checked against the existing read path instead
// of against a second copy of the same expectations.
import {
  buildRunEvidence,
  EVIDENCE_SOURCES,
  evidenceTrustLevel,
} from '../src/lib/shadow-aggregate.mjs';

function makeResult(overrides = {}) {
  return {
    status: 'ok',
    repoRoot: path.join(os.tmpdir(), 'test-repo'),
    defaultBranch: 'main',
    mergeBase: 'abc123',
    changedFiles: ['src/foo.mjs'],
    reviewMode: 'medium',
    plan: { phase: 'midstream', reviewMode: 'medium' },
    tokenEstimate: 1200,
    findings: [
      {
        id: 'rr-1',
        ruleId: 'null-safety',
        file: 'src/foo.mjs',
        lineStart: 10,
        severity: 'major',
        confidence: 'high',
        message: 'null check missing',
        evidence: ['obj.foo()'],
        reviewerRole: 'bug-hunter',
      },
    ],
    classified: {
      overview: [{ id: 'rr-1' }],
      suppressed: [{ id: 'rr-x', suppressReason: 'low_confidence' }],
      inlineCandidates: [],
    },
    ...overrides,
  };
}

let tmpDir;

describe('result-store', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'river-result-store-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('resolveStoreDir', () => {
    it('returns storeDir when provided', () => {
      assert.equal(resolveStoreDir(null, { storeDir: '/custom' }), '/custom');
    });

    it('returns project-local .river/runs when repoRoot provided', () => {
      const dir = resolveStoreDir('/my/repo');
      assert.ok(dir.endsWith('.river/runs') || dir.includes('.river'));
    });

    it('returns home-based global dir when no repoRoot', () => {
      const dir = resolveStoreDir(null);
      assert.ok(dir.startsWith(os.homedir()));
    });
  });

  describe('buildRunRecord', () => {
    it('generates a runId', () => {
      const rec = buildRunRecord(makeResult());
      assert.ok(typeof rec.runId === 'string' && rec.runId.length > 10);
    });

    it('uses provided runId when given', () => {
      const rec = buildRunRecord(makeResult(), { runId: 'custom-id' });
      assert.equal(rec.runId, 'custom-id');
    });

    it('includes required fields', () => {
      const rec = buildRunRecord(makeResult());
      assert.ok('timestamp' in rec);
      assert.ok('findings' in rec);
      assert.ok('suppressedFindings' in rec);
      assert.ok('finalSummary' in rec);
      assert.ok('reviewedTarget' in rec);
    });

    it('finalSummary has findingsCount and suppressedCount', () => {
      const rec = buildRunRecord(makeResult());
      assert.equal(rec.finalSummary.findingsCount, 1);
      assert.equal(rec.finalSummary.suppressedCount, 1);
      assert.equal(rec.finalSummary.overviewCount, 1);
    });

    it('preserves findings array', () => {
      const rec = buildRunRecord(makeResult());
      assert.equal(rec.findings.length, 1);
      assert.equal(rec.findings[0].ruleId, 'null-safety');
    });

    // #1600: the calibration debug telemetry (verifierStats,
    // verifierAllRejected, findingFormat.recommendedGaps) was computed on
    // review-engine's `debug` object but never reached the persisted run
    // record, making it unobservable outside process memory.
    it('persists reviewDebug as debug when present', () => {
      const rec = buildRunRecord(
        makeResult({
          reviewDebug: {
            verifierStats: { total: 3, verified: 1, rejected: 2 },
            verifierAllRejected: false,
            findingFormat: { ok: true, recommendedGaps: 1 },
          },
        })
      );
      assert.deepEqual(rec.debug.verifierStats, { total: 3, verified: 1, rejected: 2 });
      assert.equal(rec.debug.verifierAllRejected, false);
      assert.equal(rec.debug.findingFormat.recommendedGaps, 1);
    });

    it('omits debug when reviewDebug is absent', () => {
      const rec = buildRunRecord(makeResult());
      assert.ok(!('debug' in rec));
    });
  });

  describe('saveRunRecord / loadRunRecord', () => {
    it('saves and loads a run record', async () => {
      const rec = buildRunRecord(makeResult(), { runId: 'test-run-001' });
      await saveRunRecord(rec, { storeDir: tmpDir });

      const loaded = await loadRunRecord(tmpDir, 'test-run-001');
      assert.equal(loaded.runId, 'test-run-001');
      assert.equal(loaded.findings.length, 1);
    });

    it('creates the store directory if missing', async () => {
      const newDir = path.join(tmpDir, 'subdir');
      const rec = buildRunRecord(makeResult(), { runId: 'test-run-002' });
      await saveRunRecord(rec, { storeDir: newDir });
      const stat = await fs.stat(newDir);
      assert.ok(stat.isDirectory());
    });

    it('throws when loading non-existent run', async () => {
      await assert.rejects(() => loadRunRecord(tmpDir, 'nonexistent-run'));
    });

    it('throws on path traversal attempt in runId', async () => {
      await assert.rejects(() => loadRunRecord(tmpDir, '../../etc/passwd'), /path traversal/i);
    });
  });

  describe('listRunRecords', () => {
    it('returns empty array for empty directory', async () => {
      const emptyDir = path.join(tmpDir, 'empty');
      await fs.mkdir(emptyDir);
      const list = await listRunRecords(emptyDir);
      assert.deepEqual(list, []);
    });

    it('returns empty array for non-existent directory', async () => {
      const list = await listRunRecords(path.join(tmpDir, 'does-not-exist'));
      assert.deepEqual(list, []);
    });

    it('lists stored runs with metadata', async () => {
      const listDir = path.join(tmpDir, 'list-test');
      const rec1 = buildRunRecord(makeResult(), { runId: '2026-01-01-run1' });
      const rec2 = buildRunRecord(makeResult(), { runId: '2026-01-02-run2' });
      await saveRunRecord(rec1, { storeDir: listDir });
      await saveRunRecord(rec2, { storeDir: listDir });

      const list = await listRunRecords(listDir);
      assert.equal(list.length, 2);
      assert.ok(list.every((r) => 'runId' in r && 'findingsCount' in r));
    });

    // #1857: `river runs list` prints `suppressed=` from this metadata. It must
    // also carry `overflowCount`, otherwise the printed line means one thing for
    // pre-split records and another for post-split ones with nothing to say so.
    it('exposes overflowCount so runs list can print it beside suppressed', async () => {
      const overflowDir = path.join(tmpDir, 'list-overflow');
      const rec = buildRunRecord(
        makeResult({
          classified: {
            overview: [{ id: 'rr-1' }],
            suppressed: [{ id: 'rr-x', suppressReason: 'low_confidence' }],
            overflow: [{ id: 'rr-y' }, { id: 'rr-z' }],
            inlineCandidates: [],
          },
        }),
        { runId: '2026-01-03-run3' }
      );
      await saveRunRecord(rec, { storeDir: overflowDir });
      const [meta] = await listRunRecords(overflowDir);
      assert.equal(meta.overflowCount, 2);
      assert.equal(meta.suppressedCount, 1);
    });

    it('reports overflowCount 0 for a record saved before the field existed', async () => {
      const legacyDir = path.join(tmpDir, 'list-legacy');
      const rec = buildRunRecord(makeResult(), { runId: '2026-01-04-run4' });
      delete rec.finalSummary.overflowCount;
      await saveRunRecord(rec, { storeDir: legacyDir });
      const [meta] = await listRunRecords(legacyDir);
      assert.equal(meta.overflowCount, 0);
    });
  });

  describe('computeDashboard', () => {
    it('returns zeros for empty runs', () => {
      const db = computeDashboard([]);
      assert.equal(db.totalRuns, 0);
      assert.equal(db.totalFindings, 0);
      assert.equal(db.totalOverflow, 0);
      assert.equal(db.legacyCoveredByHigherLevel, 0);
      assert.equal(db.suppressRate, null);
    });

    it('computes metrics across runs', () => {
      const rec1 = buildRunRecord(makeResult());
      const rec2 = buildRunRecord(
        makeResult({
          findings: [
            {
              id: 'rr-2',
              ruleId: 'sql-injection',
              file: 'src/bar.mjs',
              severity: 'critical',
              confidence: 'high',
              reviewerRole: 'security-scanner',
              message: 'sql injection',
              evidence: [],
            },
          ],
          classified: { overview: [{ id: 'rr-2' }], suppressed: [], inlineCandidates: [] },
        })
      );
      const db = computeDashboard([rec1, rec2]);
      assert.equal(db.totalRuns, 2);
      assert.equal(db.totalFindings, 2);
      assert.ok('major' in db.severityDistribution);
      assert.ok('critical' in db.severityDistribution);
      assert.ok('bug-hunter' in db.reviewerRoleDistribution);
      assert.ok('security-scanner' in db.reviewerRoleDistribution);
    });

    // #1857 / ADR-007: `.river/runs/` is append-only, so a store spans the
    // split. Without a counter of its own the cap overflow simply vanishes from
    // the dashboard on the day the split shipped, and Suppress rate shows a
    // drop that is an artefact of the refactor rather than a real trend.
    it('counts the overview-cap overflow separately from the suppressions', () => {
      const rec = buildRunRecord(
        makeResult({
          classified: {
            overview: [{ id: 'rr-1' }],
            suppressed: [{ id: 'rr-x', suppressReason: 'low_confidence' }],
            overflow: [{ id: 'rr-y' }, { id: 'rr-z' }],
            inlineCandidates: [],
          },
        })
      );
      const db = computeDashboard([rec]);
      assert.equal(db.totalOverflow, 2);
      assert.equal(db.totalSuppressed, 1);
      assert.ok(formatDashboard(db).includes('| Total overflow (overview cap) | 2 |'));
    });

    it('reports zero overflow for a record written before the field existed', () => {
      // A pre-#1857 record: no `overflowFindings` key at all.
      const legacy = buildRunRecord(makeResult());
      delete legacy.overflowFindings;
      const db = computeDashboard([legacy]);
      assert.equal(db.totalOverflow, 0);
      assert.equal(db.legacyCoveredByHigherLevel, 0);
      assert.ok(formatDashboard(db).includes('| Total overflow (overview cap) | 0 |'));
    });

    it('counts legacy covered_by_higher_level suppressions so the split stays visible', () => {
      // The pre-split shape: the cap overflow arrived inside `suppressedFindings`
      // under the now-retired reason code, indistinguishable from a duplicate.
      const legacy = buildRunRecord(
        makeResult({
          classified: {
            overview: [{ id: 'rr-1' }],
            suppressed: [
              { id: 'rr-a', suppressReason: 'covered_by_higher_level_finding' },
              { id: 'rr-b', suppressReason: 'covered_by_higher_level_finding' },
              { id: 'rr-c', suppressReason: 'low_confidence' },
            ],
            inlineCandidates: [],
          },
        })
      );
      const db = computeDashboard([legacy]);
      assert.equal(db.legacyCoveredByHigherLevel, 2);
      // NOT retro-corrected: the recorded suppression count stands as written.
      assert.equal(db.totalSuppressed, 3);
      assert.equal(db.totalOverflow, 0);
      assert.ok(formatDashboard(db).includes('covered_by_higher_level_finding) | 2 |'));
    });

    it('omits the legacy row when no record carries the retired reason code', () => {
      const db = computeDashboard([buildRunRecord(makeResult())]);
      assert.ok(!formatDashboard(db).includes('Legacy pre-#1857'));
    });

    it('computes suppress rate', () => {
      const rec = buildRunRecord(makeResult());
      const db = computeDashboard([rec]);
      // 1 finding, 1 suppressed → rate = 1/2 = 0.5
      assert.ok(db.suppressRate !== null);
      assert.ok(db.suppressRate >= 0 && db.suppressRate <= 1);
    });
  });

  describe('formatDashboard', () => {
    it('returns markdown with summary table', () => {
      const db = computeDashboard([buildRunRecord(makeResult())]);
      const md = formatDashboard(db);
      assert.ok(md.includes('## River Review Dashboard'));
      assert.ok(md.includes('Total runs'));
      assert.ok(md.includes('Suppress rate'));
    });

    it('includes severity distribution section', () => {
      const db = computeDashboard([buildRunRecord(makeResult())]);
      const md = formatDashboard(db);
      assert.ok(md.includes('Severity Distribution'));
    });
  });
});

// ---------------------------------------------------------------------------
// Epic #1347 S3 (#1350) — gate/decision persistence
// ---------------------------------------------------------------------------
describe('buildRunRecord — gate audit trail (S3)', () => {
  it('persists gate and decision when supplied (additive)', () => {
    const gate = {
      decision: 'GO',
      reasonCode: 'CONVERGED_CLEAN',
      tier: 'field',
      inputs: {},
      inputsHash: 'abcdefabcdefabcd',
      configSnapshot: { expiresInHours: 72, maxConsecutiveAutoGo: 5 },
      schemaVersion: '1',
    };
    const rec = buildRunRecord(makeResult(), { gate, decision: 'auto-approve' });
    assert.deepEqual(rec.gate, gate);
    assert.equal(rec.decision, 'auto-approve');
  });

  it('omits gate/decision when absent (backward compatible)', () => {
    const rec = buildRunRecord(makeResult());
    assert.equal('gate' in rec, false);
    assert.equal('decision' in rec, false);
  });
});

// ---------------------------------------------------------------------------
// #1574 producer Slice 2 (#1715) — commitSha / provenance
//
// The consumer side (`buildRunEvidence` in src/lib/shadow-aggregate.mjs) is
// imported here on purpose: asserting only the shape this module writes would
// be self-consistent and would still pass if the two halves disagreed on the
// key names (`provenance.sourceCommitSha` vs `commitSha`, camelCase vs
// snake_case). Every assertion below therefore reads the value back through
// the function `river evolve aggregate` actually calls.
// ---------------------------------------------------------------------------
describe('buildRunRecord — commitSha / provenance (#1715)', () => {
  const SHA = '0123456789abcdef0123456789abcdef01234567';

  it('writes commitSha when the runner resolved one', () => {
    const rec = buildRunRecord(makeResult({ commitSha: SHA }));
    assert.equal(rec.commitSha, SHA);
  });

  it('omits commitSha entirely when the runner could not resolve one', () => {
    for (const commitSha of [null, undefined, '', '   ']) {
      const rec = buildRunRecord(makeResult({ commitSha }));
      assert.equal('commitSha' in rec, false, `commitSha=${JSON.stringify(commitSha)}`);
    }
  });

  it('writes the provenance block when supplied', () => {
    const rec = buildRunRecord(makeResult({ commitSha: SHA }), {
      provenance: buildRunProvenance({ commitSha: SHA, dirty: false, env: {} }),
    });
    assert.deepEqual(rec.provenance, {
      evidenceSource: 'local',
      sourceCommitSha: SHA,
      dirty: false,
      trustedBy: null,
      generatedByCandidate: false,
    });
  });

  it('records dirty so a working-tree review is distinguishable from a clean one', () => {
    // Without this the two are identical on disk, and `sourceCommitSha` reads
    // as reproducible in both cases even though HEAD's tree only reproduces the
    // clean one (#1715 W1).
    const clean = buildRunRecord(makeResult({ commitSha: SHA }), {
      provenance: buildRunProvenance({ commitSha: SHA, dirty: false, env: {} }),
    });
    const dirty = buildRunRecord(makeResult({ commitSha: SHA }), {
      provenance: buildRunProvenance({ commitSha: SHA, dirty: true, env: {} }),
    });
    assert.equal(clean.provenance.dirty, false);
    assert.equal(dirty.provenance.dirty, true);
    assert.notDeepEqual(clean.provenance, dirty.provenance);
  });

  it('carries an undeterminable dirty state as null rather than clean', () => {
    for (const dirty of [null, undefined, 'yes', 1]) {
      const rec = buildRunRecord(makeResult({ commitSha: SHA }), {
        provenance: buildRunProvenance({ commitSha: SHA, dirty, env: {} }),
      });
      assert.equal(rec.provenance.dirty, null, `dirty=${JSON.stringify(dirty)}`);
    }
  });

  it('omits provenance when not supplied (backward compatible)', () => {
    const rec = buildRunRecord(makeResult({ commitSha: SHA }));
    assert.equal('provenance' in rec, false);
  });

  it('drops a provenance block whose evidenceSource is outside the 契約1 vocabulary, loudly', () => {
    // buildRunEvidence silently rewrites an unknown source to 'local'. Writing
    // the unknown claim to disk would leave a record that reads differently
    // from what it says, so the producer refuses to persist it at all —
    // `commitSha` still carries the SHA through the documented fallback.
    //
    // The warning is part of the contract (#1715 W3): a silent drop makes "no
    // producer wrote provenance" and "provenance was rejected" identical to
    // anyone auditing the stored record afterwards.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    let rec;
    try {
      rec = buildRunRecord(makeResult({ commitSha: SHA }), {
        provenance: { evidenceSource: 'trusted-ci', sourceCommitSha: SHA, trustedBy: null },
      });
    } finally {
      console.warn = originalWarn;
    }
    assert.equal('provenance' in rec, false);
    assert.equal(rec.commitSha, SHA);
    assert.equal(warnings.length, 1);
    // The rejected value must appear, otherwise the warning cannot be acted on.
    assert.match(warnings[0], /trusted-ci/);
  });

  it('does not warn when provenance is simply absent', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      buildRunRecord(makeResult({ commitSha: SHA }));
    } finally {
      console.warn = originalWarn;
    }
    assert.deepEqual(warnings, []);
  });

  it('pins trustedBy to null even when a caller asks for a value', () => {
    const rec = buildRunRecord(makeResult({ commitSha: SHA }), {
      provenance: {
        evidenceSource: 'CI',
        sourceCommitSha: SHA,
        trustedBy: 'github-actions',
        generatedByCandidate: true,
      },
    });
    assert.equal(rec.provenance.trustedBy, null);
    // generatedByCandidate is caller data (not a trust claim) and passes through.
    assert.equal(rec.provenance.generatedByCandidate, true);
  });

  it('keeps the key set and values of a record built from a pre-#1715 result', () => {
    // The exact key set of the legacy record, enumerated so an accidentally
    // unconditional `commitSha: null` / `provenance: {...}` fails here.
    //
    // NOTE — this is key-set-and-value equality, NOT byte equality: deepEqual
    // ignores key ORDER, so a reordering that changes the serialized bytes (and
    // therefore `artifact_sha256`, which hashes canonical JSON) would still
    // pass. Canonical JSON sorts keys, so ordering does not affect the digest
    // in practice, but the assertion should not be read as proving bytes.
    const rec = buildRunRecord(makeResult(), { runId: 'legacy-run' });
    assert.deepEqual(rec, {
      runId: 'legacy-run',
      timestamp: rec.timestamp,
      reviewedTarget: path.join(os.tmpdir(), 'test-repo'),
      phase: 'midstream',
      reviewMode: 'medium',
      mergeBase: 'abc123',
      defaultBranch: 'main',
      changedFiles: ['src/foo.mjs'],
      findings: rec.findings,
      suppressedFindings: rec.suppressedFindings,
      // #1857: expanded to real values. Written as `finalSummary:
      // rec.finalSummary` this was self-referential and pinned NOTHING about
      // the summary — a key added to or removed from it still passed. It is the
      // only fixed-key metadata listRunRecords reads (result-store.mjs:243-253)
      // and it reaches the CI job summary, so the key SET is the contract here.
      finalSummary: {
        findingsCount: 1,
        suppressedCount: 1,
        overflowCount: 0,
        overviewCount: 1,
        changedFilesCount: 1,
        tokenEstimate: 1200,
      },
    });
    // #1857 / ADR-007: the overview-cap overflow is persisted separately from
    // the suppression dispositions. With no overflow the key stays absent, so
    // pre-#1857 records keep their exact shape.
    assert.equal('overflowFindings' in rec, false);
  });

  it('persists the overview-cap overflow apart from the suppressions (#1857)', () => {
    const rec = buildRunRecord(
      makeResult({
        classified: {
          overview: [{ id: 'rr-1' }],
          suppressed: [{ id: 'rr-x', suppressReason: 'low_confidence' }],
          overflow: [{ id: 'rr-y' }, { id: 'rr-z' }],
          inlineCandidates: [],
        },
      }),
      { runId: 'overflow-run' }
    );
    assert.deepEqual(
      rec.overflowFindings.map((f) => f.id),
      ['rr-y', 'rr-z']
    );
    assert.equal(rec.finalSummary.overflowCount, 2);
    // The overflow must NOT be counted as a suppression disposition.
    assert.equal(rec.finalSummary.suppressedCount, 1);
    for (const f of rec.overflowFindings) assert.equal('suppressReason' in f, false);
  });
});

describe('buildRunProvenance — evidence source resolution (#1715)', () => {
  const SHA = 'fedcba9876543210fedcba9876543210fedcba98';

  it('claims CI only under GITHUB_ACTIONS=true', () => {
    assert.equal(
      buildRunProvenance({ commitSha: SHA, env: { GITHUB_ACTIONS: 'true' } }).evidenceSource,
      'CI'
    );
  });

  it('claims local otherwise', () => {
    for (const env of [{}, { GITHUB_ACTIONS: 'false' }, { GITHUB_ACTIONS: '1' }]) {
      assert.equal(buildRunProvenance({ commitSha: SHA, env }).evidenceSource, 'local');
    }
  });

  it('only ever emits a source the 契約1 vocabulary declares', () => {
    for (const env of [{ GITHUB_ACTIONS: 'true' }, {}]) {
      assert.ok(EVIDENCE_SOURCES.includes(buildRunProvenance({ env }).evidenceSource));
    }
  });

  it('never self-reports trust', () => {
    const p = buildRunProvenance({ commitSha: SHA, env: { GITHUB_ACTIONS: 'true' } });
    assert.equal(p.trustedBy, null);
    assert.equal(p.generatedByCandidate, false);
  });

  it('carries a missing sha as null rather than an empty string', () => {
    assert.equal(buildRunProvenance({ commitSha: null, env: {} }).sourceCommitSha, null);
    assert.equal(buildRunProvenance({ env: {} }).sourceCommitSha, null);
  });
});

describe('buildRunRecord → buildRunEvidence — the consumer reads what we write (#1715)', () => {
  const SHA = 'aaaabbbbccccddddeeeeffff0000111122223333';

  it('resolves source_commit_sha from the provenance block', () => {
    const rec = buildRunRecord(makeResult({ commitSha: SHA }), {
      provenance: buildRunProvenance({ commitSha: SHA, env: { GITHUB_ACTIONS: 'true' } }),
    });
    const evidence = buildRunEvidence(rec);
    assert.equal(evidence.source_commit_sha, SHA);
    assert.equal(evidence.evidence_source, 'CI');
  });

  it('falls back to the top-level commitSha when provenance was dropped', () => {
    const rec = buildRunRecord(makeResult({ commitSha: SHA }));
    assert.equal(buildRunEvidence(rec).source_commit_sha, SHA);
  });

  it('leaves source_commit_sha null for a pre-#1715 record', () => {
    assert.equal(buildRunEvidence(buildRunRecord(makeResult())).source_commit_sha, null);
  });

  it('writing provenance promotes nothing: the three trust indicators are unchanged', () => {
    // #1650 B2 lesson: a producer adds a self-report, never verifiability.
    // `.river/runs/` is writable by the agent under review, so a record can
    // claim `evidence_source: CI` with no attestation at all.
    const withProvenance = buildRunEvidence(
      buildRunRecord(makeResult({ commitSha: SHA }), {
        provenance: buildRunProvenance({ commitSha: SHA, env: { GITHUB_ACTIONS: 'true' } }),
      })
    );
    const legacy = buildRunEvidence(buildRunRecord(makeResult()));
    for (const evidence of [withProvenance, legacy]) {
      assert.equal(evidence.trust_level, 'untrusted');
      assert.equal(evidence.provenance_verified, false);
      assert.equal(evidence.trusted_by, null);
    }
    assert.equal(evidenceTrustLevel(withProvenance), evidenceTrustLevel(legacy));
  });
});
