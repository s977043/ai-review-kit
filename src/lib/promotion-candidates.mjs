// Promotion-candidate generation (Judgment Promotion Loop Phase 1, #1568-A)
// moved in-repo from scripts/feedback-rule-candidates.mjs so the generation
// contract has a stable, importable home under src/lib (#1624 / #1574 P0
// contract 4). The script keeps its detection CLI and now imports these
// builders instead of owning them.
//
// Two ID schemes live here:
//   - the legacy date-based id `RR-PC-<YYYY-MM-DD>-<clusterKey slug>` used by
//     `scripts/feedback-rule-candidates.mjs --promote` (kept so existing
//     entries and their approval history stay addressable), and
//   - the content-addressed id `RR-PC-<sha256(evidence|cluster|policy)[0:12]>`
//     used by `river promote propose` (#1574 P0 contract 4): re-running with
//     the same evidence converges on the same candidate.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { FEEDBACK_TYPES } from './feedback.mjs';
import { appendEntry, loadMemory } from './riverbed-memory.mjs';

// Default candidate lifetime (#1568 decision 6: expiresAt default 90 days,
// overridable). The "now" used to derive expiresAt is always injected so tests
// can pin it — no hardcoded Date.now() in the builders below.
export const DEFAULT_EXPIRY_DAYS = 90;

// Minimum recurrence for a cluster to be a candidate (#1568-A).
export const DEFAULT_MIN_RECURRENCE = 2;

// Version of the derivation policy that turns a (skillId, feedbackType)
// cluster into a rationale / proposedTarget — i.e. the SUGGESTED_ACTION table
// plus proposedTargetFor() below. It participates in the content hash so a
// policy change yields a new candidate id, while rationale wording itself is
// deliberately kept out of the hash (#1624 design §1.3).
export const CANDIDATE_POLICY_VERSION = '1';

// Policy versions this build knows how to derive a candidate for. An arbitrary
// --policy-version would otherwise let the same evidence mint unlimited
// candidates, since the version participates in the content hash.
export const KNOWN_POLICY_VERSIONS = Object.freeze(['1']);

// Length (hex chars) of the content hash kept in the candidate id.
const CONTENT_ID_HASH_LENGTH = 12;

// Upper bound / character set for skillId in --input entries. A skillId flows
// into the clusterKey, the candidate title and the Riverbed tags, so an
// unbounded or control-character-carrying value would corrupt those surfaces.
const MAX_SKILL_ID_LENGTH = 200;
const SKILL_ID_PATTERN = /^[\w.\-/:]+$/;

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

/**
 * Canonical (key-sorted) JSON serialization used for every content hash.
 *
 * Key order must not change a hash: the same evidence set rebuilt by another
 * code path (or read back from a stored candidate) has to re-derive the same
 * contentHash, and JSON.stringify preserves insertion order by default.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value ?? null));
}

export const SUGGESTED_ACTION = {
  false_positive: 'guard fixture を追加し、skill の False-positive guards を強化する',
  missed_issue: 'happy-path fixture を追加し、skill の Rule / Heuristics を拡張する',
  not_actionable: 'SKILL.md の出力契約（Fix の具体性）を見直す',
  unclear: 'SKILL.md の文言・出力例を改善する',
  duplicate: 'routing（owner skill）を明確化する',
  accepted_risk: '繰り返し許容しているリスクをプロジェクトルール（.river/rules.md）へ昇格する',
  // `out_of_scope` also has a proposedTarget (riverbed) in proposedTargetFor();
  // keeping it out of this table let the two disagree, so it is listed here
  // explicitly rather than falling through to the generic action.
  out_of_scope: 'スコープ外として扱った判断を Riverbed Memory に記録する',
  accepted: null,
};

// Cluster feedback types this generator understands. Anything else (typically a
// --cluster-key typo) would silently become a human_judgment candidate and
// linger in the index, so it is rejected up front.
const KNOWN_CLUSTER_FEEDBACK_TYPES = Object.freeze(Object.keys(SUGGESTED_ACTION));

/**
 * Internal: group feedback entries into recurring (skillId, feedbackType)
 * classes with count >= min. `accepted` is a positive signal and never a
 * candidate. Shared by both findRuleCandidates() and the promotionCandidate
 * builders so the clusterKey stays exactly `(skillId, feedbackType)`
 * (#1568 decision 3).
 *
 * @param {Array<{skillId?: string, feedbackType?: string, pr?: number}>} entries
 * @param {number} min
 * @returns {Array<{ skillId: string, feedbackType: string, group: object[] }>}
 */
function groupRecurringFeedback(entries, min) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry?.skillId || !entry?.feedbackType) continue;
    if (entry.feedbackType === 'accepted') continue; // positive signal, nothing to codify
    const key = `${entry.skillId}::${entry.feedbackType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const result = [];
  for (const [key, group] of groups) {
    if (group.length < min) continue;
    const [skillId, feedbackType] = key.split('::');
    result.push({ skillId, feedbackType, group });
  }
  return result;
}

/**
 * Pure grouping: (skillId, feedbackType) classes with count >= min.
 *
 * @param {Array<{skillId?: string, feedbackType?: string, pr?: number}>} entries
 * @param {{ min?: number }} [options]
 */
export function findRuleCandidates(entries, { min = DEFAULT_MIN_RECURRENCE } = {}) {
  const candidates = groupRecurringFeedback(entries, min).map(
    ({ skillId, feedbackType, group }) => ({
      skillId,
      feedbackType,
      count: group.length,
      prs: [...new Set(group.map((e) => e.pr).filter(Boolean))].sort((a, b) => a - b),
      suggestedAction: SUGGESTED_ACTION[feedbackType] ?? '改善フローで対応先を判断する',
    })
  );
  candidates.sort((a, b) => b.count - a.count);
  return candidates;
}

// Classification decision tree (design §3) reduced to a deterministic
// feedbackType -> promotion target map for Phase 1. Values are proposals only;
// human approval routes them into shared assets (#1568-B).
function proposedTargetFor(skillId, feedbackType) {
  switch (feedbackType) {
    case 'false_positive':
      return { kind: 'fixture', id: `${skillId}-guard` };
    case 'missed_issue':
      return { kind: 'fixture', id: `${skillId}-happy` };
    case 'accepted_risk':
      return { kind: 'rule', id: '.river/rules.md' };
    case 'not_actionable':
    case 'unclear':
      return { kind: 'skill', id: skillId };
    case 'duplicate':
      return { kind: 'routing', id: skillId };
    case 'out_of_scope':
      return { kind: 'riverbed', id: null };
    default:
      return { kind: 'human_judgment', id: null };
  }
}

/** Slugify a clusterKey into an id-safe fragment. */
function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build the structured promotionCandidate contract body (design §2) for one
 * recurring class. Stored under context.promotionCandidate of a
 * `promotion_candidate` Riverbed entry. Auditable fields (rationale / scope /
 * exceptions / evidence) are populated here; scope/exceptions default to empty
 * so a human narrows them at approval time (generation vs. adoption stay
 * separated — this does not perform the approval transition).
 *
 * @param {{
 *   skillId: string,
 *   feedbackType: string,
 *   group: Array<{ pr?: number|null, findingFingerprint?: string|null, feedbackType: string }>,
 *   scope?: { paths: string[] },
 *   exceptions?: string[],
 * }} input
 */
export function buildPromotionCandidate({
  skillId,
  feedbackType,
  group,
  scope = { paths: [] },
  exceptions = [],
}) {
  const count = group.length;
  return {
    recurrenceCount: count,
    detector: 'feedback-rule-candidates',
    clusterKey: `${skillId}::${feedbackType}`,
    evidence: group.map((e) => ({
      pr: Number.isInteger(e.pr) && e.pr > 0 ? e.pr : null,
      // findingFingerprint is nullable in Phase 1 (#1568 decision 2).
      findingFingerprint: e.findingFingerprint ?? null,
      feedbackType: e.feedbackType,
    })),
    rationale: `${skillId} の ${feedbackType} が ${count} 件再発したため昇格候補として検出。${
      SUGGESTED_ACTION[feedbackType] ?? '改善フローで対応先を判断する'
    }`,
    proposedTarget: proposedTargetFor(skillId, feedbackType),
    scope,
    exceptions,
    requiresHumanApproval: true,
    autoActions: ['detect-recurrence'],
    promotionStatus: 'candidate',
    supersedesReason: null,
  };
}

/**
 * Wrap a promotionCandidate body into a full Riverbed entry conforming to
 * schemas/riverbed-entry.schema.json (type: promotion_candidate). The entry
 * lifecycle `status` stays `active` (the record is live); the candidate's own
 * approval state lives in context.promotionCandidate.promotionStatus.
 *
 * `now` is injected (never Date.now()) so expiresAt (default now + 90 days) is
 * deterministic under test. `expiresInDays` overrides the default (#1568
 * decision 6).
 *
 * @param {{
 *   skillId: string,
 *   feedbackType: string,
 *   group: object[],
 *   now?: Date,
 *   expiresInDays?: number,
 *   scope?: { paths: string[] },
 *   exceptions?: string[],
 *   id?: string,
 *   author?: string,
 * }} input
 */
export function buildPromotionCandidateEntry({
  skillId,
  feedbackType,
  group,
  now = new Date(),
  expiresInDays = DEFAULT_EXPIRY_DAYS,
  scope,
  exceptions,
  id,
  author = 'river-review',
}) {
  const promotionCandidate = buildPromotionCandidate({
    skillId,
    feedbackType,
    group,
    scope,
    exceptions,
  });
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const clusterKey = promotionCandidate.clusterKey;
  return {
    id: id ?? `RR-PC-${createdAt.slice(0, 10)}-${slugify(clusterKey)}`,
    type: 'promotion_candidate',
    title: `Promotion candidate: ${clusterKey}`,
    content: promotionCandidate.rationale,
    status: 'active',
    expiresAt,
    context: { promotionCandidate },
    metadata: {
      createdAt,
      author,
      tags: ['promotion-candidate', skillId, feedbackType],
      summary: `${skillId} × ${feedbackType} が ${group.length} 件再発`,
    },
  };
}

/**
 * Build promotion_candidate Riverbed entries for every recurring class in the
 * feedback set (count >= min). Detection reuses the same grouping as
 * findRuleCandidates so the clusterKey is unchanged; each entry carries the
 * full auditable contract. Sorted by recurrenceCount descending.
 *
 * @param {object[]} entries
 * @param {{ min?: number, now?: Date, expiresInDays?: number }} [options]
 * @returns {object[]} Riverbed entries (schema: promotion_candidate)
 */
export function buildPromotionCandidates(
  entries,
  { min = DEFAULT_MIN_RECURRENCE, now = new Date(), expiresInDays = DEFAULT_EXPIRY_DAYS } = {}
) {
  return groupRecurringFeedback(entries, min)
    .map(({ skillId, feedbackType, group }) =>
      buildPromotionCandidateEntry({ skillId, feedbackType, group, now, expiresInDays })
    )
    .sort(
      (a, b) =>
        b.context.promotionCandidate.recurrenceCount - a.context.promotionCandidate.recurrenceCount
    );
}

/**
 * Build the structured artifact payload written by `--out`.
 *
 * Minimal shape: metadata plus the same per-candidate fields already used by
 * `--json` stdout (`{skillId, feedbackType, count, prs, suggestedAction}`), so
 * a future CI artifact / improvement-flow consumer has one contract to read
 * regardless of which output mode produced it.
 *
 * @param {{ entriesCount: number, min: number, candidates: ReturnType<typeof findRuleCandidates>, now?: Date }} options
 */
export function buildCandidatesArtifact({ entriesCount, min, candidates, now = new Date() }) {
  return {
    generatedAt: now.toISOString(),
    threshold: min,
    entries: entriesCount,
    candidates,
  };
}

/**
 * Write the artifact payload to `outPath` as pretty-printed JSON, creating
 * parent directories as needed. Pure I/O helper kept separate from
 * `buildCandidatesArtifact` so tests can validate the JSON shape without
 * touching the filesystem.
 *
 * @param {string} outPath
 * @param {ReturnType<typeof buildCandidatesArtifact>} payload
 */
export async function writeCandidatesArtifact(outPath, payload) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

export class PromotionProposalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PromotionProposalError';
  }
}

/**
 * Normalize the evidence set that feeds the content hash (#1624 design §1.3).
 *
 * Each feedback entry becomes `{ feedbackType, findingFingerprint, pr }`, plus
 * `timestamp` when the fingerprint is absent — without a fingerprint two
 * entries from the same PR and type are otherwise indistinguishable, so the
 * timestamp keeps them apart. Elements are deduplicated and sorted so evidence
 * ordering in the input file never changes the resulting id.
 *
 * @param {object[]} entries
 * @returns {{ evidence: object[], fingerprintless: boolean }}
 */
export function normalizeEvidence(entries) {
  let fingerprintless = false;
  const normalized = entries.map((entry) => {
    // Unicode normalization keeps visually identical strings from producing two
    // different hashes (NFC vs NFD input files).
    const fingerprint = nfc(entry.findingFingerprint ?? null);
    const pr = Number.isInteger(entry.pr) && entry.pr > 0 ? entry.pr : null;
    if (fingerprint === null) {
      fingerprintless = true;
      // Without a fingerprint the timestamp is a hash input, so a non-string
      // value (an object, a Date, a number) would either serialize by key order
      // or lose precision and make the id non-deterministic. Reject instead.
      if (entry.timestamp != null && typeof entry.timestamp !== 'string') {
        throw new PromotionProposalError(
          'evidence without findingFingerprint must carry a string timestamp ' +
            `(got ${typeof entry.timestamp}); it participates in the content hash.`
        );
      }
      return {
        feedbackType: nfc(entry.feedbackType),
        findingFingerprint: null,
        pr,
        timestamp: nfc(entry.timestamp ?? null),
      };
    }
    return { feedbackType: nfc(entry.feedbackType), findingFingerprint: fingerprint, pr };
  });
  const unique = new Map();
  // canonicalJson (not JSON.stringify) so the dedup key — and therefore the
  // sort order of the hashed evidence array — never depends on key order.
  for (const item of normalized) unique.set(canonicalJson(item), item);
  const evidence = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    evidence: evidence.map(([, item]) => item),
    fingerprintless,
    // How many input rows collapsed into an existing evidence item. Callers use
    // this both for the recurrence check (duplicated rows must not satisfy the
    // minimum) and to warn that the input was not the selection it looked like.
    duplicatesRemoved: normalized.length - unique.size,
  };
}

/**
 * NFC-normalize a string; pass through null/undefined and non-strings.
 *
 * Exported so every content-addressed surface normalizes identically: a
 * consumer that skips it (or rolls its own) makes visually identical strings
 * hash — or compare — differently on one side of the loop only.
 */
export function nfc(value) {
  return typeof value === 'string' ? value.normalize('NFC') : (value ?? null);
}

/**
 * Trim and NFC-normalize a string; blank or non-string values become null.
 *
 * Exported as the ONE implementation every downstream reader shares
 * (`shadow-aggregate.mjs`, `paired-replay.mjs`). Two near-identical local copies
 * — one trimming only, one trimming and normalizing — silently disagreed on
 * NFD input, which is a latent id-divergence the moment they feed the same
 * hash.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function nonEmptyNfcString(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return nfc(value.trim());
}

/**
 * Validate one feedback entry against the capture contract in feedback.mjs
 * (`buildFeedbackEntry`). `--input` is caller-supplied data, so an unvalidated
 * entry would flow straight into the Riverbed index and break
 * schemas/riverbed-entry.schema.json invariants (e.g. the 16-hex
 * findingFingerprint pattern).
 *
 * @param {object} entry
 * @returns {string|null} error message, or null when the entry is valid
 */
export function validateFeedbackEntryShape(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return 'entry must be a JSON object.';
  }
  if (typeof entry.skillId !== 'string' || !entry.skillId.trim()) {
    return 'skillId must be a non-empty string.';
  }
  if (entry.skillId.length > MAX_SKILL_ID_LENGTH) {
    return `skillId must be at most ${MAX_SKILL_ID_LENGTH} characters (got ${entry.skillId.length}).`;
  }
  if (!SKILL_ID_PATTERN.test(entry.skillId)) {
    // Control characters and separators would leak into the clusterKey, the
    // candidate title and the Riverbed tags, where they are neither escaped
    // nor round-trippable.
    return 'skillId must contain only letters, digits, underscore, dot, hyphen, slash, or colon.';
  }
  if (!FEEDBACK_TYPES.includes(entry.feedbackType)) {
    return `feedbackType "${entry.feedbackType}" is not one of: ${FEEDBACK_TYPES.join(', ')}.`;
  }
  if (
    entry.findingFingerprint != null &&
    !(
      typeof entry.findingFingerprint === 'string' &&
      /^[0-9a-f]{16}$/.test(entry.findingFingerprint)
    )
  ) {
    return 'findingFingerprint must be 16 lowercase hex chars or null.';
  }
  if (entry.pr != null && !(Number.isInteger(entry.pr) && entry.pr > 0)) {
    return 'pr must be a positive integer or null.';
  }
  return null;
}

/**
 * Compute the content-addressed candidate id: sha256 over the canonical
 * `{ clusterKey, evidence, policyVersion }` triple fixed by #1574 P0 contract 4.
 * Timestamps of the run, rationale wording and proposedTarget are deliberately
 * excluded (they are derived from policyVersion), so the same evidence always
 * converges on the same candidate.
 *
 * @param {{ clusterKey: string, evidence: object[], policyVersion?: string }} input
 * @returns {{ contentHash: string, candidateId: string, canonical: string }}
 */
export function computeCandidateContentHash({
  clusterKey,
  evidence,
  policyVersion = CANDIDATE_POLICY_VERSION,
}) {
  // Key-sorted serialization, so the hash is re-derivable from any object that
  // holds the same data regardless of how its keys were inserted — including
  // the evidence array read back from a stored candidate entry.
  const canonical = canonicalJson({ clusterKey, evidence, policyVersion });
  const contentHash = createHash('sha256').update(canonical).digest('hex');
  return {
    contentHash,
    candidateId: `RR-PC-${contentHash.slice(0, CONTENT_ID_HASH_LENGTH)}`,
    canonical,
  };
}

/**
 * Split `skillId::feedbackType`, normalize both components, and reject
 * malformed cluster keys.
 *
 * SSoT for cluster-key normalization: NFC over the whole string, split on
 * `::`, then trim EACH component and rejoin. A consumer that only trims the
 * whole string (`" a ::b "` → `"a ::b"`) hashes a different clusterKey than
 * this function produces, so the same evidence mints two different candidate
 * ids. Exported for exactly that reason — do not re-implement it.
 *
 * @param {string} clusterKey
 * @param {{ label?: string }} [options] label used in the error message
 * @returns {{ skillId: string, feedbackType: string, clusterKey: string }}
 */
export function normalizeClusterKey(clusterKey, { label = '--cluster-key' } = {}) {
  const parts = String(clusterKey ?? '')
    .normalize('NFC')
    .split('::');
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    throw new PromotionProposalError(
      `${label} must be "<skillId>::<feedbackType>" (got: ${clusterKey ?? '(none)'}).`
    );
  }
  const skillId = parts[0].trim();
  const feedbackType = parts[1].trim();
  return { skillId, feedbackType, clusterKey: `${skillId}::${feedbackType}` };
}

/**
 * Build the content-addressed promotion_candidate entry for one cluster.
 *
 * Validation is deliberately mechanical (the "is this worth promoting?"
 * judgment stays with the caller, #1624 design §2): every input entry must
 * belong to `clusterKey`, `accepted` is never promotable, and the cluster must
 * reach `min` recurrences.
 *
 * @param {{
 *   entries: object[],
 *   clusterKey: string,
 *   now?: Date,
 *   expiresInDays?: number,
 *   policyVersion?: string,
 *   min?: number,
 * }} input
 * @returns {{ entry: object, candidateId: string, contentHash: string, clusterKey: string, policyVersion: string, shadowOnly: boolean }}
 */
export function buildProposedCandidate({
  entries,
  clusterKey,
  now = new Date(),
  expiresInDays = DEFAULT_EXPIRY_DAYS,
  policyVersion = CANDIDATE_POLICY_VERSION,
  min = DEFAULT_MIN_RECURRENCE,
}) {
  const { skillId, feedbackType } = normalizeClusterKey(clusterKey);
  if (feedbackType === 'accepted') {
    throw new PromotionProposalError(
      'feedbackType "accepted" is a positive signal and is never a promotion candidate.'
    );
  }
  if (!KNOWN_CLUSTER_FEEDBACK_TYPES.includes(feedbackType)) {
    throw new PromotionProposalError(
      `--cluster-key feedbackType "${feedbackType}" is unknown. Expected one of: ${KNOWN_CLUSTER_FEEDBACK_TYPES.filter((t) => t !== 'accepted').join(', ')}.`
    );
  }
  if (!KNOWN_POLICY_VERSIONS.includes(String(policyVersion))) {
    throw new PromotionProposalError(
      `--policy-version "${policyVersion}" is unknown. Expected one of: ${KNOWN_POLICY_VERSIONS.join(', ')}.`
    );
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new PromotionProposalError('--input contained no feedback entries.');
  }
  entries.forEach((entry, i) => {
    const problem = validateFeedbackEntryShape(entry);
    if (problem) {
      throw new PromotionProposalError(`--input entry #${i + 1} is invalid: ${problem}`);
    }
  });
  const mismatched = entries.filter(
    (e) => `${e?.skillId}::${e?.feedbackType}` !== `${skillId}::${feedbackType}`
  );
  if (mismatched.length) {
    // Filtering silently would hide a caller-side selection bug (#1624 §1.1).
    const sample = mismatched
      .slice(0, 3)
      .map((e) => `${e?.skillId ?? '(none)'}::${e?.feedbackType ?? '(none)'}`)
      .join(', ');
    throw new PromotionProposalError(
      `--input contains ${mismatched.length} entr${mismatched.length === 1 ? 'y' : 'ies'} outside --cluster-key ${clusterKey} (e.g. ${sample}). Filter the input instead of relying on implicit filtering.`
    );
  }
  // The deduplicated evidence set is the single source of truth for the
  // recurrence check, the recurrenceCount and the content hash. Counting raw
  // input rows here would let the same evidence, duplicated across two lines,
  // satisfy the minimum while hashing as one item.
  const { evidence, fingerprintless, duplicatesRemoved } = normalizeEvidence(entries);
  if (evidence.length < min) {
    const dupNote = duplicatesRemoved
      ? ` (${entries.length} input rows, ${duplicatesRemoved} duplicate${duplicatesRemoved === 1 ? '' : 's'} removed)`
      : '';
    throw new PromotionProposalError(
      `--input has ${evidence.length} unique evidence item${evidence.length === 1 ? '' : 's'}${dupNote} for ${clusterKey}, below the minimum recurrence of ${min}.`
    );
  }

  const { contentHash, candidateId } = computeCandidateContentHash({
    clusterKey: `${skillId}::${feedbackType}`,
    evidence,
    policyVersion,
  });
  const entry = buildPromotionCandidateEntry({
    skillId,
    feedbackType,
    // Deduplicated evidence, so recurrenceCount and the stored evidence array
    // match what the hash was computed over.
    group: evidence,
    now,
    expiresInDays,
    id: candidateId,
  });
  // Store the EXACT evidence array the hash was computed over. buildPromotionCandidate
  // re-projects its `group` into `{ pr, findingFingerprint, feedbackType }`, which drops
  // the `timestamp` that fingerprintless evidence hashes on (and, for fingerprintless
  // input, collapses distinct rows into duplicates that contradict recurrenceCount).
  // Re-deriving contentHash from the stored entry then always mismatched.
  entry.context.promotionCandidate.evidence = evidence;
  // Persist the hash inputs so a later reader can re-derive and verify the id
  // instead of trusting it (the id itself is a 12-hex truncation).
  entry.context.promotionCandidate.contentHash = contentHash;
  entry.context.promotionCandidate.policyVersion = policyVersion;
  return {
    entry,
    candidateId,
    contentHash,
    clusterKey: `${skillId}::${feedbackType}`,
    policyVersion,
    evidenceCount: evidence.length,
    duplicatesRemoved,
    // Contract 5: evidence without a fingerprint stays Shadow-only (no
    // automatic experiment / promotion). Surfaced in the output only.
    shadowOnly: fingerprintless,
  };
}

/**
 * Propose one promotion candidate into a Riverbed index (`river promote
 * propose`). Idempotent by construction: the candidate id is the content hash,
 * so a re-run with the same evidence detects the existing entry and reports
 * convergence instead of appending a duplicate.
 *
 * @param {{
 *   entries: object[],
 *   clusterKey: string,
 *   indexPath: string,
 *   now?: Date,
 *   expiresInDays?: number,
 *   policyVersion?: string,
 *   min?: number,
 *   dryRun?: boolean,
 * }} input
 * @returns {{
 *   created: boolean,
 *   wouldCreate: boolean,
 *   dryRun: boolean,
 *   candidateId: string,
 *   contentHash: string,
 *   clusterKey: string,
 *   policyVersion: string,
 *   shadowOnly: boolean,
 *   entry: object,
 *   existing: null | { candidateId: string, promotionStatus: string|null, status: string|null },
 * }}
 */
export function proposePromotionCandidate({
  entries,
  clusterKey,
  indexPath,
  now = new Date(),
  expiresInDays = DEFAULT_EXPIRY_DAYS,
  policyVersion = CANDIDATE_POLICY_VERSION,
  min = DEFAULT_MIN_RECURRENCE,
  dryRun = false,
}) {
  const built = buildProposedCandidate({
    entries,
    clusterKey,
    now,
    expiresInDays,
    policyVersion,
    min,
  });
  const index = loadMemory(indexPath);
  const existingEntry =
    index.entries.find((e) => e.id === built.candidateId && e.type === 'promotion_candidate') ??
    null;
  let convergenceNote = null;
  if (existingEntry) {
    const storedCandidate = existingEntry.context?.promotionCandidate ?? {};
    const storedHash = storedCandidate.contentHash ?? null;
    if (storedHash && storedHash !== built.contentHash) {
      // Same 12-hex id, different full hash: a truncation collision. Writing or
      // silently reusing either side would corrupt the audit trail.
      throw new PromotionProposalError(
        `Candidate id ${built.candidateId} already exists with a different contentHash ` +
          `(stored ${storedHash}, computed ${built.contentHash}). Refusing to converge on a colliding id.`
      );
    }
    const storedCount = storedCandidate.recurrenceCount ?? null;
    if (storedCount !== null && storedCount !== built.evidenceCount) {
      // Hash equality means the evidence set matched, so a differing count can
      // only come from an entry written by another code path. Say so instead of
      // silently discarding the freshly built entry.
      convergenceNote = `input had ${built.evidenceCount} evidence, stored has ${storedCount} — not updated`;
    } else if (!storedHash) {
      convergenceNote = 'stored entry predates contentHash persistence — not updated';
    }
  }
  const existing = existingEntry
    ? {
        candidateId: existingEntry.id,
        promotionStatus: existingEntry.context?.promotionCandidate?.promotionStatus ?? null,
        status: existingEntry.status ?? null,
        contentHash: existingEntry.context?.promotionCandidate?.contentHash ?? null,
        recurrenceCount: existingEntry.context?.promotionCandidate?.recurrenceCount ?? null,
      }
    : null;
  const wouldCreate = !existingEntry;
  let created = false;
  if (wouldCreate && !dryRun) {
    try {
      appendEntry(indexPath, built.entry);
    } catch (err) {
      // Reachable when an entry of another type already owns this id: the
      // lookup above is type-filtered, appendEntry's uniqueness check is not.
      throw new PromotionProposalError(
        `Cannot write candidate ${built.candidateId} to ${indexPath}: ${err.message}`
      );
    }
    created = true;
  }
  return {
    // `created` is true only when this call wrote the entry; `wouldCreate`
    // reports whether the candidate was absent (so --dry-run can distinguish
    // "nothing written because it exists" from "nothing written because of
    // --dry-run").
    created,
    wouldCreate,
    dryRun,
    candidateId: built.candidateId,
    contentHash: built.contentHash,
    clusterKey: built.clusterKey,
    policyVersion: built.policyVersion,
    shadowOnly: built.shadowOnly,
    evidenceCount: built.evidenceCount,
    duplicatesRemoved: built.duplicatesRemoved,
    convergenceNote,
    entry: existingEntry ?? built.entry,
    existing,
  };
}

/**
 * Read feedback entries from an explicit JSONL file (`--input`). Unlike
 * listFeedbackEntries() this takes the exact selection made by the caller
 * (#1574 Detect) rather than scanning the repository, and a malformed line is
 * fatal — silently skipping evidence would change the content hash.
 *
 * @param {string} inputPath
 * @returns {Promise<object[]>}
 */
export async function readFeedbackJsonl(inputPath) {
  let raw;
  try {
    raw = await fs.readFile(inputPath, 'utf8');
  } catch (err) {
    throw new PromotionProposalError(`Cannot read --input ${inputPath}: ${err.message}`);
  }
  const entries = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsedLine;
    try {
      parsedLine = JSON.parse(line);
    } catch (err) {
      throw new PromotionProposalError(
        `Invalid JSONL in ${inputPath} at line ${i + 1}: ${err.message}`
      );
    }
    // Schema violations are rejected here, not filtered: an entry that reaches
    // the index must satisfy schemas/riverbed-entry.schema.json.
    const problem = validateFeedbackEntryShape(parsedLine);
    if (problem) {
      throw new PromotionProposalError(
        `Invalid feedback entry in ${inputPath} at line ${i + 1}: ${problem}`
      );
    }
    entries.push(parsedLine);
  }
  return entries;
}
