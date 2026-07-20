#!/usr/bin/env node
// Rule-promotion candidate detection (L6 in
// docs/development/skill-improvement-loop-design.md §3, automating
// IMPROVEMENT_LOOP.md Step 9: "same class of problem twice or more").
//
// Groups captured feedback entries (.river/feedback/*.jsonl) by
// (skillId, feedbackType) and reports classes that recurred N+ times
// (default 2) as candidates for codification — a guard fixture, a SKILL.md
// gate fix, or a project rule. Detection only; codification stays a human
// decision via the improvement flow.
//
// Usage: node scripts/feedback-rule-candidates.mjs [--min <n>] [--month YYYY-MM] [--json] [--out <path>]
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listFeedbackEntries } from '../src/lib/feedback.mjs';
import { appendEntry } from '../src/lib/riverbed-memory.mjs';
import { isDirectRun } from './lib/is-direct-run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Default candidate lifetime (#1568 decision 6: expiresAt default 90 days,
// overridable). The "now" used to derive expiresAt is always injected so tests
// can pin it — no hardcoded Date.now() in the builders below.
export const DEFAULT_EXPIRY_DAYS = 90;

const SUGGESTED_ACTION = {
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
export function findRuleCandidates(entries, { min = 2 } = {}) {
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
  { min = 2, now = new Date(), expiresInDays = DEFAULT_EXPIRY_DAYS } = {}
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

if (isDirectRun(import.meta.url)) {
  const args = process.argv.slice(2);
  const minIdx = args.indexOf('--min');
  let min = 2;
  if (minIdx >= 0) {
    const parsed = parseInt(args[minIdx + 1] ?? '', 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      console.error('Error: --min requires a positive integer.');
      process.exit(2);
    }
    min = parsed;
  }
  const monthIdx = args.indexOf('--month');
  const month = monthIdx >= 0 ? args[monthIdx + 1] : null;
  const outIdx = args.indexOf('--out');
  let outPath = null;
  if (outIdx >= 0) {
    outPath = args[outIdx + 1];
    if (!outPath || outPath.startsWith('--')) {
      console.error('Error: --out requires a file path.');
      process.exit(2);
    }
  }
  const promoteIdx = args.indexOf('--promote');
  let promotePath = null;
  if (promoteIdx >= 0) {
    promotePath = args[promoteIdx + 1];
    if (!promotePath || promotePath.startsWith('--')) {
      console.error('Error: --promote requires a Riverbed index.json path.');
      process.exit(2);
    }
  }
  const entries = await listFeedbackEntries({ repoRoot, month, warn: (m) => console.warn(m) });
  const candidates = findRuleCandidates(entries, { min });
  // --promote writes structured promotion_candidate entries into a Riverbed
  // index. Generation only: entries land with promotionStatus=candidate; the
  // approval transition and shared-asset promotion stay a separate human step
  // (#1568-B). Duplicate ids (same clusterKey already recorded today) are
  // skipped, not fatal.
  if (promotePath) {
    const promotionEntries = buildPromotionCandidates(entries, { min });
    let written = 0;
    let skipped = 0;
    for (const entry of promotionEntries) {
      try {
        appendEntry(path.resolve(promotePath), entry);
        written += 1;
      } catch (err) {
        if (/Duplicate entry ID/.test(err.message)) {
          skipped += 1;
        } else {
          console.error(
            `Error: Failed to write promotion candidate to ${promotePath}: ${err.message}`
          );
          process.exit(1);
        }
      }
    }
    console.log(
      `Promotion candidates written to ${promotePath}: ${written} new, ${skipped} skipped (duplicate).`
    );
  }
  // --out writes a structured artifact alongside whichever stdout mode below
  // runs; it does not change stdout content or the exit-code-2-on-candidates
  // behavior (kept for backward compatibility with existing CI usage).
  if (outPath) {
    try {
      await writeCandidatesArtifact(
        path.resolve(outPath),
        buildCandidatesArtifact({ entriesCount: entries.length, min, candidates })
      );
    } catch (err) {
      console.error(`Error: Failed to write artifact to ${outPath}: ${err.message}`);
      process.exit(1);
    }
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify({ entries: entries.length, candidates }, null, 2));
  } else if (!candidates.length) {
    console.log(`No rule-promotion candidates (entries: ${entries.length}, threshold: ${min}).`);
  } else {
    console.log(`Rule-promotion candidates (threshold: ${min}):\n`);
    for (const c of candidates) {
      const prs = c.prs.length ? ` (PRs: ${c.prs.map((p) => `#${p}`).join(', ')})` : '';
      console.log(`- ${c.skillId} × ${c.feedbackType}: ${c.count} 回${prs}`);
      console.log(`  → ${c.suggestedAction}`);
    }
    console.log(
      '\n次のアクション: docs/development/improvement-flow.md の手順で codify してください。'
    );
    process.exitCode = 2;
  }
}
