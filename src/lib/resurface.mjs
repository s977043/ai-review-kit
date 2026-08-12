import {
  findActiveSuppressions,
  isSuppressionExpired,
  matchesScopeFiles,
  inferSubsystem,
} from './suppression.mjs';

/**
 * Check for findings that should be resurfaced based on active suppressions.
 * Conservative: only resurfaces on same path or same subsystem.
 *
 * @param {{ suppressions: object[] }} memoryContext
 * @param {string[]} changedFiles
 * @returns {object[]} Resurfacing candidates with suppression context
 */
export function checkForResurfacingFindings({ memoryContext, changedFiles }) {
  if (!memoryContext?.suppressions?.length || !changedFiles?.length) return [];

  // Note: loadReviewMemory filters only by phase / relatedFiles — it applies
  // no expiry or active filtering (#1802). The active + expiry gates for
  // resurfacing live in shouldResurface below, and the scope-based matching
  // is also done there.
  return memoryContext.suppressions
    .filter((s) => shouldResurface(s, changedFiles))
    .map((s) => ({
      suppression: s,
      reason: buildResurfaceReason(s, changedFiles),
    }));
}

/**
 * Determine if a suppression should be resurfaced for the given changed files.
 * @param {object} suppression
 * @param {string[]} changedFiles
 * @returns {boolean}
 */
export function shouldResurface(suppression, changedFiles) {
  if (!suppression?.context?.active) return false;

  // Same lexical-comparison hazard as findActiveSuppressions: an unparseable
  // expiresAt used to compare as "not yet expired" forever. isSuppressionExpired
  // is the shared rule and fails safe to expired.
  if (isSuppressionExpired(suppression)) return false;

  const related = suppression.metadata?.relatedFiles ?? [];
  const scope = suppression.context?.scope || 'file';
  return matchesScopeFiles(scope, related, changedFiles);
}

/**
 * Build a human-readable reason for why a finding is being resurfaced.
 * @param {object} suppression
 * @param {string[]} changedFiles
 * @returns {string}
 */
function buildResurfaceReason(suppression, changedFiles) {
  const related = suppression.metadata?.relatedFiles ?? [];
  const scope = suppression.context?.scope || 'file';
  const matchedFiles = changedFiles.filter((fp) => matchesScopeFiles(scope, related, [fp]));

  return (
    '[Resurfaced] ' +
    suppression.title +
    ' (scope: ' +
    scope +
    ', matched: ' +
    matchedFiles.join(', ') +
    ', original rationale: ' +
    (suppression.content || 'N/A') +
    ')'
  );
}

/**
 * Build review comments from resurfacing candidates.
 * Uses severity=nit and confidence=low to keep them advisory.
 * @param {object[]} candidates - Output from checkForResurfacingFindings
 * @returns {object[]}
 */
export function buildResurfaceComments(candidates) {
  return candidates.map((c) => ({
    file: c.suppression.metadata?.relatedFiles?.[0] || 'unknown',
    line: 0,
    message:
      'Finding: ' +
      c.reason +
      ' Evidence: Previously suppressed finding resurfaced due to related file change.' +
      ' Impact: Review whether the original suppression rationale still applies.' +
      ' Fix: Confirm suppression is still valid or address the finding.' +
      ' Severity: nit Confidence: low',
    resurfaced: true,
    suppressionId: c.suppression.id,
  }));
}
