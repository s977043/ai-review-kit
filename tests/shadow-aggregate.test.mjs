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
import {
  buildProposedCandidate,
  findRuleCandidates,
  CANDIDATE_POLICY_VERSION,
} from '../src/lib/promotion-candidates.mjs';
import { compileSchemaFile } from './helpers/schema-validator.mjs';
import { runCliInProcess } from './helpers/cli.mjs';
import { runEvolveCommand } from '../src/cli/commands/evolve.mjs';
// #1673: the producers under test. Imported so the join assertion below runs
// through the SAME functions `river run --save` / `river feedback add` use,
// rather than through hand-built record literals.
import {
  buildRunRecord,
  loadAllRunRecords,
  resolveStoreDir,
  saveRunRecord,
} from '../src/lib/result-store.mjs';
import {
  appendFeedbackEntry,
  buildFeedbackEntry,
  listFeedbackEntries,
} from '../src/lib/feedback.mjs';

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

  test('a forged CI provenance cannot mint trusted evidence', () => {
    // The run store is writable by the agent under review, so this record can
    // be fabricated wholesale. P1 must not honour the claim.
    const evidence = buildRunEvidence(
      runRecord({
        runId: 'run-1',
        provenance: { evidenceSource: 'CI', trustedBy: 'github-actions', sourceCommitSha: 'abc' },
      })
    );
    assert.equal(evidence.trust_level, 'untrusted');
    assert.equal(evidence.provenance_verified, false);
    // The claim itself is still recorded so a human can inspect it.
    assert.equal(evidence.evidence_source, 'CI');
    assert.equal(evidence.trusted_by, 'github-actions');
    assert.equal(evidence.source_commit_sha, 'abc');
  });

  test('no provenance combination reaches trusted', () => {
    for (const provenance of [
      { evidenceSource: 'protected-branch', trustedBy: 'main' },
      { evidenceSource: 'human', trustedBy: 'reviewer' },
      { evidenceSource: 'CI', trustedBy: 'ci', generatedByCandidate: true },
    ]) {
      assert.equal(
        buildRunEvidence(runRecord({ runId: 'r', provenance })).trust_level,
        'untrusted'
      );
    }
    assert.equal(evidenceTrustLevel({ evidence_source: 'CI', trusted_by: 'ci' }), 'untrusted');
  });

  test('a forged run cannot raise trustedRunCount above 0', () => {
    const runRecords = [
      runRecord({
        runId: 'run-1',
        provenance: { evidenceSource: 'CI', trustedBy: 'github-actions' },
        findings: [finding(FP_A)],
      }),
    ];
    const aggregate = buildShadowAggregate({
      runRecords,
      feedbackEntries: scenario().feedbackEntries,
      now: NOW,
    });
    assert.equal(aggregate.evidence.trustedRunCount, 0);
    assert.equal(aggregate.candidate.trust.trustedEvidenceCount, 0);
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

  test('stage 2 splits a class by fingerprint / category / filePath', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    assert.equal(aggregate.clusters.length, 1);
    const [cluster] = aggregate.clusters;
    assert.equal(cluster.clusterKey, 'secret-scanner::false_positive');
    assert.equal(cluster.count, 3);
    assert.equal(cluster.subClusters.length, 2);
    const fingerprinted = cluster.subClusters.find((s) => s.fingerprint === FP_A);
    assert.equal(fingerprinted.count, 2);
    assert.equal(fingerprinted.category, 'security');
    assert.equal(fingerprinted.filePath, 'src/a.mjs');
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

  test('stage 1 keeps untrimmed skillId exactly as #1568-A does', () => {
    const entries = [
      feedback({ skillId: ' padded-skill ', pr: 1 }),
      feedback({ skillId: ' padded-skill ', pr: 2 }),
    ];
    const clusters = buildClusters(entries, { minRecurrence: 2 });
    const legacy = findRuleCandidates(entries, { min: 2 });
    assert.deepEqual(
      clusters.map((c) => c.clusterKey),
      legacy.map((c) => `${c.skillId}::${c.feedbackType}`)
    );
    assert.equal(clusters[0].clusterKey, ' padded-skill ::false_positive');
  });

  test('repeated rows of ONE finding are not recurrence evidence', () => {
    // 4 feedback rows, same fingerprint, same run, same PR: one re-litigated
    // finding, not four occurrences (cf. src/lib/promotion.mjs deduplication).
    const feedbackEntries = [1, 2, 3, 4].map((i) =>
      feedback({ pr: 7, timestamp: `2026-07-2${i}T00:00:00.000Z` })
    );
    const runRecords = [runRecord({ runId: 'run-1', findings: [finding(FP_A)] })];
    const aggregate = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });
    const [cluster] = aggregate.clusters;
    assert.equal(cluster.count, 4);
    assert.equal(cluster.distinctFindingCount, 1);
    assert.equal(cluster.distinctPrCount, 1);
    const [sub] = cluster.subClusters;
    assert.equal(sub.distinctOccurrenceCount, 1);
    assert.equal(sub.experimentEligible, false);
    assert.equal(aggregate.candidate.candidateType, 'observation_only');
    assert.ok(
      aggregate.candidate.trust.reasons.some((r) => r.includes('distinct な occurrence')),
      JSON.stringify(aggregate.candidate.trust.reasons)
    );
  });

  test('distinct occurrences across runs and PRs stay experiment-eligible', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    const sub = aggregate.clusters[0].subClusters.find((s) => s.fingerprint === FP_A);
    assert.equal(sub.distinctOccurrenceCount, 2);
    assert.equal(sub.distinctRunCount, 2);
    assert.equal(sub.distinctPrCount, 2);
    assert.equal(sub.experimentEligible, true);
  });
});

describe('shadow-aggregate 実データ形状での退行（W3）', () => {
  // Today no producer writes review_run_id, provenance, or finding.category.
  // The aggregate must degrade visibly instead of pretending to have evidence.
  const todaysRun = {
    runId: '2026-07-25T00-00-00-000Z-abc123',
    timestamp: '2026-07-25T00:00:00.000Z',
    reviewedTarget: '/repo',
    phase: 'midstream',
    reviewMode: 'medium',
    findings: [
      { fingerprint: FP_A, file: 'src/a.mjs', ruleId: 'secret-scanner', severity: 'major' },
    ],
    finalSummary: { findingsCount: 1 },
  };
  const todaysFeedback = (pr) => ({
    timestamp: `2026-07-2${pr}T00:00:00.000Z`,
    trigger: 'pr-comment',
    feedbackType: 'false_positive',
    skillId: 'secret-scanner',
    findingFingerprint: FP_A,
    evidence: null,
    pr,
  });

  test('joins to nothing and carries no run evidence', () => {
    const aggregate = buildShadowAggregate({
      runRecords: [todaysRun],
      feedbackEntries: [todaysFeedback(1), todaysFeedback(2)],
      now: NOW,
    });
    assert.equal(aggregate.join.joinedFeedbackCount, 0);
    assert.equal(aggregate.join.unjoinedFeedbackCount, 2);
    assert.deepEqual(aggregate.candidate.evidence, []);
    assert.deepEqual(aggregate.candidate.sourceReviewRunIds, []);
    assert.equal(aggregate.candidate.trust.unjoinedEvidenceCount, 2);
  });

  test('category falls back to finding.ruleId, and PRs still separate occurrences', () => {
    const aggregate = buildShadowAggregate({
      runRecords: [todaysRun],
      feedbackEntries: [todaysFeedback(1), todaysFeedback(2)],
      now: NOW,
    });
    const [sub] = aggregate.clusters[0].subClusters;
    assert.equal(sub.category, 'secret-scanner');
    assert.equal(sub.filePath, 'src/a.mjs');
    assert.equal(sub.distinctOccurrenceCount, 2);
    assert.equal(sub.experimentEligible, true);
  });

  test('the degenerate artifact is still schema-valid', () => {
    const aggregate = buildShadowAggregate({
      runRecords: [todaysRun],
      feedbackEntries: [todaysFeedback(1), todaysFeedback(2)],
      now: NOW,
    });
    assert.equal(
      validateAggregate(aggregate),
      true,
      JSON.stringify(validateAggregate.errors, null, 2)
    );
  });
});

describe('shadow-aggregate duplicate review_run_id（W4）', () => {
  const dup = (findings, timestamp) => ({
    runId: 'run-dup',
    timestamp,
    reviewedTarget: '/repo',
    phase: 'midstream',
    findings,
  });

  test('duplicate ids resolve deterministically regardless of input order', () => {
    const a = dup([finding(FP_A)], '2026-07-20T00:00:00.000Z');
    const b = dup([finding(FP_B, { file: 'src/b.mjs' })], '2026-07-20T00:00:00.000Z');
    const feedbackEntries = [
      feedback({ runId: 'run-dup', pr: 1 }),
      feedback({ runId: 'run-dup', pr: 2 }),
    ];
    const forward = buildShadowAggregate({ runRecords: [a, b], feedbackEntries, now: NOW });
    const reversed = buildShadowAggregate({ runRecords: [b, a], feedbackEntries, now: NOW });
    assert.equal(JSON.stringify(forward), JSON.stringify(reversed));
    assert.deepEqual(forward.join.duplicateReviewRunIds, ['run-dup']);
    assert.equal(forward.evidence.untrustedRunCount, 2);
  });

  test('findings of same-timestamp runs index deterministically', () => {
    const a = dup([finding(FP_A, { file: 'src/a.mjs' })], '2026-07-20T00:00:00.000Z');
    const b = { ...dup([finding(FP_A, { file: 'src/z.mjs' })], '2026-07-20T00:00:00.000Z') };
    b.runId = 'run-other';
    const feedbackEntries = [
      feedback({ runId: 'run-dup', pr: 1 }),
      feedback({ pr: 2, runId: null }),
    ];
    const forward = buildShadowAggregate({ runRecords: [a, b], feedbackEntries, now: NOW });
    const reversed = buildShadowAggregate({ runRecords: [b, a], feedbackEntries, now: NOW });
    assert.equal(JSON.stringify(forward), JSON.stringify(reversed));
  });
});

describe('shadow-aggregate 契約4: content-addressed candidate id', () => {
  test('the same evidence in any order converges on the same id', () => {
    const refs = [
      { review_run_id: 'run-1', findingFingerprint: FP_A, feedbackType: 'false_positive', pr: 1 },
      { review_run_id: 'run-2', findingFingerprint: FP_A, feedbackType: 'false_positive', pr: 2 },
    ];
    const base = { clusterKey: 'secret-scanner::false_positive' };
    assert.equal(
      computeCandidateId({ ...base, evidence: refs }).candidateId,
      computeCandidateId({ ...base, evidence: [...refs].reverse() }).candidateId
    );
  });

  test('the id does not depend on the generation date', () => {
    const input = scenario();
    const early = buildShadowAggregate({ ...input, now: new Date('2026-01-01T00:00:00.000Z') });
    const late = buildShadowAggregate({ ...input, now: new Date('2026-12-31T00:00:00.000Z') });
    assert.equal(early.candidate.candidateId, late.candidate.candidateId);
    assert.notEqual(early.candidate.createdAt, late.candidate.createdAt);
    assert.match(early.candidate.candidateId, /^RR-PC-[0-9a-f]{12}$/);
    assert.match(early.candidate.contentHash, /^[0-9a-f]{64}$/);
  });

  test('the shadow id equals the id `river promote propose` would mint (B1)', () => {
    // Same evidence must yield ONE candidate identity across the shadow
    // observation and the persisted promotion candidate.
    const feedbackEntries = [feedback({ pr: 1 }), feedback({ pr: 2, runId: 'run-2' })];
    const runRecords = [runRecord({ runId: 'run-1', findings: [finding(FP_A)] })];
    const aggregate = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });
    const proposed = buildProposedCandidate({
      entries: feedbackEntries,
      clusterKey: 'secret-scanner::false_positive',
      now: NOW,
    });
    assert.equal(aggregate.candidate.candidateId, proposed.candidateId);
    assert.equal(aggregate.candidate.contentHash, proposed.contentHash);
    assert.equal(aggregate.candidate.uniqueEvidenceCount, proposed.evidenceCount);
  });

  test('each sub-cluster of a split class converges with propose (B1, 2 fingerprints)', () => {
    // Two fingerprints inside ONE (skillId, feedbackType) class: stage 2 splits
    // it into two sub-clusters. Feeding a sub-cluster's sourceFeedbackRefs into
    // `river promote propose` must mint that sub-cluster's id — the whole
    // cluster's JSONL would produce a third, different id.
    const feedbackEntries = [
      feedback({ pr: 1, fingerprint: FP_A }),
      feedback({ pr: 2, fingerprint: FP_A, runId: 'run-2' }),
      feedback({ pr: 3, fingerprint: FP_B }),
      feedback({ pr: 4, fingerprint: FP_B, runId: 'run-2' }),
    ];
    const runRecords = [
      runRecord({ runId: 'run-1', findings: [finding(FP_A)] }),
      runRecord({
        runId: 'run-2',
        timestamp: '2026-07-22T00:00:00.000Z',
        findings: [finding(FP_B, { file: 'src/b.mjs', category: 'testing' })],
      }),
    ];
    const aggregate = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });
    const [cluster] = aggregate.clusters;
    assert.equal(cluster.subClusters.length, 2);

    const idsFromPropose = new Set();
    for (const sub of cluster.subClusters) {
      // The refs are accepted as-is by propose's input contract (this throws if
      // skillId is missing or the row falls outside the cluster key).
      const proposed = buildProposedCandidate({
        entries: sub.evidence,
        clusterKey: cluster.clusterKey,
        now: NOW,
      });
      assert.equal(
        proposed.candidateId,
        computeCandidateId({ clusterKey: cluster.clusterKey, evidence: sub.evidence }).candidateId
      );
      idsFromPropose.add(proposed.candidateId);
    }
    // Two distinct sub-clusters must not collapse onto one candidate id.
    assert.equal(idsFromPropose.size, 2);

    // The candidate the aggregate selected converges with propose over its own
    // sourceFeedbackRefs.
    const selected = buildProposedCandidate({
      entries: aggregate.candidate.sourceFeedbackRefs,
      clusterKey: aggregate.candidate.clusterKey,
      now: NOW,
    });
    assert.equal(selected.candidateId, aggregate.candidate.candidateId);
    assert.equal(selected.contentHash, aggregate.candidate.contentHash);
    assert.ok(idsFromPropose.has(aggregate.candidate.candidateId));
  });

  test('the policy version is the shared one and unknown versions are rejected', () => {
    assert.equal(SHADOW_AGGREGATE_POLICY_VERSION, CANDIDATE_POLICY_VERSION);
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    assert.equal(aggregate.candidate.policyVersion, CANDIDATE_POLICY_VERSION);
    assert.throws(
      () => buildShadowAggregate({ ...scenario(), now: NOW, policyVersion: 'shadow/next' }),
      /Unknown policyVersion/
    );
  });

  test('duplicate evidence rows collapse before hashing', () => {
    const ref = {
      review_run_id: 'run-1',
      findingFingerprint: FP_A,
      feedbackType: 'false_positive',
      pr: 1,
    };
    const once = computeCandidateId({ clusterKey: 'k::false_positive', evidence: [ref] });
    const twice = computeCandidateId({
      clusterKey: 'k::false_positive',
      evidence: [ref, { ...ref }],
    });
    assert.equal(once.candidateId, twice.candidateId);
    assert.equal(twice.evidenceCount, 1);
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

  test('every run counts as untrusted regardless of the claimed source', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    assert.equal(aggregate.evidence.trustedRunCount, 0);
    assert.equal(aggregate.evidence.untrustedRunCount, 2);
    assert.equal(aggregate.candidate.trust.trustedEvidenceCount, 0);
    assert.equal(aggregate.candidate.trust.untrustedEvidenceCount, 2);
  });

  test('the candidate states why nothing can be trusted', () => {
    const aggregate = buildShadowAggregate({ ...scenario(), now: NOW });
    assert.ok(aggregate.candidate.trust.reasons.some((r) => r.includes('untrusted')));
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

  test('a mistyped subcommand exits 1 instead of reporting an empty aggregate', async () => {
    const res = await runCliInProcess(['evolve', 'agregate', '--output', 'json']);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Unknown evolve subcommand: agregate/);
    assert.equal(res.stdout, '');
  });

  test('a surplus positional argument exits 1', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    const res = await runCliInProcess(['evolve', 'aggregate', root, 'extra']);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Unexpected argument/);
  });

  test('an unknown option exits 1', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    const res = await runCliInProcess(['evolve', 'aggregate', root, '--promote']);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Unknown option for evolve: --promote/);
  });

  test('--output yaml / html are rejected rather than silently rendered as text', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    for (const mode of ['yaml', 'html']) {
      const res = await runCliInProcess(['evolve', 'aggregate', root, '--output', mode]);
      assert.equal(res.code, 1, mode);
      assert.match(res.stderr, /Unsupported --output/);
    }
  });

  test('--month scopes runs as well as feedback', async (t) => {
    const { root, cleanup } = seedRepo();
    t.after(cleanup);
    const res = await runCliInProcess([
      'evolve',
      'aggregate',
      root,
      '--month',
      '2026-06',
      '--output',
      'json',
    ]);
    assert.equal(res.code, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    // The seeded runs are all from 2026-07, so a 2026-06 report has none.
    assert.equal(parsed.inputs.runCount, 0);
    assert.equal(parsed.inputs.feedbackCount, 0);
    assert.equal(parsed.candidate, null);
  });
});

// ---------------------------------------------------------------------------
// #1673 producer: `river feedback add --run-id` closes the 契約2 join.
//
// The W3 block above stays as-is: it is now the regression test for feedback
// written BEFORE this producer existed (no review_run_id at all). This block is
// the same shape with the producer in the loop.
//
// Every artifact below is produced by the EXISTING production path —
// buildRunRecord -> saveRunRecord -> loadAllRunRecords for runs, and
// buildFeedbackEntry -> appendFeedbackEntry -> listFeedbackEntries for feedback
// — before buildShadowAggregate reads it back off disk. Asserting only that
// `deriveFeedbackReviewRunId` can read what `buildFeedbackEntry` just wrote
// would be self-consistent and would pass even if the two halves disagreed.
// ---------------------------------------------------------------------------

async function seedRepoViaProducers({ withRunId }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rr-producer-'));
  const runIds = [];
  for (let i = 0; i < 2; i += 1) {
    const record = buildRunRecord(
      {
        repoRoot: root,
        changedFiles: ['src/a.mjs'],
        findings: [
          { fingerprint: FP_A, file: 'src/a.mjs', ruleId: 'secret-scanner', severity: 'major' },
        ],
      },
      { phase: 'midstream' }
    );
    await saveRunRecord(record);
    runIds.push(record.runId);
  }
  // generateRunId() is timestamp + random suffix; a collision would silently
  // turn this into a one-run scenario, so fail loudly instead.
  assert.notEqual(runIds[0], runIds[1], 'the two saved runs must have distinct ids');

  for (const [i, runId] of runIds.entries()) {
    const entry = buildFeedbackEntry({
      feedbackType: 'false_positive',
      skillId: 'secret-scanner',
      findingFingerprint: FP_A,
      pr: i + 1,
      now: NOW,
      ...(withRunId ? { reviewRunId: runId } : {}),
    });
    await appendFeedbackEntry(entry, { repoRoot: root });
  }

  const runRecords = await loadAllRunRecords(resolveStoreDir(root));
  const feedbackEntries = await listFeedbackEntries({ repoRoot: root });
  const aggregate = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });
  return {
    root,
    runIds,
    aggregate,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('shadow-aggregate producer による 契約2 join 成立（#1673）', () => {
  test('feedback written with --run-id joins the saved runs it came from', async (t) => {
    const { runIds, aggregate, cleanup } = await seedRepoViaProducers({ withRunId: true });
    t.after(cleanup);

    assert.equal(aggregate.inputs.runCount, 2);
    assert.equal(aggregate.inputs.feedbackCount, 2);
    assert.ok(aggregate.join.joinedFeedbackCount > 0, 'the join is no longer degenerate');
    assert.equal(aggregate.join.joinedFeedbackCount, 2);
    assert.equal(aggregate.join.unjoinedFeedbackCount, 0);
    assert.deepEqual(aggregate.join.runIdsWithEvidence, [...runIds].sort());
    assert.deepEqual(aggregate.join.duplicateReviewRunIds, []);

    // The candidate now carries the run evidence W3 asserts is empty today.
    assert.deepEqual(aggregate.candidate.sourceReviewRunIds, [...runIds].sort());
    assert.equal(aggregate.candidate.evidence.length, 2);
    assert.equal(aggregate.candidate.trust.unjoinedEvidenceCount, 0);
  });

  test('the same repo without --run-id still degrades to zero joins', async (t) => {
    const { aggregate, cleanup } = await seedRepoViaProducers({ withRunId: false });
    t.after(cleanup);

    assert.equal(aggregate.join.joinedFeedbackCount, 0);
    assert.equal(aggregate.join.unjoinedFeedbackCount, 2);
    assert.deepEqual(aggregate.candidate.evidence, []);
    assert.deepEqual(aggregate.candidate.sourceReviewRunIds, []);
  });

  test('the candidate id is unchanged by review_run_id (it is not a hash input)', async (t) => {
    const joined = await seedRepoViaProducers({ withRunId: true });
    t.after(joined.cleanup);
    const legacy = await seedRepoViaProducers({ withRunId: false });
    t.after(legacy.cleanup);

    // normalizeEvidence projects evidence to {feedbackType, findingFingerprint,
    // pr}; adding review_run_id must not mint a second identity for evidence a
    // human already reviewed under the old id.
    assert.equal(joined.aggregate.candidate.candidateId, legacy.aggregate.candidate.candidateId);
    assert.equal(joined.aggregate.candidate.contentHash, legacy.aggregate.candidate.contentHash);
    assert.equal(
      joined.aggregate.candidate.uniqueEvidenceCount,
      legacy.aggregate.candidate.uniqueEvidenceCount
    );
  });

  test('the trust boundary is unchanged: nothing is promoted by joining', async (t) => {
    const { aggregate, cleanup } = await seedRepoViaProducers({ withRunId: true });
    t.after(cleanup);

    // A producer only adds a self-report; it adds no verifiability (契約1).
    assert.equal(aggregate.evidence.trustedRunCount, 0);
    assert.equal(aggregate.evidence.untrustedRunCount, 2);
    assert.equal(aggregate.candidate.trust.trustedEvidenceCount, 0);
    assert.equal(aggregate.candidate.trust.untrustedEvidenceCount, 2);
    assert.equal(aggregate.candidate.trust.canaryEligible, false);
    for (const evidence of aggregate.evidence.runs) {
      assert.equal(evidence.trust_level, 'untrusted');
      assert.equal(evidence.provenance_verified, false);
    }
  });

  test('the joined aggregate is still schema-valid', async (t) => {
    const { aggregate, cleanup } = await seedRepoViaProducers({ withRunId: true });
    t.after(cleanup);
    assert.equal(
      validateAggregate(aggregate),
      true,
      JSON.stringify(validateAggregate.errors, null, 2)
    );
  });
});

// ---------------------------------------------------------------------------
// #1673: `--run-id` widens what counts as a distinct occurrence, because the
// occurrence key is `(review_run_id, pr)`. These two cases are the INTENDED
// semantics, pinned so a later change cannot revert them silently: a finding
// that comes back on a second run is the recurrence the Judgment Promotion
// Loop is looking for, and P1/P2 stay observation-only so nothing is promoted
// automatically off the back of it.
// ---------------------------------------------------------------------------

describe('shadow-aggregate `--run-id` による occurrence 判定の意図的な拡張（#1673）', () => {
  test('intended: two runs on the SAME pr are two occurrences, not one re-litigation', () => {
    const runRecords = [
      runRecord({ runId: 'run-1', findings: [finding(FP_A)] }),
      runRecord({
        runId: 'run-2',
        timestamp: '2026-07-22T00:00:00.000Z',
        findings: [finding(FP_A)],
      }),
    ];
    // Same PR, same fingerprint — only the run differs (a re-run after revise).
    const feedbackEntries = [
      feedback({ pr: 7, runId: 'run-1' }),
      feedback({ pr: 7, runId: 'run-2', timestamp: '2026-07-22T00:00:00.000Z' }),
    ];
    const aggregate = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });
    const [sub] = aggregate.clusters[0].subClusters;
    assert.equal(sub.distinctPrCount, 1, 'still a single PR');
    assert.equal(sub.distinctRunCount, 2);
    assert.equal(sub.distinctOccurrenceCount, 2, 'the run makes these two occurrences');
    assert.equal(sub.experimentEligible, true);

    // Without --run-id the same rows collapse onto the PR and stay ineligible.
    const legacy = buildShadowAggregate({
      runRecords,
      feedbackEntries: feedbackEntries.map(({ review_run_id: _drop, ...rest }) => rest),
      now: NOW,
    });
    assert.equal(legacy.clusters[0].subClusters[0].distinctOccurrenceCount, 1);
    assert.equal(legacy.clusters[0].subClusters[0].experimentEligible, false);
  });

  test('intended: rows with a run but no pr are attributable and do count', () => {
    const runRecords = [
      runRecord({ runId: 'run-1', findings: [finding(FP_A)] }),
      runRecord({
        runId: 'run-2',
        timestamp: '2026-07-22T00:00:00.000Z',
        findings: [finding(FP_A)],
      }),
    ];
    const feedbackEntries = [
      feedback({ pr: null, runId: 'run-1' }),
      feedback({ pr: null, runId: 'run-2', timestamp: '2026-07-22T00:00:00.000Z' }),
    ];
    const aggregate = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });
    const [sub] = aggregate.clusters[0].subClusters;
    assert.equal(sub.distinctPrCount, 0);
    assert.equal(sub.distinctOccurrenceCount, 2, 'the run alone attributes the row');
    assert.equal(sub.experimentEligible, true);

    // Neither a run nor a PR remains unattributable, as before.
    const orphan = buildShadowAggregate({
      runRecords,
      feedbackEntries: feedbackEntries.map(({ review_run_id: _drop, ...rest }) => rest),
      now: NOW,
    });
    assert.equal(orphan.clusters[0].subClusters[0].distinctOccurrenceCount, 0);
    assert.equal(orphan.clusters[0].subClusters[0].experimentEligible, false);
  });
});

describe('shadow-aggregate 未解決 run id の trust カウンタ整合（#1673 W4）', () => {
  test('an unresolvable run id counts as unjoined in BOTH join and trust', () => {
    const runRecords = [runRecord({ runId: 'run-1', findings: [finding(FP_A)] })];
    const feedbackEntries = [
      feedback({ pr: 1, runId: 'run-1' }),
      // A typo'd / pruned run id: present, but no saved run resolves it.
      feedback({ pr: 2, runId: 'run-typo', timestamp: '2026-07-22T00:00:00.000Z' }),
    ];
    const aggregate = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });

    assert.equal(aggregate.join.joinedFeedbackCount, 1);
    assert.equal(aggregate.join.unjoinedFeedbackCount, 1);
    // The two numbers describe the same rows and must not contradict:
    // counting only "no id at all" reported 0 here while join reported 1.
    assert.equal(aggregate.candidate.trust.unjoinedEvidenceCount, 1);
    assert.equal(aggregate.candidate.sourceReviewRunIds.length, 2, 'the id is still surfaced');
    assert.equal(aggregate.candidate.evidence.length, 1, 'but only one resolves to evidence');
  });

  test('a missing run id is still counted as unjoined (unchanged)', () => {
    const runRecords = [runRecord({ runId: 'run-1', findings: [finding(FP_A)] })];
    const feedbackEntries = [
      feedback({ pr: 1, runId: 'run-1' }),
      feedback({ pr: 2, runId: null, timestamp: '2026-07-22T00:00:00.000Z' }),
    ];
    const aggregate = buildShadowAggregate({ runRecords, feedbackEntries, now: NOW });
    assert.equal(aggregate.join.unjoinedFeedbackCount, 1);
    assert.equal(aggregate.candidate.trust.unjoinedEvidenceCount, 1);
  });
});
