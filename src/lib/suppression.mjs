import crypto from 'node:crypto';
import {
  appendEntry,
  hasUnparseableExpiresAt,
  isExpired,
  loadMemory,
  queryMemory,
} from './riverbed-memory.mjs';

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
 * `onUnparseable: 'expired'` is passed explicitly, not left to the default: this
 * is the read-side consumer for which "expired" only stops an effect, so the
 * fail-safe direction stays the safe one. The write-side consumers (#1756) ask
 * for the opposite, and no call site should depend on which one the default is.
 *
 * @param {{ context?: { expiresAt?: string } }} suppression
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isSuppressionExpired(suppression, now = new Date()) {
  return isExpired({ expiresAt: suppression?.context?.expiresAt }, now, {
    onUnparseable: 'expired',
  });
}

/**
 * Whether a suppression's `context.expiresAt` is present but is not a valid
 * `expiresAt` value.
 *
 * The validity rule is NOT re-derived here: it delegates to
 * `hasUnparseableExpiresAt` (riverbed-memory.mjs), which in turn delegates to
 * `parseExpiresAt` (expires-at.mjs, the SSoT since #1777). The only thing this
 * wrapper adds is the field the suppression data model actually uses.
 * `createSuppression` writes the deadline to `context.expiresAt` and never to
 * the top-level `entry.expiresAt`, which is why `expireEntries`' warning — it
 * reads the top-level field — structurally cannot see a suppression's value
 * (#1780).
 *
 * @param {{ context?: { expiresAt?: string } }} suppression
 * @returns {boolean}
 */
export function hasUnparseableSuppressionExpiresAt(suppression) {
  return hasUnparseableExpiresAt({ expiresAt: suppression?.context?.expiresAt });
}

/**
 * Suppressions whose `context.expiresAt` cannot be parsed, and which are
 * therefore treated as expired by `isSuppressionExpired` (fail-safe, #1746).
 *
 * The fail-safe direction stays as it is: an unreadable deadline must not keep
 * hiding findings forever. What this function exists for is the OTHER half —
 * making the stop observable. Until #1780 a suppression written by the
 * v1.72.0–v1.72.1 CLI (which accepted anything `Date.parse` liked, e.g.
 * `2027-01-01T00:00:00` without an offset) simply stopped taking effect, with
 * no error, no warning, and no visible change in `.river/memory/index.json`.
 *
 * Only entries the deactivation actually applies to are reported: an entry with
 * `context.active === false` was not suppressing anything to begin with, so
 * calling it "no longer suppresses" would be untrue in the same way
 * `expireEntries` avoids for already-archived entries.
 *
 * The report carries the entry id and the offending value only. The rationale,
 * related file paths and fingerprint are deliberately left out: the value is
 * what has to be repaired, and a warning stream is not a place to widen the
 * exposure of the surrounding record.
 *
 * @param {object[]} suppressions - suppression entries
 * @returns {Array<{ id: string, expiresAt: string }>}
 */
export function findUnparseableSuppressionExpiries(suppressions) {
  if (!Array.isArray(suppressions)) return [];
  return suppressions
    .filter((s) => s?.context?.active && hasUnparseableSuppressionExpiresAt(s))
    .map((s) => ({ id: s.id, expiresAt: s.context.expiresAt }));
}

/**
 * The operator-facing sentence for one unparseable suppression deadline.
 * Shared so the `findActiveSuppressions` warning and the
 * `suppression-analytics` report state the same fact the same way.
 *
 * @param {{ id: string, expiresAt: string }} entry
 * @returns {string}
 */
export function formatUnparseableExpiresAtWarning({ id, expiresAt }) {
  return (
    `Warning: suppression ${id} has an unparseable context.expiresAt (${JSON.stringify(expiresAt)}); ` +
    'it is treated as expired and no longer suppresses findings. ' +
    'Repair the value to an RFC 3339 date or date-time (e.g. "2027-01-01" or "2027-01-01T00:00:00Z").'
  );
}

/**
 * Find active suppressions that overlap with the given file paths.
 * Filters out expired and revoked suppressions.
 *
 * A suppression dropped because its `context.expiresAt` cannot be parsed is
 * reported through `warn` rather than dropped silently (#1780). The `warn` sink
 * mirrors `expireEntries` (riverbed-memory.mjs): injectable for tests, defaults
 * to `console.warn`. Only in-scope, non-revoked suppressions are warned about —
 * the ones that would otherwise have applied to this change set.
 *
 * @param {{ entries: object[] }} index - Loaded memory index
 * @param {string[]} filePaths
 * @param {{ warn?: (msg: string) => void }} [opts] - warning sink
 * @returns {object[]}
 */
export function findActiveSuppressions(index, filePaths, { warn = (m) => console.warn(m) } = {}) {
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

    const related = s.metadata?.relatedFiles ?? [];
    const scope = s.context?.scope || 'file';
    const inScope = matchesScopeFiles(scope, related, filePaths);

    if (isSuppressionExpired(s, now)) {
      // Scope is evaluated BEFORE the warning so an unparseable deadline on a
      // suppression that does not cover this change set stays quiet: it was
      // not going to suppress anything here, and reporting it on every review
      // of every unrelated file would train operators to ignore the line.
      if (inScope && hasUnparseableSuppressionExpiresAt(s)) {
        warn(formatUnparseableExpiresAtWarning({ id: s.id, expiresAt: s.context.expiresAt }));
      }
      return false;
    }

    return inScope;
  });
}
