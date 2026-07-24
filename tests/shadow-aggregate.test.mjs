// Shadow aggregate (#1574 P1) — read-only multi-run aggregation.
//
// Covers the four properties the design contract makes load-bearing:
//   - evidence provenance / trust classification (契約1)
//   - canonical review_run_id join (契約2)
//   - content-addressed, date-independent candidate id (契約4)
//   - two-stage clustering (契約5)
// plus the two properties P1 itself promises: determinism and read-only.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildClusters,
  buildRunEvidence,
  buildShadowAggregate,
  computeCandidateId,
  deriveFeedbackReviewRunId,
  deriveReviewRunId,
  evidenceTrustLevel,
  formatShadowAggregateMarkdown,
  SHADOW_AGGREGATE_POLICY_VERSION,
} from '../src/lib/shadow-aggregate.mjs';
import { findRuleCandidates } from '../scripts/feedback-rule-candidates.mjs';
import { compileSchemaFile } from './helpers/schema-validator.mjs';
import { runCliInProcess } from './helpers/cli.mjs';
import { runEvolveCommand } from '../src/cli/commands/evolve.mjs';

const NOW = new Date('2026-07-25T00:00:00.000Z');
const FP_A = 'a1b2c3d4e5f60718';
const FP_B = '00112233445566aa';

const validateAggregate = compileSchemaFile('shadow-aggregate.schema.json', {
  ajvOptions: { allErrors: true },
});

function runRecord({ runId, timestamp = '2026-07-20T00:00:00.000Z', provenance, findings = [] }) {
  return {
    runId,
    timestamp,
    reviewedTarget: '/repo',
    phase: 'midstream',
    findings,
    ...(provenance ? { provenance } : {}),
  };
}

function finding(fingerprint, { file = 'src/a.mjs', category = 'security' } = {}) {
  return { fingerprint, file, category, severity: 'major' };
}

function feedback({
  skillId = 'secret-scanner',
  feedbackType = 'false_positive',
  fingerprint = FP_A,
  runId = 'run-1',
  timestamp = '2026-07-21T00:00:00.000Z',
  pr = 1,
} = {}) {
  return {
    timestamp,
    trigger: 'pr-comment',
    feedbackType,
    skillId,
    findingFingerprint: fingerprint,
    evidence: null,
    pr,
    ...(runId ? { review_run_id: runId } : {}),
  };
}

// 2 runs, 3 feedback entries: two share a fingerprint, one has none.
function scenario() {
  const runRecords = [
    runRecord({
      runId: 'run-1',
      provenance: { evidenceSource: 'CI', trustedBy: 'github-actions', sourceCommitSha: 'abc123' },
      findings: [finding(FP_A)],
    }),
    runRecord({
      runId: 'run-2',
      timestamp: '2026-07-22T00:00:00.000Z',
      findings: [finding(FP_B, { file: 'src/b.mjs', category: 'testing' })],
    }),
  ];
  const feedbackEntries = [
    feedback({ pr: 1 }),
    feedback({ pr: 2, runId: 'run-2', timestamp: '2026-07-22T00:00:00.000Z' }),
    feedback({ pr: 3, fingerprint: null, runId: null }),
    feedback({ skillId: 'other-skill', feedbackType: 'accepted', pr: 4 }),
  ];
  return { runRecords, feedbackEntries };
}

describe('shadow-aggregate 契約1: evidence provenance', () => {
  test('a run without provenance degrades to local / untrusted', () => {
    const evidence = buildRunEvidence(runRecord({ runId: 'run-1' }));
    assert.equal(evidence.evidence_source, 'local');
    assert.equal(evidence.trusted_by, null);
    assert.equal(evidence.generated_by_candidate, false);
    assert.equal(evidence.trust_level, 'untrusted');
    assert.match(evidence.artifact_sha256, /^[0-9a-f]{64}$/);
  });

  test('CI evidence with a verifier is trusted', () => {
    const evidence = buildRunEvidence(
      runRecord({
        runId: 'run-1',
        provenance: { evidenceSource: 'CI', trustedBy: 'github-actions', sourceCommitSha: 'abc' },
      })
    );
    assert.equal(evidence.trust_level, 'trusted');
    assert.equal(evidence.source_commit_sha, 'abc');
  });

  test('evidence produced by the candidate itself is never trusted', () => {
    const evidence = buildRunEvidence(
      runRecord({
        runId: 'run-1',
        provenance: {
          evidenceSource: 'CI',
          trustedBy: 'github-actions',
          generatedByCandidate: true,
        },
      })
    );
    assert.equal(evidence.trust_level, 'untrusted');
  });

  test('an unknown evidence_source falls back to untrusted', () => {
    assert.equal(
      evidenceTrustLevel({ evidence_source: 'wishful-thinking', trusted_by: 'me' }),
      'untrusted'
    );
    assert.equal(
      buildRunEvidence(runRecord({ runId: 'r', provenance: { evidenceSource: 'wishful' } }))
        .evidence_source,
      'local'
    );
  });

  test('artifact_sha256 is content-addressed, not key-order dependent', () => {
    const a = buildRunEvidence({ runId: 'r', timestamp: 't', findings: [] });
    const b = buildRunEvidence({ findings: [], timestamp: 't', runId: 'r' });
    assert.equal(a.artifact_sha256, b.artifact_sha256);
  });
});

describe('shadow-aggregate 契約2: canonical review_run_id', () => {
  test('an explicit review_run_id wins over the legacy runId', () => {
    assert.equal(deriveReviewRunId({ review_run_id: 'canonical', runId: 'legacy' }), 'canonical');
    assert.equal(deriveReviewRunId({ runId: 'legacy' }), 'legacy');
    assert.equal(deriveReviewRunId({}), null);
  });

  test('feedback has no legacy fallback and stays unjoined', () => {
    assert.equal(deriveFeedbackReviewRunId({ review_run_id: 'run-1' }), 'run-1');
    assert.equal(deriveFeedbackReviewRunId({ runId: 'run-1' }), null);
  });

  test('join coverage counts only feedback that resolves to a known run', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    assert.equal(aggregate.inputs.feedbackCount, 4);
    assert.equal(aggregate.join.joinedFeedbackCount, 3);
    assert.equal(aggregate.join.unjoinedFeedbackCount, 1);
    assert.deepEqual(aggregate.join.runIdsWithEvidence, ['run-1', 'run-2']);
  });
});

describe('shadow-aggregate 契約5: two-stage clustering', () => {
  test('stage 1 uses the same clusterKey as #1568-A recurrence detection', () => {
    const { feedbackEntries } = scenario();
    const clusters = buildClusters(feedbackEntries, { minRecurrence: 2 });
    const legacy = findRuleCandidates(feedbackEntries, { min: 2 });
    assert.deepEqual(
      clusters.map((c) => c.clusterKey).sort(),
      legacy.map((c) => `${c.skillId}::${c.feedbackType}`).sort()
    );
  });

  test('accepted feedback never becomes a cluster', () => {
    const clusters = buildClusters(
      [
        feedback({ skillId: 's', feedbackType: 'accepted', pr: 1 }),
        feedback({ skillId: 's', feedbackType: 'accepted', pr: 2 }),
      ],
      { minRecurrence: 2 }
    );
    assert.deepEqual(clusters, []);
  });

  test('stage 2 splits a class by fingerprint / category / scope', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    assert.equal(aggregate.clusters.length, 1);
    const [cluster] = aggregate.clusters;
    assert.equal(cluster.clusterKey, 'secret-scanner::false_positive');
    assert.equal(cluster.count, 3);
    assert.equal(cluster.subClusters.length, 2);
    const fingerprinted = cluster.subClusters.find((s) => s.fingerprint === FP_A);
    assert.equal(fingerprinted.count, 2);
    assert.equal(fingerprinted.category, 'security');
    assert.equal(fingerprinted.scope, 'src/a.mjs');
    assert.equal(fingerprinted.experimentEligible, true);
    // 契約5 未決事項: the failure-mode vocabulary is decided after observation.
    assert.equal(fingerprinted.failureMode, null);
  });

  test('a sub-cluster without a fingerprint is visible but not experiment-eligible', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    const unfingerprinted = aggregate.clusters[0].subClusters.find((s) => s.fingerprint === null);
    assert.equal(unfingerprinted.experimentEligible, false);
    assert.equal(unfingerprinted.count, 1);
  });

  test('classes below the recurrence threshold are dropped', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), minRecurrence: 4, now: NOW });
    assert.deepEqual(aggregate.clusters, []);
    assert.equal(aggregate.candidate, null);
  });
});

describe('shadow-aggregate 契約4: content-addressed candidate id', () => {
  test('the same evidence in any order converges on the same id', () => {
    const refs = [
      { review_run_id: 'run-1', findingFingerprint: FP_A, feedbackType: 'false_positive', pr: 1 },
      { review_run_id: 'run-2', findingFingerprint: FP_A, feedbackType: 'false_positive', pr: 2 },
    ];
    const base = { policyVersion: 'p', clusterKey: 'k', subClusterKey: 's' };
    assert.equal(
      computeCandidateId({ ...base, evidence: refs }),
      computeCandidateId({ ...base, evidence: [...refs].reverse() })
    );
  });

  test('the id does not depend on the generation date', () => {
    const input = scenario();
    const early = buildShadowAggregate({ ...input, now: new Date('2026-01-01T00:00:00.000Z') });
    const late = buildShadowAggregate({ ...input, now: new Date('2026-12-31T00:00:00.000Z') });
    assert.equal(early.candidate.candidateId, late.candidate.candidateId);
    assert.notEqual(early.candidate.createdAt, late.candidate.createdAt);
    assert.match(early.candidate.candidateId, /^RR-IC-[0-9a-f]{12}$/);
  });

  test('a different policy version yields a different id', () => {
    const input = scenario();
    const a = buildShadowAggregate({ ...input, now: NOW });
    const b = buildShadowAggregate({ ...input, now: NOW, policyVersion: 'shadow-aggregate/next' });
    assert.notEqual(a.candidate.candidateId, b.candidate.candidateId);
  });
});

describe('shadow-aggregate candidate', () => {
  test('exactly one shadow candidate is produced and it declares no write effects', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    const candidate = aggregate.candidate;
    assert.equal(candidate.mode, 'shadow');
    assert.equal(candidate.status, 'observed');
    assert.deepEqual(candidate.writeEffects, []);
    assert.deepEqual(candidate.autoActions, ['observe']);
    assert.equal(candidate.requiresHumanApproval, true);
    assert.equal(candidate.trust.canaryEligible, false);
    assert.equal(candidate.causeHypothesis, null);
    assert.equal(candidate.targetSurface, 'memory');
    assert.equal(candidate.policyVersion, SHADOW_AGGREGATE_POLICY_VERSION);
  });

  test('the fingerprinted sub-cluster is preferred over the unfingerprinted one', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    assert.equal(aggregate.candidate.experimentEligible, true);
    assert.equal(aggregate.candidate.candidateType, 'experiment_candidate');
    assert.deepEqual(aggregate.candidate.sourceReviewRunIds, ['run-1', 'run-2']);
  });

  test('trust counters distinguish trusted CI evidence from local evidence', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    assert.equal(aggregate.evidence.trustedRunCount, 1);
    assert.equal(aggregate.evidence.untrustedRunCount, 1);
    assert.equal(aggregate.candidate.trust.trustedEvidenceCount, 1);
    assert.equal(aggregate.candidate.trust.untrustedEvidenceCount, 1);
  });

  test('a candidate with only untrusted evidence records the reason', () => {
    const { feedbackEntries } = scenario();
    const runRecords = [runRecord({ runId: 'run-1', findings: [finding(FP_A)] })];
    const aggregate = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });
    assert.equal(aggregate.candidate.trust.trustedEvidenceCount, 0);
    assert.ok(aggregate.candidate.trust.reasons.some((r) => r.includes('trusted evidence')));
  });
});

describe('shadow-aggregate determinism and schema', () => {
  test('input order does not change the artifact', () => {
    const { runRecords, feedbackEntries } = scenario();
    const a = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });
    const b = buildShadowAggregate({
      runRecords: [...runRecords].reverse(),
      feedbackEntries: [...feedbackEntries].reverse(),
      now: NOW,
    });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  test('repeated runs over the same input are byte-identical', () => {
    const input = { ...scenario(), now: NOW };
    assert.equal(
      JSON.stringify(buildShadowAggregate(input)),
      JSON.stringify(buildShadowAggregate(input))
    );
  });

  test('the artifact conforms to schemas/shadow-aggregate.schema.json', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    assert.equal(
      validateAggregate(aggregate),
      true,
      JSON.stringify(validateAggregate.errors, null, 2)
    );
  });

  test('an empty repository produces a valid, candidate-less artifact', () => {
    const aggregate = buildShadowAggregate({ now: NOW });
    assert.equal(aggregate.candidate, null);
    assert.equal(
      validateAggregate(aggregate),
      true,
      JSON.stringify(validateAggregate.errors, null, 2)
    );
    assert.match(formatShadowAggregateMarkdown(aggregate), /no candidate generated/);
  });
});

// ---------------------------------------------------------------------------
// CLI: `river evolve aggregate` must not touch the repository.
// ---------------------------------------------------------------------------

function snapshotTree(dir) {
  const snapshot = {};
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        snapshot[path.relative(dir, full) + '/'] = 'dir';
        walk(full);
      } else {
        snapshot[path.relative(dir, full)] = `${stats.mtimeMs}:${readFileSync(full, 'utf8')}`;
      }
    }
  };
  walk(dir);
  return snapshot;
}

function seedRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rr-shadow-'));
  const { runRecords, feedbackEntries } = scenario();
  mkdirSync(path.join(root, '.river', 'runs'), { recursive: true });
  mkdirSync(path.join(root, '.river', 'feedback'), { recursive: true });
  for (const record of runRecords) {
    writeFileSync(
      path.join(root, '.river', 'runs', `${record.runId}.json`),
      JSON.stringify(record, null, 2),
      'utf8'
    );
  }
  writeFileSync(
    path.join(root, '.river', 'feedback', '2026-07.jsonl'),
    feedbackEntries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8'
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('river evolve aggregate (CLI)', () => {
  test('emits the aggregate as JSON and exits 0', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    const res = await runCliInProcess(['evolve', 'aggregate', root, '--output', 'json']);
    assert.equal(res.code, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.readOnly, true);
    assert.equal(parsed.inputs.runCount, 2);
    assert.equal(parsed.candidate.mode, 'shadow');
    assert.equal(
      validateAggregate(parsed),
      true,
      JSON.stringify(validateAggregate.errors, null, 2)
    );
  });

  test('the default text output is a human-readable report', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    const res = await runCliInProcess(['evolve', 'aggregate', root]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Shadow aggregate \(read-only\)/);
    assert.match(res.stdout, /secret-scanner::false_positive/);
  });

  test('is read-only: no file under the target repo is created or modified', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    const before = snapshotTree(root);
    const res = await runCliInProcess(['evolve', 'aggregate', root, '--output', 'json']);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(snapshotTree(root), before);
  });

  test('--min filters recurrence and --month scopes the feedback file', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    const res = await runCliInProcess([
      'evolve',
      'aggregate',
      root,
      '--min',
      '4',
      '--month',
      '2026-07',
      '--output',
      'json',
    ]);
    assert.equal(res.code, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.inputs.minRecurrence, 4);
    assert.equal(parsed.inputs.month, '2026-07');
    assert.equal(parsed.candidate, null);
  });

  test('a bare `river evolve <path>` defaults to aggregate', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    const res = await runCliInProcess(['evolve', root, '--output', 'json']);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).mode, 'shadow');
  });

  test('an unknown subcommand exits 1', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    const code = await runEvolveCommand({ evolveSubcommand: 'canary' }, root);
    assert.equal(code, 1);
  });
});
