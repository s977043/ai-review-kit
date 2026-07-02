import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildRunRecord,
  saveRunRecord,
  listRunRecords,
  loadRunRecord,
  computeDashboard,
  formatDashboard,
  resolveStoreDir,
} from '../src/lib/result-store.mjs';

function makeResult(overrides = {}) {
  return {
    status: 'ok',
    repoRoot: '/tmp/test-repo',
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
  });

  describe('computeDashboard', () => {
    it('returns zeros for empty runs', () => {
      const db = computeDashboard([]);
      assert.equal(db.totalRuns, 0);
      assert.equal(db.totalFindings, 0);
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
