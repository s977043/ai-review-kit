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

// Length (hex chars) of the content hash kept in the candidate id.
const CONTENT_ID_HASH_LENGTH = 12;

export const SUGGESTED_ACTION = {
  false_positive: 'guard fixture を追加し、skill の False-positive guards を強化する',
  missed_issue: 'happy-path fixture を追加し、skill の Rule / Heuristics を拡張する',
  not_actionable: 'SKILL.md の出力契約（Fix の具体性）を見直す',
  unclear: 'SKILL.md の文言・出力例を改善する',
  duplicate: 'routing（owner skill）を明確化する',
  accepted_risk: '繰り返し許容しているリスクをプロジェクトルール（.river/rules.md）へ昇格する',
  accepted: null,
};

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
    const fingerprint = entry.findingFingerprint ?? null;
    const pr = Number.isInteger(entry.pr) && entry.pr > 0 ? entry.pr : null;
    if (fingerprint === null) {
      fingerprintless = true;
      return {
        feedbackType: entry.feedbackType,
        findingFingerprint: null,
        pr,
        timestamp: entry.timestamp ?? null,
      };
    }
    return { feedbackType: entry.feedbackType, findingFingerprint: fingerprint, pr };
  });
  const unique = new Map();
  for (const item of normalized) unique.set(JSON.stringify(item), item);
  const evidence = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { evidence: evidence.map(([, item]) => item), fingerprintless };
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
  // Key order is fixed by construction (no JSON.stringify replacer needed):
  // clusterKey -> evidence -> policyVersion, with each evidence element already
  // normalized by normalizeEvidence().
  const canonical = JSON.stringify({ clusterKey, evidence, policyVersion });
  const contentHash = createHash('sha256').update(canonical).digest('hex');
  return {
    contentHash,
    candidateId: `RR-PC-${contentHash.slice(0, CONTENT_ID_HASH_LENGTH)}`,
    canonical,
  };
}

/** Split `skillId::feedbackType` and reject malformed cluster keys. */
function parseClusterKey(clusterKey) {
  const parts = String(clusterKey ?? '').split('::');
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    throw new PromotionProposalError(
      `--cluster-key must be "<skillId>::<feedbackType>" (got: ${clusterKey ?? '(none)'}).`
    );
  }
  return { skillId: parts[0].trim(), feedbackType: parts[1].trim() };
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
  const { skillId, feedbackType } = parseClusterKey(clusterKey);
  if (feedbackType === 'accepted') {
    throw new PromotionProposalError(
      'feedbackType "accepted" is a positive signal and is never a promotion candidate.'
    );
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new PromotionProposalError('--input contained no feedback entries.');
  }
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
  if (entries.length < min) {
    throw new PromotionProposalError(
      `--input has ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} for ${clusterKey}, below the minimum recurrence of ${min}.`
    );
  }

  const { evidence, fingerprintless } = normalizeEvidence(entries);
  const { contentHash, candidateId } = computeCandidateContentHash({
    clusterKey: `${skillId}::${feedbackType}`,
    evidence,
    policyVersion,
  });
  const entry = buildPromotionCandidateEntry({
    skillId,
    feedbackType,
    group: entries,
    now,
    expiresInDays,
    id: candidateId,
  });
  return {
    entry,
    candidateId,
    contentHash,
    clusterKey: `${skillId}::${feedbackType}`,
    policyVersion,
    // Contract 5: evidence without a fingerprint stays Shadow-only (no
    // automatic experiment / promotion). Surfaced in the output only; the
    // entry shape is unchanged (schema stays additive-free).
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
  const existingEntry = index.entries.find((e) => e.id === built.candidateId) ?? null;
  const existing = existingEntry
    ? {
        candidateId: existingEntry.id,
        promotionStatus: existingEntry.context?.promotionCandidate?.promotionStatus ?? null,
        status: existingEntry.status ?? null,
      }
    : null;
  const wouldCreate = !existingEntry;
  let created = false;
  if (wouldCreate && !dryRun) {
    appendEntry(indexPath, built.entry);
    created = true;
  }
  return {
    created,
    wouldCreate,
    dryRun,
    candidateId: built.candidateId,
    contentHash: built.contentHash,
    clusterKey: built.clusterKey,
    policyVersion: built.policyVersion,
    shadowOnly: built.shadowOnly,
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
    try {
      entries.push(JSON.parse(line));
    } catch (err) {
      throw new PromotionProposalError(
        `Invalid JSONL in ${inputPath} at line ${i + 1}: ${err.message}`
      );
    }
  }
  return entries;
}
