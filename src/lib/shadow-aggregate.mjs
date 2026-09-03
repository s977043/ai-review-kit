// Shadow aggregate (#1574 P1) — read-only multi-run aggregation.
//
// Aggregates completed review runs (`.river/runs/`) and captured feedback
// (`.river/feedback/*.jsonl`) into a single observation artifact plus at most
// ONE ReviewImprovementCandidate, WITHOUT mutating any repository surface.
//
// Read-only by construction: this module performs no filesystem, network, or
// process side effects at all — callers pass already-loaded records in and get
// plain objects back. The `warn` option added in #1823 does not change that: it
// defaults to a no-op, so the only sink is one the caller supplies. Canary,
// rollback, and automatic promotion are explicitly out of scope (P3/P4, and the
// promotion lifecycle itself stays #1568-C's).
//
// Design contract compliance (docs/development/1574-p0-design-contract.md):
//   契約1 evidence provenance  → buildRunEvidence / evidenceTrustLevel
//   契約2 canonical run id     → deriveReviewRunId / deriveFeedbackReviewRunId
//   契約4 content-addressed ID → computeCandidateId (date-independent)
//   契約5 two-stage clustering → buildClusters (stage 1 / stage 2)
import { createHash } from 'node:crypto';

import {
  classifyFingerprintAlgo,
  formatUnmatchedFeedbackFingerprintWarning,
} from './finding-factory.mjs';
import {
  CANDIDATE_POLICY_VERSION,
  KNOWN_POLICY_VERSIONS,
  canonicalJson,
  computeCandidateContentHash,
  // Trim + NFC in ONE place (see promotion-candidates.mjs): this module and
  // paired-replay.mjs feed the same hashes, so a local copy that only trimmed
  // would diverge on NFD input.
  nonEmptyNfcString as nonEmptyString,
  normalizeEvidence,
} from './promotion-candidates.mjs';

// Re-exported so the aggregate's own hashing helpers keep one implementation
// with the candidate id derivation (#1624).
export { canonicalJson };

export const SHADOW_AGGREGATE_SCHEMA_VERSION = 1;

// The candidate id derivation is NOT owned here: it is the one in
// src/lib/promotion-candidates.mjs (#1624 / 契約4), so that the shadow
// observation and `river promote propose` converge on the SAME id for the same
// evidence. That also fixes the policy version to CANDIDATE_POLICY_VERSION —
// the shadow aggregate does not get a hash namespace of its own.
export const SHADOW_AGGREGATE_POLICY_VERSION = CANDIDATE_POLICY_VERSION;

// Collector identity recorded in every evidence record (契約1).
export const COLLECTOR_VERSION = 'river-shadow-aggregate/1';

/** Evidence sources defined by 契約1. Order is meaningful only for docs. */
export const EVIDENCE_SOURCES = ['local', 'CI', 'protected-branch', 'human'];

/**
 * The only trust level P1 can emit.
 *
 * Every provenance field this module reads comes from `.river/runs/*.json`,
 * which lives INSIDE the reviewed repository and is writable by the agent
 * under review (see the trust-boundary note on `buildRunRecord` in
 * result-store.mjs — referenced by symbol, not by line, because line numbers
 * here went stale the first time that file grew). A record can
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

/**
 * Hex sha256 of a string.
 *
 * Exported (#2015) so that content-addressed surfaces added later import this
 * one implementation instead of spelling `createHash('sha256')` again. Two
 * byte-identical private copies already existed (here and in
 * `paired-replay.mjs`); a third would have made the hash a convention rather
 * than a shared function. `paired-replay.mjs` now imports this one.
 *
 * @param {string} input
 * @returns {string} 64 lowercase hex characters
 */
export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
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
 * category / filePath to a feedback entry. Later runs win for the same
 * fingerprint (same convention as diffRunHistory).
 *
 * NOTE: `finding.scope` (the in-diff / pre-existing classification added in
 * #1648) is deliberately NOT read here. The stage-2 axis below is the file the
 * finding was reported on, which is why it is called `filePath` — reusing the
 * name `scope` for it made two unrelated meanings collide. Whether the #1648
 * scope should become an additional clustering axis is left to a later phase.
 *
 * @param {object[]} runRecords
 * @returns {Map<string, { category: string|null, filePath: string|null, review_run_id: string|null }>}
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
        filePath: nonEmptyString(finding?.file),
        review_run_id: reviewRunId,
      });
    }
  }
  return index;
}

/**
 * Stage-2 sub-cluster key. `failureMode` is intentionally absent (see below).
 * The third component is the finding's FILE PATH (see indexFindingsByFingerprint),
 * not the #1648 `finding.scope` classification.
 */
function subClusterKeyOf({ fingerprint, category, filePath }) {
  return [
    fingerprint ?? 'no-fingerprint',
    category ?? 'no-category',
    filePath ?? 'no-file-path',
  ].join('::');
}

/**
 * Two-stage clustering (契約5).
 *
 * - Stage 1 detects recurrence on `(skillId, feedbackType)` — byte-identical
 *   key format to #1568-A's clusterKey, so both loops group the same way.
 * - Stage 2 splits a recurring class into cause hypotheses by
 *   fingerprint / category / filePath.
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
 * What "distinct" means widened once a producer for `review_run_id` existed
 * (#1673). The occurrence key is `(review_run_id, pr)`, so with `--run-id`
 * populated two feedback rows on the SAME PR but different saved runs are two
 * occurrences, not one re-litigation. That is intended: a finding that comes
 * back after a revise is exactly the recurrence the Judgment Promotion Loop
 * is looking for. Before the producer existed such rows collapsed onto the PR
 * alone, so the same data can flip `experimentEligible` false -> true when
 * `--run-id` starts being passed. P1/P2 stay observation-only, so nothing is
 * promoted automatically off the back of that.
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
        filePath: finding?.filePath ?? null,
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
 *
 * Both halves of the key participate, so once `river feedback add --run-id`
 * populates `review_run_id` (#1673) a row with a run but no PR IS attributable
 * and does count, and two rows on one PR from two runs are two occurrences.
 * Intended — see the recurrence note on `buildClusters`. The behaviour here is
 * unchanged; only the data reaching it is richer.
 */
function occurrenceKey(ref) {
  if (ref.review_run_id == null && ref.pr == null) return null;
  return `${ref.review_run_id ?? ''}#${ref.pr ?? ''}`;
}

/**
 * Project one feedback row into the reference stored on a sub-cluster.
 *
 * `skillId` is included so `candidate.sourceFeedbackRefs` is directly usable as
 * the `--input` of `river promote propose`: that command validates every input
 * row with `validateFeedbackEntryShape`, which requires a non-empty skillId,
 * and rejects rows whose `skillId::feedbackType` does not match `--cluster-key`.
 * Without it the shadow → propose hand-off had no working path at all.
 * It is not a hash input (normalizeEvidence ignores it), so the candidate id is
 * unchanged.
 */
function buildFeedbackRef(entry) {
  return {
    review_run_id: deriveFeedbackReviewRunId(entry),
    timestamp: nonEmptyString(entry?.timestamp),
    skillId: nonEmptyString(entry?.skillId),
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
 * Compute the content-addressed candidate ID for a sub-cluster.
 *
 * This is a thin adapter over the #1624 derivation
 * (`normalizeEvidence` + `computeCandidateContentHash`), NOT a second
 * implementation: the shadow observation and `river promote propose` must mint
 * the SAME `RR-PC-<12 hex>` id from the same evidence, otherwise the loop
 * cannot tell that it is looking at one candidate.
 *
 * Consequences of reusing that contract:
 * - hash inputs are `{ clusterKey, normalized evidence, policyVersion }` only;
 * - `subClusterKey`, `review_run_id` and the generation date are NOT hashed
 *   (two sub-clusters of one cluster already differ by their evidence sets);
 * - evidence is deduplicated and NFC-normalized upstream.
 *
 * @param {{ policyVersion?: string, clusterKey: string, evidence: object[] }} input
 * @returns {{ candidateId: string, contentHash: string, evidenceCount: number }}
 */
export function computeCandidateId({
  policyVersion = CANDIDATE_POLICY_VERSION,
  clusterKey,
  evidence,
}) {
  if (!KNOWN_POLICY_VERSIONS.includes(String(policyVersion))) {
    // An arbitrary policy version would let one evidence set mint unlimited
    // ids — the same guard buildProposedCandidate applies.
    throw new Error(
      `Unknown policyVersion "${policyVersion}". Expected one of: ${KNOWN_POLICY_VERSIONS.join(', ')}.`
    );
  }
  const { evidence: normalized } = normalizeEvidence(evidence ?? []);
  const { candidateId, contentHash } = computeCandidateContentHash({
    clusterKey,
    evidence: normalized,
    policyVersion,
  });
  return { candidateId, contentHash, evidenceCount: normalized.length };
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

  const { candidateId, contentHash, evidenceCount } = computeCandidateId({
    policyVersion,
    clusterKey: cluster.clusterKey,
    evidence,
  });

  return {
    schemaVersion: SHADOW_AGGREGATE_SCHEMA_VERSION,
    candidateId,
    // Persisted so a reader can re-derive and verify the 12-hex id instead of
    // trusting it (same rationale as promotion-candidates.mjs).
    contentHash,
    uniqueEvidenceCount: evidenceCount,
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
      // "Cannot be traced to a saved run" — which is a missing id OR an id
      // that resolves to no evidence record. Counting only the missing ones
      // under-reports the moment a producer exists (#1673): a typo'd or
      // pruned `--run-id` would be silently counted as joined here while
      // `join.unjoinedFeedbackCount` counts it as unjoined, so the two
      // numbers in one artifact contradicted each other.
      unjoinedEvidenceCount: evidence.filter(
        (ref) => !ref.review_run_id || !evidenceByRunId.has(ref.review_run_id)
      ).length,
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
 *   warn?: (msg: string) => void,
 * }} [options]
 *
 * `warn` is the sink for feedback fingerprints that join to no saved finding
 * (#1823 残件2). It defaults to a NO-OP, not `console.warn`, so this module
 * keeps the "no process side effects at all" property stated at the top of the
 * file — the same contract as `listFeedbackEntries` (src/lib/feedback.mjs).
 * The CLI wires it to `console.warn`; the same information is also recorded in
 * `join.unmatchedFindingFingerprints`, so a caller that leaves the sink unwired
 * still has it in the artifact.
 */
export function buildShadowAggregate({
  runRecords = [],
  feedbackEntries = [],
  now = new Date(),
  minRecurrence = DEFAULT_MIN_RECURRENCE,
  month = null,
  policyVersion = SHADOW_AGGREGATE_POLICY_VERSION,
  collectorVersion = COLLECTOR_VERSION,
  warn = () => {},
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

  // #1823 残件2: a `findingFingerprint` that joins to no saved finding is NOT
  // dropped — it still forms its own stage-2 sub-cluster, just with
  // `no-category` / `no-file-path`, and (with enough distinct occurrences) can
  // still mint a candidate under a DIFFERENT candidateId than the same feedback
  // recorded with the matching value. Nothing in the pre-#1823 output said so.
  // The most common cause is a v2 hex copied out of `river review --debug`,
  // which `classifyFingerprintAlgo` can name exactly because the saved records
  // carry `fingerprintV2` next to `fingerprint`.
  const scopedFindings = scopedRuns.flatMap((record) => record?.findings ?? []);
  const unmatched = new Map(); // fingerprint -> 'v2' | null
  for (const entry of scopedFeedback) {
    const fingerprint = nonEmptyString(entry?.findingFingerprint);
    if (!fingerprint || findingIndex.has(fingerprint)) continue;
    if (unmatched.has(fingerprint)) continue;
    const algo = classifyFingerprintAlgo(fingerprint, scopedFindings);
    unmatched.set(fingerprint, algo === 'v2' ? 'v2' : null);
  }
  const unmatchedFindingFingerprints = [...unmatched.keys()].sort(compareStrings);
  const v2FindingFingerprints = unmatchedFindingFingerprints.filter(
    (fp) => unmatched.get(fp) === 'v2'
  );
  // Sorted first so the sink sees a deterministic order, matching the artifact.
  for (const fingerprint of unmatchedFindingFingerprints) {
    warn(
      formatUnmatchedFeedbackFingerprintWarning({
        fingerprint,
        likelyAlgo: unmatched.get(fingerprint),
      })
    );
  }

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
      // #1823 残件2. Distinct from `unjoinedFeedbackCount`, which is the
      // review_run_id join (契約2): a row can join on run id and still name a
      // fingerprint no finding has.
      unmatchedFindingFingerprints,
      v2FindingFingerprints,
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
  lines.push(
    `| Unmatched findingFingerprint | ${aggregate.join.unmatchedFindingFingerprints.length} |`
  );
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

  // #1823 残件2: an unmatched fingerprint still clusters, so it has to be
  // called out here — the cluster list below looks perfectly healthy.
  if (aggregate.join.unmatchedFindingFingerprints.length) {
    const v2 = new Set(aggregate.join.v2FindingFingerprints);
    lines.push(
      '⚠️ どの run の finding にも一致しない findingFingerprint があります（独立した sub-cluster を作ります）:'
    );
    for (const fingerprint of aggregate.join.unmatchedFindingFingerprints) {
      lines.push(
        `- \`${fingerprint}\`` +
          (v2.has(fingerprint)
            ? '（保存済み finding の **v2**（行アンカー）値です。feedback の join は v1 で行うため一致しません）'
            : '')
      );
    }
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
