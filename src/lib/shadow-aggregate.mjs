// Shadow aggregate (#1574 P1) — read-only multi-run aggregation.
//
// Aggregates completed review runs (`.river/runs/`) and captured feedback
// (`.river/feedback/*.jsonl`) into a single observation artifact plus at most
// ONE ReviewImprovementCandidate, WITHOUT mutating any repository surface.
//
// Read-only by construction: this module performs no filesystem, network, or
// process side effects at all — callers pass already-loaded records in and get
// plain objects back. Canary, rollback, and automatic promotion are explicitly
// out of scope (P3/P4, and the promotion lifecycle itself stays #1568-C's).
//
// Design contract compliance (docs/development/1574-p0-design-contract.md):
//   契約1 evidence provenance  → buildRunEvidence / evidenceTrustLevel
//   契約2 canonical run id     → deriveReviewRunId / deriveFeedbackReviewRunId
//   契約4 content-addressed ID → computeCandidateId (date-independent)
//   契約5 two-stage clustering → buildClusters (stage 1 / stage 2)
import { createHash } from 'node:crypto';

export const SHADOW_AGGREGATE_SCHEMA_VERSION = 1;

// Policy version participates in the candidate content hash (契約4): changing
// the aggregation policy must produce a different candidate ID for the same
// evidence set.
export const SHADOW_AGGREGATE_POLICY_VERSION = 'shadow-aggregate/p1';

// Collector identity recorded in every evidence record (契約1).
export const COLLECTOR_VERSION = 'river-shadow-aggregate/1';

/** Evidence sources defined by 契約1. Order is meaningful only for docs. */
export const EVIDENCE_SOURCES = ['local', 'CI', 'protected-branch', 'human'];

/**
 * The only trust level P1 can emit.
 *
 * Every provenance field this module reads comes from `.river/runs/*.json`,
 * which lives INSIDE the reviewed repository and is writable by the agent
 * under review (result-store.mjs:34-43 trust-boundary note). A record can
 * therefore claim `evidence_source: 'CI'` and `trusted_by: 'github-actions'`
 * with no verification whatsoever, so honouring that claim would let a forged
 * file mint trusted evidence. P1 closes the promotion path entirely: the
 * verification mechanism for `trusted_by` (CI attestation / signed record) is
 * an explicit 契約1 未決事項 and lands in P2.
 */
export const P1_TRUST_LEVEL = 'untrusted';

/** Recurrence threshold for stage-1 clustering (契約5), same default as #1568-A. */
export const DEFAULT_MIN_RECURRENCE = 2;

/**
 * Improvement target taxonomy from the #1574 Epic body ("改善対象の分類案").
 * Deliberately distinct from #1568's `proposedTarget` (fixture/rule/skill/...):
 * #1574 selects an *investment surface*, #1568 owns the promotion target.
 */
const TARGET_SURFACE_BY_FEEDBACK_TYPE = {
  duplicate: 'routing',
  out_of_scope: 'context',
  missed_issue: 'judgment',
  accepted_risk: 'judgment',
  false_positive: 'memory',
  not_actionable: 'reviewer',
  unclear: 'reviewer',
};

const OBSERVED_PATTERN_BY_FEEDBACK_TYPE = {
  duplicate: '同一の指摘が複数 skill から重複して出ている',
  out_of_scope: '差分スコープ外の指摘が繰り返し出ている',
  missed_issue: '検出されるべき問題が繰り返し見逃されている',
  accepted_risk: '同じリスクを繰り返し許容している',
  false_positive: '同じ誤検出が繰り返し発生している',
  not_actionable: '指摘が繰り返し実行可能な形になっていない',
  unclear: '指摘の意味が繰り返し伝わっていない',
};

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Recursively sort object keys so JSON.stringify is order-independent. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

/** Canonical (key-sorted) JSON serialization used for every content hash. */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value ?? null));
}

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function compareStrings(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 契約2: canonical review_run_id
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical `review_run_id` of a saved run record.
 *
 * The field is additive and optional (契約2): an explicit `review_run_id`
 * wins, otherwise the existing `runId` is used as the canonical value. No
 * record is rewritten — this is a read-side resolution only.
 *
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function deriveReviewRunId(record) {
  return (
    nonEmptyString(record?.review_run_id) ??
    nonEmptyString(record?.reviewRunId) ??
    nonEmptyString(record?.runId)
  );
}

/**
 * Resolve the canonical `review_run_id` a feedback entry points at.
 *
 * Unlike run records there is no legacy fallback: historical feedback entries
 * carry no run reference at all, so they simply stay unjoined (and are
 * reported as such) until the field is propagated.
 *
 * @param {object|null|undefined} entry
 * @returns {string|null}
 */
export function deriveFeedbackReviewRunId(entry) {
  return nonEmptyString(entry?.review_run_id) ?? nonEmptyString(entry?.reviewRunId);
}

// ---------------------------------------------------------------------------
// 契約1: evidence provenance / trust boundary
// ---------------------------------------------------------------------------

/**
 * Trust level of an evidence record — always `untrusted` in P1.
 *
 * The argument is accepted (and ignored) so the signature stays stable for P2,
 * where a verified `trusted_by` may promote a record. Until that verification
 * exists, no field combination can raise the level: see P1_TRUST_LEVEL.
 *
 * @param {object} [_evidence] self-reported provenance (unverified)
 * @returns {'untrusted'}
 */
export function evidenceTrustLevel(_evidence) {
  return P1_TRUST_LEVEL;
}

/**
 * Build the 契約1 provenance record for one saved run.
 *
 * Every field here is SELF-REPORTED by the reviewed repository: `provenance`
 * is read from the run record itself, which the agent under review can write.
 * The record is reproduced as claimed (so a human can inspect it), but it is
 * never used to raise trust — `provenance_verified` is a constant `false` and
 * `trust_level` a constant `untrusted` (see P1_TRUST_LEVEL).
 *
 * `artifact_sha256` is a SELF-DIGEST: it hashes the canonical JSON of the same
 * record it is stored on. It detects accidental drift between copies of one
 * record; it does NOT prove the record is authentic, because whoever can edit
 * the record can recompute the digest.
 *
 * @param {object} record saved run record
 * @param {{ collectorVersion?: string }} [options]
 */
export function buildRunEvidence(record, { collectorVersion = COLLECTOR_VERSION } = {}) {
  const provenance = record?.provenance ?? {};
  const source = EVIDENCE_SOURCES.includes(provenance.evidenceSource)
    ? provenance.evidenceSource
    : 'local';
  const evidence = {
    review_run_id: deriveReviewRunId(record),
    // Claimed source. Recorded for observation only — never a trust input.
    evidence_source: source,
    source_commit_sha:
      nonEmptyString(provenance.sourceCommitSha) ?? nonEmptyString(record?.commitSha),
    artifact_sha256: sha256Hex(canonicalJson(record)),
    collector_version: collectorVersion,
    trusted_by: nonEmptyString(provenance.trustedBy),
    generated_by_candidate: provenance.generatedByCandidate === true,
    provenance_verified: false,
  };
  return { ...evidence, trust_level: evidenceTrustLevel(evidence) };
}

// ---------------------------------------------------------------------------
// 契約5: two-stage clustering
// ---------------------------------------------------------------------------

/**
 * Index findings of all runs by fingerprint so stage-2 clustering can attach
 * category / scope to a feedback entry. Later runs win for the same
 * fingerprint (same convention as diffRunHistory).
 *
 * @param {object[]} runRecords
 * @returns {Map<string, { category: string|null, scope: string|null, review_run_id: string|null }>}
 */
function indexFindingsByFingerprint(runRecords) {
  const index = new Map();
  // Two-key sort: records sharing a timestamp (or missing one) must still have
  // a total order, otherwise "last run wins" depends on directory read order.
  const ordered = [...runRecords].sort(
    (a, b) =>
      compareStrings(a?.timestamp ?? '', b?.timestamp ?? '') ||
      compareStrings(deriveReviewRunId(a), deriveReviewRunId(b))
  );
  for (const record of ordered) {
    const reviewRunId = deriveReviewRunId(record);
    for (const finding of record?.findings ?? []) {
      const fingerprint = nonEmptyString(finding?.fingerprint);
      if (!fingerprint) continue;
      index.set(fingerprint, {
        // `category` is not part of the current finding shape; `ruleId` (set to
        // the emitting skill id by review-engine / local-runner) is what real
        // findings carry today, so it is the working fallback.
        category: nonEmptyString(finding?.category) ?? nonEmptyString(finding?.ruleId),
        scope: nonEmptyString(finding?.file),
        review_run_id: reviewRunId,
      });
    }
  }
  return index;
}

/** Stage-2 sub-cluster key. `failureMode` is intentionally absent (see below). */
function subClusterKeyOf({ fingerprint, category, scope }) {
  return [fingerprint ?? 'no-fingerprint', category ?? 'no-category', scope ?? 'no-scope'].join(
    '::'
  );
}

/**
 * Two-stage clustering (契約5).
 *
 * - Stage 1 detects recurrence on `(skillId, feedbackType)` — byte-identical
 *   key format to #1568-A's clusterKey, so both loops group the same way.
 * - Stage 2 splits a recurring class into cause hypotheses by
 *   fingerprint / category / scope.
 *
 * `failureMode` is emitted as `null` on purpose: 契約5 defers the failure-mode
 * vocabulary until it has been *observed* in P1, so inventing one here would
 * pre-empt the contract.
 *
 * Eligibility is decided on DISTINCT occurrences, not on row count: several
 * feedback rows sharing one fingerprint are one re-litigated finding, not
 * recurrence (the same defence `reviewPromotionEffectiveness` already applies
 * in src/lib/promotion.mjs). Sub-clusters without a fingerprint, or without
 * `minRecurrence` distinct (run, PR) occurrences, stay visible but carry
 * `experimentEligible: false` and must never feed an experiment or promotion.
 *
 * @param {object[]} feedbackEntries
 * @param {{ minRecurrence?: number, findingIndex?: Map<string, object> }} [options]
 */
export function buildClusters(
  feedbackEntries,
  { minRecurrence = DEFAULT_MIN_RECURRENCE, findingIndex = new Map() } = {}
) {
  const stage1 = new Map();
  for (const entry of feedbackEntries ?? []) {
    // Key components are used RAW (not trimmed) so the stage-1 clusterKey is
    // byte-identical to #1568-A's (scripts/feedback-rule-candidates.mjs), which
    // is the SSoT for this key. Blank values are skipped as unusable.
    const skillId = nonEmptyString(entry?.skillId) ? entry.skillId : null;
    const feedbackType = nonEmptyString(entry?.feedbackType) ? entry.feedbackType : null;
    if (!skillId || !feedbackType) continue;
    // `accepted` is a positive signal — never an improvement candidate.
    if (feedbackType === 'accepted') continue;
    const clusterKey = `${skillId}::${feedbackType}`;
    if (!stage1.has(clusterKey)) stage1.set(clusterKey, { skillId, feedbackType, entries: [] });
    stage1.get(clusterKey).entries.push(entry);
  }

  const clusters = [];
  for (const [clusterKey, { skillId, feedbackType, entries }] of stage1) {
    if (entries.length < minRecurrence) continue;
    const stage2 = new Map();
    for (const entry of entries) {
      const fingerprint = nonEmptyString(entry?.findingFingerprint);
      const finding = fingerprint ? (findingIndex.get(fingerprint) ?? null) : null;
      const shape = {
        fingerprint,
        category: finding?.category ?? null,
        scope: finding?.scope ?? null,
      };
      const key = subClusterKeyOf(shape);
      if (!stage2.has(key)) {
        stage2.set(key, {
          subClusterKey: key,
          ...shape,
          // 契約5 未決事項: the failure-mode vocabulary is decided AFTER P1
          // observation, so P1 records the raw signals and leaves this null.
          failureMode: null,
          evidence: [],
        });
      }
      stage2.get(key).evidence.push(buildFeedbackRef(entry));
    }
    const subClusters = [...stage2.values()]
      .map((sub) => {
        const distinctOccurrenceCount = distinctCount(sub.evidence.map(occurrenceKey));
        return {
          ...sub,
          count: sub.evidence.length,
          // A fingerprint identifies ONE finding, so this is 1 (or 0 when the
          // sub-cluster has no fingerprint) by construction — surfaced so the
          // gap against the raw `count` is visible in the artifact.
          distinctFindingCount: sub.fingerprint == null ? 0 : 1,
          distinctPrCount: distinctCount(sub.evidence.map((ref) => ref.pr)),
          distinctRunCount: distinctCount(sub.evidence.map((ref) => ref.review_run_id)),
          distinctOccurrenceCount,
          experimentEligible: sub.fingerprint != null && distinctOccurrenceCount >= minRecurrence,
          evidence: sortFeedbackRefs(sub.evidence),
        };
      })
      .sort((a, b) => b.count - a.count || compareStrings(a.subClusterKey, b.subClusterKey));
    clusters.push({
      clusterKey,
      skillId,
      feedbackType,
      // Raw row count. Compare against the distinct counters before treating it
      // as recurrence evidence.
      count: entries.length,
      distinctFindingCount: distinctCount(entries.map((e) => e.findingFingerprint)),
      distinctPrCount: distinctCount(entries.map((e) => e.pr)),
      subClusters,
    });
  }
  return clusters.sort((a, b) => b.count - a.count || compareStrings(a.clusterKey, b.clusterKey));
}

/** Count distinct non-null / non-empty values. */
function distinctCount(values) {
  return new Set(values.filter((v) => v != null && v !== '')).size;
}

/**
 * Identify the occurrence a feedback row belongs to. Rows that carry neither a
 * run nor a PR cannot be attributed and return null, so they never count as
 * independent recurrence evidence.
 */
function occurrenceKey(ref) {
  if (ref.review_run_id == null && ref.pr == null) return null;
  return `${ref.review_run_id ?? ''}#${ref.pr ?? ''}`;
}

function buildFeedbackRef(entry) {
  return {
    review_run_id: deriveFeedbackReviewRunId(entry),
    timestamp: nonEmptyString(entry?.timestamp),
    feedbackType: nonEmptyString(entry?.feedbackType),
    findingFingerprint: nonEmptyString(entry?.findingFingerprint),
    pr: Number.isInteger(entry?.pr) && entry.pr > 0 ? entry.pr : null,
  };
}

function sortFeedbackRefs(refs) {
  return [...refs].sort(
    (a, b) =>
      compareStrings(a.timestamp, b.timestamp) ||
      compareStrings(a.review_run_id, b.review_run_id) ||
      compareStrings(a.findingFingerprint, b.findingFingerprint) ||
      (a.pr ?? 0) - (b.pr ?? 0)
  );
}

// ---------------------------------------------------------------------------
// 契約4: content-addressed candidate ID
// ---------------------------------------------------------------------------

/**
 * Compute the content-addressed candidate ID.
 *
 * Hashed inputs are the normalized evidence set, the two cluster keys, and the
 * policy version — deliberately NOT the generation date (契約4): re-running the
 * aggregate over the same evidence converges on the same candidate.
 *
 * @param {{ policyVersion: string, clusterKey: string, subClusterKey: string, evidence: object[] }} input
 * @returns {string} `RR-IC-<12 hex>`
 */
export function computeCandidateId({ policyVersion, clusterKey, subClusterKey, evidence }) {
  const normalized = {
    policyVersion,
    clusterKey,
    subClusterKey,
    // Each ref is serialized as canonical JSON rather than joined with a
    // separator: a delimiter join is ambiguous as soon as a field can contain
    // the delimiter, which would let two different evidence sets collide.
    evidence: [...(evidence ?? [])]
      .map((ref) =>
        canonicalJson({
          review_run_id: ref.review_run_id ?? null,
          findingFingerprint: ref.findingFingerprint ?? null,
          feedbackType: ref.feedbackType ?? null,
          timestamp: ref.timestamp ?? null,
          pr: ref.pr ?? null,
        })
      )
      .sort(compareStrings),
  };
  return `RR-IC-${sha256Hex(canonicalJson(normalized)).slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Candidate + aggregate assembly
// ---------------------------------------------------------------------------

/**
 * Select the single sub-cluster P1 turns into a candidate.
 *
 * Preference order: experiment-eligible (fingerprinted) sub-clusters first,
 * then higher evidence count, then lexicographic key for a stable tie-break.
 */
function selectSubCluster(clusters) {
  let best = null;
  for (const cluster of clusters) {
    for (const sub of cluster.subClusters) {
      const candidate = { cluster, sub };
      if (!best) {
        best = candidate;
        continue;
      }
      if (sub.experimentEligible !== best.sub.experimentEligible) {
        if (sub.experimentEligible) best = candidate;
        continue;
      }
      if (sub.count !== best.sub.count) {
        if (sub.count > best.sub.count) best = candidate;
        continue;
      }
      if (compareStrings(sub.subClusterKey, best.sub.subClusterKey) < 0) best = candidate;
    }
  }
  return best;
}

/**
 * Build the shadow ReviewImprovementCandidate for one selected sub-cluster.
 *
 * The candidate is an observation only: `mode: 'shadow'`, `status: 'observed'`,
 * `writeEffects: []`, and a trust block whose `canaryEligible` is hard-wired
 * to `false` in P1 (契約1: candidate adoption requires trusted evidence
 * produced outside the candidate's own write scope — that gate lands in P2+).
 */
function buildShadowCandidate({ cluster, sub, evidenceByRunId, now, policyVersion }) {
  const evidence = sub.evidence;
  const sourceReviewRunIds = [
    ...new Set(evidence.map((ref) => ref.review_run_id).filter(Boolean)),
  ].sort(compareStrings);
  const runEvidence = sourceReviewRunIds
    .map((id) => evidenceByRunId.get(id) ?? null)
    .filter(Boolean);
  const trustedEvidenceCount = runEvidence.filter((e) => e.trust_level === 'trusted').length;
  const reasons = [];
  if (!sub.experimentEligible) {
    reasons.push(
      sub.fingerprint == null
        ? 'finding fingerprint がないため自動実験・昇格の対象にしない（契約5）'
        : `distinct な occurrence が ${sub.distinctOccurrenceCount} 件しかなく反復証拠として不足（契約5）`
    );
  }
  reasons.push(
    'saved run の provenance は被レビュー側が書き換え可能で未検証のため、すべて untrusted 扱い（契約1）'
  );
  reasons.push('P1 は shadow 観測のみで canary へ進まない（実装順 P3 以降）');

  return {
    schemaVersion: SHADOW_AGGREGATE_SCHEMA_VERSION,
    candidateId: computeCandidateId({
      policyVersion,
      clusterKey: cluster.clusterKey,
      subClusterKey: sub.subClusterKey,
      evidence,
    }),
    policyVersion,
    createdAt: now.toISOString(),
    mode: 'shadow',
    status: 'observed',
    clusterKey: cluster.clusterKey,
    subClusterKey: sub.subClusterKey,
    skillId: cluster.skillId,
    feedbackType: cluster.feedbackType,
    observedPattern:
      OBSERVED_PATTERN_BY_FEEDBACK_TYPE[cluster.feedbackType] ??
      '同種の feedback が繰り返し発生している',
    // 1 candidate = 1 hypothesis. In P1 the hypothesis is not asserted
    // automatically — a human writes it from the observed cluster.
    causeHypothesis: null,
    targetSurface: TARGET_SURFACE_BY_FEEDBACK_TYPE[cluster.feedbackType] ?? null,
    candidateType: sub.experimentEligible ? 'experiment_candidate' : 'observation_only',
    failureMode: sub.failureMode,
    // Raw row counts. `distinct*` below is what recurrence judgements must use.
    recurrenceCount: cluster.count,
    subClusterCount: sub.count,
    distinctFindingCount: sub.distinctFindingCount,
    distinctPrCount: sub.distinctPrCount,
    distinctRunCount: sub.distinctRunCount,
    distinctOccurrenceCount: sub.distinctOccurrenceCount,
    sourceReviewRunIds,
    sourceFeedbackRefs: evidence,
    evidence: runEvidence,
    trust: {
      trustedEvidenceCount,
      untrustedEvidenceCount: runEvidence.length - trustedEvidenceCount,
      unjoinedEvidenceCount: evidence.filter((ref) => !ref.review_run_id).length,
      canaryEligible: false,
      reasons,
    },
    experimentEligible: sub.experimentEligible,
    requiresHumanApproval: true,
    autoActions: ['observe'],
    // Explicit, machine-checkable statement that P1 mutates nothing.
    writeEffects: [],
  };
}

/**
 * Build the read-only shadow aggregate over completed runs and feedback.
 *
 * Pure function: no I/O, no `Date.now()` (the clock is injected), and stable
 * ordering everywhere, so the same inputs always produce a byte-identical
 * artifact regardless of input order.
 *
 * @param {{
 *   runRecords?: object[],
 *   feedbackEntries?: object[],
 *   now?: Date,
 *   minRecurrence?: number,
 *   month?: string|null,
 *   policyVersion?: string,
 *   collectorVersion?: string,
 * }} [options]
 */
export function buildShadowAggregate({
  runRecords = [],
  feedbackEntries = [],
  now = new Date(),
  minRecurrence = DEFAULT_MIN_RECURRENCE,
  month = null,
  policyVersion = SHADOW_AGGREGATE_POLICY_VERSION,
  collectorVersion = COLLECTOR_VERSION,
} = {}) {
  // `--month` scopes BOTH sides of the aggregate. Filtering only the feedback
  // would silently mix a whole run history into a one-month report.
  const scopedRuns = month
    ? runRecords.filter((record) => String(record?.timestamp ?? '').slice(0, 7) === month)
    : [...runRecords];
  const scopedFeedback = month
    ? (feedbackEntries ?? []).filter(
        (entry) => String(entry?.timestamp ?? '').slice(0, 7) === month
      )
    : [...(feedbackEntries ?? [])];

  const runEvidence = scopedRuns
    .map((record) => buildRunEvidence(record, { collectorVersion }))
    .sort(
      (a, b) =>
        compareStrings(a.review_run_id, b.review_run_id) ||
        compareStrings(a.artifact_sha256, b.artifact_sha256)
    );
  // Two records can claim the same review_run_id (the id is self-reported and
  // the store is writable). Resolve deterministically — lowest artifact_sha256
  // wins — instead of letting directory read order decide, and surface the
  // collision so a human can investigate.
  const evidenceByRunId = new Map();
  const duplicateReviewRunIds = new Set();
  for (const evidence of runEvidence) {
    if (!evidence.review_run_id) continue;
    if (evidenceByRunId.has(evidence.review_run_id)) {
      duplicateReviewRunIds.add(evidence.review_run_id);
      continue; // first wins; runEvidence is already sorted by (id, sha256)
    }
    evidenceByRunId.set(evidence.review_run_id, evidence);
  }
  const trustedRunCount = runEvidence.filter((e) => e.trust_level === 'trusted').length;

  const findingIndex = indexFindingsByFingerprint(scopedRuns);
  const clusters = buildClusters(scopedFeedback, { minRecurrence, findingIndex });

  const joinedFeedbackCount = scopedFeedback.filter((entry) => {
    const id = deriveFeedbackReviewRunId(entry);
    return id != null && evidenceByRunId.has(id);
  }).length;

  const selected = selectSubCluster(clusters);
  const candidate = selected
    ? buildShadowCandidate({ ...selected, evidenceByRunId, now, policyVersion })
    : null;

  return {
    schemaVersion: SHADOW_AGGREGATE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    mode: 'shadow',
    readOnly: true,
    policyVersion,
    collectorVersion,
    inputs: {
      // Counts are POST-`--month` scoping (see scopedRuns / scopedFeedback).
      runCount: scopedRuns.length,
      feedbackCount: scopedFeedback.length,
      minRecurrence,
      month,
    },
    evidence: {
      runs: runEvidence,
      trustedRunCount,
      untrustedRunCount: runEvidence.length - trustedRunCount,
    },
    join: {
      // 契約2 propagation coverage: how much feedback can already be traced
      // back to a saved run through the canonical review_run_id.
      joinedFeedbackCount,
      unjoinedFeedbackCount: scopedFeedback.length - joinedFeedbackCount,
      runIdsWithEvidence: [...evidenceByRunId.keys()].sort(compareStrings),
      duplicateReviewRunIds: [...duplicateReviewRunIds].sort(compareStrings),
    },
    clusters,
    candidate,
  };
}

/**
 * Render the aggregate as Markdown for human review (`--output text`).
 */
export function formatShadowAggregateMarkdown(aggregate) {
  const lines = ['## Shadow aggregate (read-only)', ''];
  lines.push(`| Item | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Generated at | ${aggregate.generatedAt} |`);
  lines.push(`| Policy version | ${aggregate.policyVersion} |`);
  lines.push(`| Month scope | ${aggregate.inputs.month ?? '(all)'} |`);
  lines.push(`| Runs | ${aggregate.inputs.runCount} |`);
  lines.push(
    `| Untrusted evidence | ${aggregate.evidence.untrustedRunCount} / ${aggregate.evidence.runs.length}（P1 は全件 untrusted） |`
  );
  lines.push(`| Feedback entries | ${aggregate.inputs.feedbackCount} |`);
  lines.push(
    `| Feedback joined to a run | ${aggregate.join.joinedFeedbackCount} / ${aggregate.inputs.feedbackCount} |`
  );
  lines.push(`| Duplicate review_run_id | ${aggregate.join.duplicateReviewRunIds.length} |`);
  lines.push(`| Recurring clusters | ${aggregate.clusters.length} |`);
  lines.push('');

  if (aggregate.join.duplicateReviewRunIds.length) {
    lines.push(
      `⚠️ 同一 review_run_id を名乗る run が複数あります: ${aggregate.join.duplicateReviewRunIds
        .map((id) => `\`${id}\``)
        .join(', ')}`
    );
    lines.push('');
  }

  if (aggregate.clusters.length) {
    lines.push('### Clusters (stage 1 → stage 2)');
    for (const cluster of aggregate.clusters) {
      lines.push(
        `- \`${cluster.clusterKey}\`: ${cluster.count} 件（distinct finding ${cluster.distinctFindingCount} / distinct PR ${cluster.distinctPrCount}）`
      );
      for (const sub of cluster.subClusters) {
        const eligible = sub.experimentEligible ? 'experiment-eligible' : 'observation-only';
        lines.push(
          `  - \`${sub.subClusterKey}\`: ${sub.count} 件 / distinct occurrence ${sub.distinctOccurrenceCount} (${eligible})`
        );
      }
    }
    lines.push('');
  }

  if (aggregate.candidate) {
    const c = aggregate.candidate;
    lines.push('### Candidate (shadow, no side effects)');
    lines.push(`- id: \`${c.candidateId}\``);
    lines.push(`- cluster: \`${c.clusterKey}\` → \`${c.subClusterKey}\``);
    lines.push(`- targetSurface: ${c.targetSurface ?? '(未判定)'}`);
    lines.push(`- observedPattern: ${c.observedPattern}`);
    lines.push(`- canaryEligible: ${c.trust.canaryEligible}`);
    for (const reason of c.trust.reasons) lines.push(`  - ${reason}`);
    lines.push('');
  } else {
    lines.push('No recurring cluster reached the threshold — no candidate generated.');
    lines.push('');
  }

  lines.push(
    'このコマンドは読み取り専用です。Skill / Rule / Riverbed / gate / PR には一切書き込みません。'
  );
  return lines.join('\n');
}
