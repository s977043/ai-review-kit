// Feedback capture for the skill improvement loop (L1/L2 in
// docs/development/skill-improvement-loop-design.md).
//
// Entries are appended to .river/feedback/<YYYY-MM>.jsonl with a stable
// schema so the conversion table in
// skills/agent-skills/river-review/references/FEEDBACK_TO_FIXTURE.md (SSoT)
// can be executed mechanically by `npm run feedback:apply`.
import { promises as fs } from 'fs';
import path from 'path';

// Taxonomy from references/FEEDBACK.md — keep in sync with the SSoT.
export const FEEDBACK_TYPES = [
  'accepted',
  'false_positive',
  'missed_issue',
  'not_actionable',
  'duplicate',
  'accepted_risk',
  'unclear',
  // `out_of_scope`: finding is valid but out of the reviewed change's scope
  // (skip-scope). Added as an 8th disposition rather than a separate `decision`
  // axis so a finding keeps a single mutually-exclusive classification (see
  // FEEDBACK.md "Feedback types"). Maps to a "no repository change" scaffold.
  'out_of_scope',
];

// Trigger conditions from references/IMPROVEMENT_LOOP.md.
export const FEEDBACK_TRIGGERS = [
  'pr-comment',
  'self-review',
  'eval-regression',
  'retrospective',
  'fix-pr',
];

export class FeedbackError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FeedbackError';
  }
}

/**
 * Build and validate a feedback entry.
 *
 * The `reviewer`, `model`, `reversedBy`, and `reviewRunId` fields are optional
 * and backward-compatible: when omitted they are not written to the entry at
 * all, so historical readers and existing JSONL keep their exact shape.
 *
 * @param {{
 *   feedbackType: string,
 *   skillId: string,
 *   trigger?: string,
 *   findingFingerprint?: string|null,
 *   evidence?: string|null,
 *   pr?: number|null,
 *   reviewer?: string|null,
 *   model?: string|null,
 *   reversedBy?: string|null,
 *   reviewRunId?: string|null,
 *   now?: Date,
 * }} input
 */
export function buildFeedbackEntry({
  feedbackType,
  skillId,
  trigger = 'pr-comment',
  findingFingerprint = null,
  evidence = null,
  pr = null,
  reviewer = null,
  model = null,
  reversedBy = null,
  reviewRunId = null,
  now = new Date(),
}) {
  if (!FEEDBACK_TYPES.includes(feedbackType)) {
    throw new FeedbackError(
      `Invalid feedbackType "${feedbackType}". Expected one of: ${FEEDBACK_TYPES.join(', ')}.`
    );
  }
  if (!FEEDBACK_TRIGGERS.includes(trigger)) {
    throw new FeedbackError(
      `Invalid trigger "${trigger}". Expected one of: ${FEEDBACK_TRIGGERS.join(', ')}.`
    );
  }
  if (typeof skillId !== 'string' || !skillId.trim()) {
    throw new FeedbackError('skillId is required.');
  }
  if (findingFingerprint != null && !/^[0-9a-f]{16}$/.test(findingFingerprint)) {
    throw new FeedbackError('findingFingerprint must be 16 lowercase hex chars when provided.');
  }
  const reviewerId = normalizeOptionalString(reviewer, 'reviewer');
  const modelId = normalizeOptionalString(model, 'model');
  const reversedByRef = normalizeOptionalString(reversedBy, 'reversedBy');
  const reviewRunIdRef = normalizeOptionalString(reviewRunId, 'reviewRunId');
  const entry = {
    timestamp: now.toISOString(),
    trigger,
    feedbackType,
    skillId: skillId.trim(),
    findingFingerprint,
    evidence: evidence?.trim() || null,
    pr: Number.isInteger(pr) && pr > 0 ? pr : null,
  };
  // Optional fields are only attached when present so existing entries and
  // readers keep their exact shape (backward compatibility).
  if (reviewerId) entry.reviewer = reviewerId;
  if (modelId) entry.model = modelId;
  if (reversedByRef) entry.reversedBy = reversedByRef;
  // snake_case is deliberate and NOT a typo among the camelCase fields above:
  // `review_run_id` is the canonical key `deriveFeedbackReviewRunId`
  // (src/lib/shadow-aggregate.mjs, 契約2) resolves first, and the name
  // schemas/shadow-aggregate.schema.json requires. This is the ONLY producer of
  // that key, so `river evolve aggregate` can join feedback back to the saved
  // run it came from (#1673 / #1574 P1).
  //
  // Normalization: reuses this module's existing `normalizeOptionalString`
  // (trim only) rather than importing `nonEmptyNfcString` from
  // promotion-candidates.mjs, which already imports FEEDBACK_TYPES from here —
  // importing back would make src/lib/feedback.mjs cyclic. The join is
  // unaffected: BOTH sides are resolved at read time through
  // `deriveFeedbackReviewRunId` / `deriveReviewRunId`, which apply
  // `nonEmptyNfcString` symmetrically, so a producer-side NFC pass cannot
  // change the outcome. No third normalization is introduced here.
  if (reviewRunIdRef) entry.review_run_id = reviewRunIdRef;
  return entry;
}

/**
 * Normalize an optional free-form string field: null/empty → null (field is
 * omitted by the caller), non-empty → trimmed. A non-string, non-null value is
 * a programming error and is rejected.
 */
function normalizeOptionalString(value, fieldName) {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new FeedbackError(`${fieldName} must be a string when provided.`);
  }
  return value.trim() || null;
}

export function feedbackFilePath(repoRoot, timestamp) {
  const month = String(timestamp).slice(0, 7); // YYYY-MM
  return path.join(repoRoot, '.river', 'feedback', `${month}.jsonl`);
}

/**
 * Append one entry to the monthly JSONL file (creates directories as needed).
 *
 * @returns {Promise<string>} the file path written to
 */
export async function appendFeedbackEntry(entry, { repoRoot }) {
  const filePath = feedbackFilePath(repoRoot, entry.timestamp);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
  return filePath;
}

/**
 * Read feedback entries. Invalid JSON lines are skipped with a warning so a
 * single corrupt line never blocks the loop.
 *
 * @param {{ repoRoot: string, month?: string|null, warn?: (msg: string) => void }} options
 */
export async function listFeedbackEntries({ repoRoot, month = null, warn = () => {} }) {
  const dir = path.join(repoRoot, '.river', 'feedback');
  let files;
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
  if (month) files = files.filter((f) => f === `${month}.jsonl`);
  const entries = [];
  for (const file of files) {
    let raw;
    try {
      raw = await fs.readFile(path.join(dir, file), 'utf8');
    } catch (err) {
      warn(`⚠️  ${file}: unreadable, skipped (${err.message})`);
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        warn(`⚠️  ${file}: skipped invalid JSONL line`);
      }
    }
  }
  return entries;
}

/**
 * Execute the FEEDBACK_TO_FIXTURE.md conversion table for one entry:
 * return the repository action scaffold. Automation stops at scaffold
 * generation — applying it is a human decision in PR review
 * (skill-improvement-loop-design.md §6 non-goals).
 *
 * @returns {{ action: string, verify: string[], fixtureStub?: { suggestedPath: string, content: string }, command?: string, note?: string }}
 */
export function buildFeedbackScaffold(entry) {
  const { feedbackType, skillId, evidence, findingFingerprint } = entry;
  const evidenceLine = evidence ? `\n<!-- evidence: ${evidence} -->\n` : '\n';
  switch (feedbackType) {
    case 'false_positive':
      return {
        action: 'guard fixture (should-not-detect)',
        verify: ['npm run eval:fixtures', 'npm run eval:repo-context'],
        fixtureStub: {
          suggestedPath: `tests/fixtures/review-eval/${skillId}-guard.md`,
          content:
            `# Guard fixture for ${skillId}\n${evidenceLine}\n` +
            '```diff\n# TODO: paste the diff that was falsely flagged\n```\n\nexpectNoFindings: true\n',
        },
      };
    case 'missed_issue':
      return {
        action: 'happy-path fixture (should-detect)',
        verify: [
          'npm run eval:fixtures',
          'npm run eval:repo-context',
          'npm run planner:eval:dataset',
        ],
        fixtureStub: {
          suggestedPath: `tests/fixtures/review-eval/${skillId}-happy.md`,
          content:
            `# Happy-path fixture for ${skillId}\n${evidenceLine}\n` +
            '```diff\n# TODO: paste the diff that should have been flagged\n```\n\nmustIncludeToken: TODO\n',
        },
      };
    case 'accepted_risk':
      return {
        action: 'suppression entry (rationale required)',
        verify: ['npm run skills:validate', 'npm run eval:regression'],
        command: `river suppression add --fingerprint ${findingFingerprint ?? '<16-hex>'} --feedback accepted_risk --rationale "${(evidence ?? '<why this risk is accepted>').replaceAll('"', '\\"')}"`,
      };
    case 'not_actionable':
    case 'unclear':
      return {
        action: 'SKILL.md output/wording improvement proposal',
        verify: ['npm run skills:validate'],
        note: `Review the output contract and wording of ${skillId}. Evidence: ${evidence ?? '(none)'}`,
      };
    case 'duplicate':
      return {
        action: 'routing update proposal',
        verify: ['npm run planner:eval:dataset', 'npm run skills:validate'],
        note: `Clarify the owner skill for findings currently duplicated with ${skillId}. Evidence: ${evidence ?? '(none)'}`,
      };
    case 'out_of_scope':
      return {
        action:
          'no repository change (finding valid but out of PR scope; consider a follow-up issue)',
        verify: ['npm run skills:validate'],
        note: `Finding is valid but out of scope for the reviewed change. Evidence: ${evidence ?? '(none)'}`,
      };
    case 'accepted':
    default:
      return {
        action: 'no change (optionally add a positive fixture)',
        verify: ['npm run eval:fixtures'],
      };
  }
}
