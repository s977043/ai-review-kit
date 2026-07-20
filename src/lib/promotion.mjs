// Judgment Promotion Loop Phase 2 (#1568-B / #1622): approval transition and
// PR-scaffold generation for promotion_candidate Riverbed entries.
//
// Phase 1 (#1621) generates promotion_candidate entries (generation only). This
// module adds the *human* approval step and turns approved candidates into PR
// scaffolds (text only — no files are changed here; a human or a follow-up
// applies them). Generation and adoption stay separated: nothing in this module
// creates candidates.
//
// promotionStatus enum (schema): candidate, pending, approved, active,
// needs_review, superseded, archived. Phase 2 maps the two human decisions onto
// existing enum values (no schema change):
//   approve -> promotionStatus: 'approved'
//   reject  -> promotionStatus: 'archived'   (no 'rejected' enum value exists;
//              the rejection is recorded via context.approval.decision)
//
// #1568 decision 5: security/compliance promotions are delegated to PlanGate.
// The proposedTarget.kind enum has no dedicated security kind, so sensitivity is
// detected deterministically from the candidate's skill / clusterKey signals.

import { loadMemory, updateEntry } from './riverbed-memory.mjs';

export const PROMOTION_ENTRY_TYPE = 'promotion_candidate';

/** Human decisions and the promotionStatus they map onto. */
export const DECISION_STATUS = Object.freeze({
  approved: 'approved',
  rejected: 'archived',
});

export const VALID_DECISIONS = Object.freeze(['approved', 'rejected']);

// Deterministic substring signals that flag a candidate as security/compliance
// sensitive. Matched against the lowercased skillId + clusterKey.
const SECURITY_SIGNALS = Object.freeze([
  'security',
  'secret',
  'credential',
  'auth',
  'authn',
  'authz',
  'compliance',
  'vuln',
  'injection',
  'xss',
  'csrf',
  'crypto',
  'privacy',
  'pii',
]);

// Compiled once at module scope (building the regex is not free and the signals
// are static). Prefix match after a word boundary: the stem must start a word
// (preceded by start-of-string or a non-letter) but any suffix may follow, so
// plurals and derivations are caught — secrets, credentials, vulnerability,
// cryptography, authentication, authorization — while embedded stems are NOT
// (the "auth" inside "oauth" is preceded by a letter, so oauth-flow stays out).
const SECURITY_RE = new RegExp(`(^|[^a-z])(${SECURITY_SIGNALS.join('|')})`);

/** Slugify a value into an id-safe fragment. */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slugify proposedTarget.id for interpolation into file-path / branch templates.
 * Untrusted candidate ids (e.g. `../../etc/passwd`) are neutralised the same way
 * as clusterKey in branch names, so no path traversal leaks into the scaffold.
 *
 * @param {object} pc - a promotionCandidate body
 * @param {string} fallback - placeholder when no id is set
 */
function safeTargetId(pc, fallback) {
  const id = pc?.proposedTarget?.id;
  return id ? slugify(id) : fallback;
}

/**
 * Read the promotionCandidate body from an entry, or null when absent.
 * @param {object} entry
 */
export function getPromotionCandidate(entry) {
  return entry?.context?.promotionCandidate ?? null;
}

/**
 * List promotion_candidate entries from a loaded index. Only active entries are
 * returned unless includeInactive is set (rejected candidates are archived).
 *
 * @param {{ entries: object[] }} index
 * @param {{ includeInactive?: boolean }} [options]
 * @returns {object[]}
 */
export function listPromotionCandidates(index, { includeInactive = false } = {}) {
  const entries = index?.entries ?? [];
  return entries.filter((entry) => {
    if (entry?.type !== PROMOTION_ENTRY_TYPE) return false;
    if (!includeInactive && (entry.status ?? 'active') !== 'active') return false;
    return true;
  });
}

/**
 * Whether a candidate is security/compliance sensitive and must be routed
 * through PlanGate for approval (#1568 decision 5).
 *
 * @param {object} entry - a promotion_candidate entry
 * @returns {boolean}
 */
export function isSecuritySensitive(entry) {
  const pc = getPromotionCandidate(entry);
  const tags = (entry?.metadata?.tags ?? []).join(' ');
  const haystack = `${tags} ${pc?.clusterKey ?? ''}`.toLowerCase();
  return SECURITY_RE.test(haystack);
}

/**
 * Pure approval transition. Mutates and returns the entry (in place). Every
 * decision is appended to `context.approvalHistory` (an audit trail that is
 * never overwritten) and `context.approval` points at the latest record.
 *
 * Re-deciding with the SAME decision is a no-op (idempotent). Re-deciding with a
 * DIFFERENT decision is allowed (an override) but surfaces a `warning` so the
 * change of mind is visible to the caller; the prior decisions stay in history.
 *
 * @param {object} entry - a promotion_candidate entry
 * @param {{ decision: 'approved'|'rejected', approver: string, reason?: string|null, now?: Date }} opts
 * @returns {{ changed: boolean, entry: object, warning: string|null, previousDecision: string|null }}
 */
export function applyPromotionDecision(
  entry,
  { decision, approver, reason = null, now = new Date() }
) {
  if (!VALID_DECISIONS.includes(decision)) {
    throw new Error(
      `Invalid decision: ${decision} (expected one of ${VALID_DECISIONS.join(', ')}).`
    );
  }
  if (!approver) {
    throw new Error('approver is required to record an auditable approval decision.');
  }
  const pc = getPromotionCandidate(entry);
  if (!pc) {
    throw new Error(
      `Entry ${entry?.id} is not a promotion_candidate (missing context.promotionCandidate).`
    );
  }
  const previousDecision = entry.context?.approval?.decision ?? null;
  // Idempotent: re-deciding with the same decision leaves the record unchanged.
  if (previousDecision === decision) {
    return { changed: false, entry, warning: null, previousDecision };
  }
  const decidedAt = now.toISOString();
  const record = { decision, approver, decidedAt, reason: reason ?? null };
  pc.promotionStatus = DECISION_STATUS[decision];
  // Append-only audit trail; context.approval always points at the latest record.
  entry.context.approvalHistory = entry.context.approvalHistory ?? [];
  entry.context.approvalHistory.push(record);
  entry.context.approval = record;
  entry.status = decision === 'rejected' ? 'archived' : 'active';
  entry.metadata = entry.metadata ?? {};
  entry.metadata.updatedAt = decidedAt;
  const warning = previousDecision
    ? `candidate ${entry.id} was already ${previousDecision}; overriding to ${decision} (prior decisions kept in approvalHistory).`
    : null;
  return { changed: true, entry, warning, previousDecision };
}

/**
 * I/O wrapper: load the index, apply the approval decision to entry `id`, and
 * persist. Returns the changed flag and the updated entry.
 *
 * @param {{ indexPath: string, id: string, decision: 'approved'|'rejected', approver: string, reason?: string|null, now?: Date }} opts
 * @returns {{ changed: boolean, entry: object, warning: string|null, previousDecision: string|null }}
 */
export function decidePromotion({
  indexPath,
  id,
  decision,
  approver,
  reason = null,
  now = new Date(),
}) {
  const index = loadMemory(indexPath);
  const target = listPromotionCandidates(index, { includeInactive: true }).find((e) => e.id === id);
  if (!target) {
    throw new Error(`No promotion_candidate entry with id: ${id}`);
  }
  // Apply the transition exactly once, inside the persist mutator. updateEntry
  // rewrites the index; on an idempotent no-op the bytes are unchanged.
  let result;
  const entry = updateEntry(indexPath, id, (live) => {
    result = applyPromotionDecision(live, { decision, approver, reason, now });
  });
  return { ...result, entry };
}

// Per-kind PR scaffold shape. `paths(pc)` yields the changed-file path templates;
// `title(clusterKey)` builds the conventional-commit PR title.
const KIND_TEMPLATE = Object.freeze({
  fixture: {
    branchPrefix: 'promote/fixture',
    title: (k) => `test(fixture): codify ${k} as a guard fixture`,
    paths: (pc) => [`skills/**/fixtures/${safeTargetId(pc, '<fixture-id>')}.md`],
  },
  test: {
    branchPrefix: 'promote/test',
    title: (k) => `test: add regression coverage for ${k}`,
    paths: () => ['tests/<area>.test.mjs'],
  },
  skill: {
    branchPrefix: 'promote/skill',
    title: (k) => `docs(skill): refine ${k} skill contract`,
    paths: (pc) => [`skills/**/${safeTargetId(pc, '<skill-id>')}/SKILL.md`],
  },
  rule: {
    branchPrefix: 'promote/rule',
    title: (k) => `chore(rules): promote ${k} to project rules`,
    paths: () => ['.river/rules.md'],
  },
  routing: {
    branchPrefix: 'promote/routing',
    title: (k) => `fix(routing): clarify owner skill for ${k}`,
    paths: () => ['skills/registry.yaml'],
  },
  riverbed: {
    branchPrefix: 'promote/riverbed',
    title: (k) => `chore(riverbed): record ${k} as durable memory`,
    paths: () => ['.river/memory/index.json'],
  },
  docs: {
    branchPrefix: 'promote/docs',
    title: (k) => `docs: document ${k}`,
    paths: () => ['docs/<area>.md'],
  },
  linter: {
    branchPrefix: 'promote/linter',
    title: (k) => `feat(linter): add deterministic check for ${k}`,
    paths: () => ['scripts/<linter>.mjs'],
  },
});

function renderBody({ pc, entry, kind, targetPaths }) {
  const evidence = (pc.evidence ?? []).map((e) => {
    const pr = e.pr ? `#${e.pr}` : '(pr unknown)';
    const fp = e.findingFingerprint ? ` fingerprint=${e.findingFingerprint}` : '';
    return `- ${pr} (${e.feedbackType})${fp}`;
  });
  const approval = entry.context?.approval;
  const lines = [
    `## Summary`,
    ``,
    `Promote the recurring judgment \`${pc.clusterKey}\` (recurrence: ${pc.recurrenceCount}) into a versioned asset.`,
    ``,
    `Rationale: ${pc.rationale}`,
    ``,
    `## Proposed target`,
    ``,
    `- kind: ${kind}`,
    `- id: ${pc.proposedTarget?.id ?? '(none)'}`,
    `- changed-file templates:`,
    ...targetPaths.map((p) => `  - \`${p}\``),
    ``,
    `## Scope`,
    ``,
    pc.scope?.paths?.length
      ? pc.scope.paths.map((p) => `- \`${p}\``).join('\n')
      : '- (none yet — narrow the scope before merging)',
    ``,
    `## Exceptions`,
    ``,
    pc.exceptions?.length ? pc.exceptions.map((e) => `- ${e}`).join('\n') : '- (none)',
    ``,
    `## Evidence`,
    ``,
    ...(evidence.length ? evidence : ['- (no source PRs recorded)']),
    ``,
    `## Approval`,
    ``,
    `- decision: ${approval?.decision ?? '(pending)'}`,
    `- approver: ${approval?.approver ?? '(unknown)'}`,
    `- decidedAt: ${approval?.decidedAt ?? '(unknown)'}`,
    ...(approval?.reason ? [`- reason: ${approval.reason}`] : []),
    ``,
    `## Checklist`,
    ``,
    `- [ ] Narrow \`scope.paths\` to the minimal set`,
    `- [ ] Fill in the actual change for the target above`,
    `- [ ] Confirm the recurrence is still valid`,
    ``,
    `_Generated by \`river promote template\` (candidate ${entry.id}). No files were changed._`,
  ];
  return lines.join('\n');
}

function renderPlanGateBody({ pc, entry }) {
  return [
    `## PlanGate delegation required`,
    ``,
    `Candidate \`${pc.clusterKey}\` (recurrence: ${pc.recurrenceCount}) is security/compliance`,
    `sensitive. Per #1568 decision 5, its promotion approval is delegated to PlanGate`,
    `rather than approved through the normal PR scaffold.`,
    ``,
    `Do not open a direct merge PR from this template. Route the promotion through`,
    `PlanGate's approval flow, then apply the resulting change.`,
    ``,
    `- proposedTarget.kind: ${pc.proposedTarget?.kind ?? '(unknown)'}`,
    `- rationale: ${pc.rationale}`,
    ``,
    `_Generated by \`river promote template\` (candidate ${entry.id})._`,
  ].join('\n');
}

/**
 * Build a PR scaffold for an approved promotion_candidate entry. Returns a
 * text-only description (branch name, PR title, PR body, changed-file path
 * templates). No files are changed.
 *
 * Rules:
 *  - Only approved candidates are eligible (`eligible: false` otherwise).
 *  - Security/compliance-sensitive candidates set `requiresPlanGate: true` and
 *    emit a delegation notice instead of a mergeable scaffold (#1568 decision 5).
 *  - `human_judgment` kind produces no mergeable scaffold (needs a person).
 *
 * @param {object} entry - a promotion_candidate entry
 * @returns {{
 *   id: string, clusterKey: string, kind: string, eligible: boolean,
 *   requiresPlanGate: boolean, branchName: string|null, prTitle: string|null,
 *   prBody: string|null, targetPaths: string[], note: string|null,
 * }}
 */
export function buildPrScaffold(entry) {
  const pc = getPromotionCandidate(entry);
  if (!pc) {
    throw new Error(`Entry ${entry?.id} is not a promotion_candidate.`);
  }
  const kind = pc.proposedTarget?.kind ?? 'human_judgment';
  const clusterKey = pc.clusterKey;
  const base = {
    id: entry.id,
    clusterKey,
    kind,
    eligible: false,
    requiresPlanGate: false,
    branchName: null,
    prTitle: null,
    prBody: null,
    targetPaths: [],
    note: null,
  };

  if (pc.promotionStatus !== 'approved') {
    return {
      ...base,
      note: `not approved (promotionStatus=${pc.promotionStatus}); approve it first`,
    };
  }

  if (isSecuritySensitive(entry)) {
    return {
      ...base,
      eligible: true,
      requiresPlanGate: true,
      branchName: `promote/plangate/${slugify(clusterKey)}`,
      prTitle: `chore(plangate): route ${clusterKey} promotion through PlanGate`,
      prBody: renderPlanGateBody({ pc, entry }),
      note: 'security/compliance promotion — PlanGate approval required (#1568 decision 5)',
    };
  }

  if (kind === 'human_judgment') {
    return {
      ...base,
      eligible: true,
      note: 'kind=human_judgment: no mergeable asset — decide and act manually',
    };
  }

  const template = KIND_TEMPLATE[kind];
  if (!template) {
    return {
      ...base,
      eligible: true,
      note: `unknown proposedTarget.kind=${kind}; no scaffold template`,
    };
  }

  const targetPaths = template.paths(pc);
  return {
    ...base,
    eligible: true,
    branchName: `${template.branchPrefix}/${slugify(clusterKey)}`,
    prTitle: template.title(clusterKey),
    prBody: renderBody({ pc, entry, kind, targetPaths }),
    targetPaths,
  };
}
