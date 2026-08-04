import crypto from 'node:crypto';
import { appendEntry, isExpired, loadMemory, queryMemory } from './riverbed-memory.mjs';

/**
 * Create a stable content hash from a finding's key fields.
 * @param {{ file?: string, message?: string, ruleId?: string }} finding
 * @returns {string}
 */
export function hashFinding(finding) {
  const key = [finding.file || '', finding.message || '', finding.ruleId || ''].join('::');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Extract subsystem identifier from a file path.
 * e.g. 'src/auth/handler.ts' -> 'auth', 'src/lib/utils.mjs' -> 'lib'
 * @param {string} filePath
 * @returns {string}
 */
export function inferSubsystem(filePath) {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'src') return parts[1];
  if (parts.length >= 2) return parts[0];
  return '';
}

/**
 * Create a suppression record in Riverbed Memory.
 *
 * `feedbackType`, `fingerprint`, `severity`, `minSeverityToAutoSuppress`,
 * `duplicateOfFingerprint`, `sourceCommentId` are introduced in #687 PR-A as
 * the data model for auto-suppression; they default to undefined so existing
 * call sites remain compatible. The shape of the resulting `context` is
 * validated by `schemas/suppression-context.schema.json`.
 *
 * @param {object} options
 * @returns {object} The created suppression entry
 */
export function createSuppression({
  indexPath,
  findingId,
  findingHash,
  fingerprint,
  fingerprintAlgo = 'v1',
  feedbackType,
  severity,
  minSeverityToAutoSuppress,
  duplicateOfFingerprint,
  filePaths,
  rationale,
  scope = 'file',
  expiresAt,
  prNumber,
  sourceCommentId,
  author = 'river-review',
}) {
  if (!rationale) throw new Error('Suppression requires a rationale');

  const idSeed = fingerprint || findingHash || hashFinding({ file: filePaths?.[0] });

  const context = {
    findingId: findingId || null,
    findingHash: findingHash || null,
    scope,
    active: true,
  };
  if (fingerprint) {
    context.fingerprint = fingerprint;
    context.fingerprintAlgo = fingerprintAlgo;
  }
  if (feedbackType) context.feedbackType = feedbackType;
  if (severity) context.severity = severity;
  if (minSeverityToAutoSuppress) context.minSeverityToAutoSuppress = minSeverityToAutoSuppress;
  if (duplicateOfFingerprint) context.duplicateOfFingerprint = duplicateOfFingerprint;
  if (expiresAt) context.expiresAt = expiresAt;
  // Reject NaN / non-integer / non-positive values so the entry stays consistent
  // with suppression-context.schema.json (`integer`, `minimum: 1`).
  if (Number.isInteger(prNumber) && prNumber > 0) context.sourcePR = prNumber;
  if (Number.isInteger(sourceCommentId) && sourceCommentId > 0) {
    context.sourceCommentId = sourceCommentId;
  }

  const entry = {
    id: 'suppression-' + idSeed + '-' + Date.now(),
    type: 'suppression',
    title: 'Suppress: ' + (findingId || 'finding'),
    content: rationale,
    metadata: {
      createdAt: new Date().toISOString(),
      author,
      tags: ['suppression', 'active', scope],
      relatedFiles: filePaths ?? [],
      ...(prNumber ? { links: ['PR#' + prNumber] } : {}),
    },
    context,
  };

  appendEntry(indexPath, entry);
  return entry;
}

/**
 * Revoke a suppression by appending a resurface entry (append-only).
 * @param {string} indexPath
 * @param {string} suppressionId
 * @param {{ author?: string, reason?: string }} options
 * @returns {object} The resurface entry
 */
export function revokeSuppression(
  indexPath,
  suppressionId,
  { author = 'river-review', reason = 'revoked' } = {}
) {
  const entry = {
    id: 'resurface-' + suppressionId + '-' + Date.now(),
    type: 'resurface',
    title: 'Revoke: ' + suppressionId,
    content: reason,
    metadata: {
      createdAt: new Date().toISOString(),
      author,
      tags: ['resurface', 'revocation'],
    },
    context: {
      suppressionId,
      action: 'revoke',
    },
  };

  appendEntry(indexPath, entry);
  return entry;
}

/**
 * Check if any of the changed files match the suppression's scope.
 * Shared by findActiveSuppressions and resurface logic.
 * @param {string} scope - 'global' | 'subsystem' | 'file'
 * @param {string[]} relatedFiles - Files associated with the suppression
 * @param {string[]} changedFiles - Files in the current change set
 * @returns {boolean}
 */
export function matchesScopeFiles(scope, relatedFiles, changedFiles) {
  if (!relatedFiles.length || !changedFiles.length) return false;
  if (scope === 'global') return true;
  if (scope === 'subsystem') {
    const suppressionSubs = new Set(relatedFiles.map(inferSubsystem).filter(Boolean));
    return changedFiles.some((fp) => suppressionSubs.has(inferSubsystem(fp)));
  }
  return changedFiles.some((fp) => relatedFiles.includes(fp));
}

/**
 * Whether a suppression entry's `context.expiresAt` has passed.
 *
 * Delegates to riverbed-memory's `isExpired`, the single definition of the
 * expiry rule, instead of comparing the raw string. The former
 * `context.expiresAt < new Date().toISOString()` comparison was a LEXICAL one:
 * a value that is not an ISO timestamp (`"notadate"`, persisted by
 * `suppression add --expires notadate` before #1746 was fixed) sorted after
 * every real timestamp, so such an entry never expired. Malformed values now
 * fail safe to expired, which deactivates the suppression rather than
 * suppressing findings forever.
 *
 * @param {{ context?: { expiresAt?: string } }} suppression
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isSuppressionExpired(suppression, now = new Date()) {
  return isExpired({ expiresAt: suppression?.context?.expiresAt }, now);
}

/**
 * Find active suppressions that overlap with the given file paths.
 * Filters out expired and revoked suppressions.
 * @param {{ entries: object[] }} index - Loaded memory index
 * @param {string[]} filePaths
 * @returns {object[]}
 */
export function findActiveSuppressions(index, filePaths) {
  // includeInactive: true preserves pre-lifecycle behavior. Revocations via
  // resurface must survive supersession so that a once-revoked suppression
  // does not silently reactivate when the revoking entry is superseded.
  const suppressions = queryMemory(index, { type: 'suppression', includeInactive: true });
  const revocations = new Set(
    queryMemory(index, { type: 'resurface', includeInactive: true })
      .filter((e) => e.context?.action === 'revoke')
      .map((e) => e.context?.suppressionId)
      .filter(Boolean)
  );

  const now = new Date();

  return suppressions.filter((s) => {
    if (!s.context?.active) return false;
    if (revocations.has(s.id)) return false;
    if (isSuppressionExpired(s, now)) return false;

    const related = s.metadata?.relatedFiles ?? [];
    const scope = s.context?.scope || 'file';
    return matchesScopeFiles(scope, related, filePaths);
  });
}
