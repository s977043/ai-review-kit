// Apply Riverbed Memory suppressions to a list of findings (#687 PR-B).
//
// PR-A landed the data model (suppression context schema and the new
// fingerprint / feedbackType / severity fields on createSuppression). This
// PR-B is the gate that consumes those entries: given a list of findings
// already annotated with fingerprints (see src/lib/finding-factory.mjs)
// and a memoryContext loaded by src/lib/memory-context.mjs, it splits the
// findings into kept vs suppressed and returns observability metadata.
//
// PR-C of #687 will inject one call to applySuppressions inside
// src/lib/local-runner.mjs:runLocalReview between annotateFingerprints and
// the return statement so the pipeline behavior changes there, not here.
//
// P1 guard policy (do not silently auto-suppress dangerous findings):
//   - findings of severity `major` or `critical` are kept unless the
//     suppression's feedbackType is explicitly `accepted_risk`.
//   - lower severities (`minor`, `info`) are auto-suppressed for any
//     non-revoked, non-expired suppression that matches the fingerprint.
//   - the per-suppression `minSeverityToAutoSuppress` (added in PR-A)
//     can RAISE the bar but never lower it; the global P1 guard wins.

import { SEVERITY_RANK } from './finding-factory.mjs';

const HIGH_SEVERITY = new Set(['major', 'critical']);

function severityOf(finding) {
  return String(finding.severity || 'info').toLowerCase();
}

/**
 * Apply matching suppressions to findings.
 *
 * @param {Array<object>} findings  Findings already annotated with `.fingerprint`
 *   by `annotateFingerprints` (src/lib/finding-factory.mjs).
 * @param {object} memoryContext    Bucketed memory from `loadReviewMemory`.
 *   Only `memoryContext.suppressions` is consulted.
 * @param {object} [opts]
 * @param {object} [opts.config]    Effective config; `config.memory.suppressionEnabled === false`
 *   bypasses suppression entirely (returns all findings as-is).
 * @returns {{ keptFindings: Array<object>, suppressedFindings: Array<object>, applied: Array<object> }}
 *   `applied` is the observability log. Each entry: `{ fingerprint, suppressionId,
 *   feedbackType, severity, action: 'suppressed' | 'skipped', reason? }`. Findings
 *   moved to `suppressedFindings` carry a `status: 'suppressed'` flag and a
 *   `suppressionRef` pointing back at the suppression entry id.
 */
export function applySuppressions(findings, memoryContext, opts = {}) {
  const list = Array.isArray(findings) ? findings : [];
  const result = { keptFindings: list, suppressedFindings: [], applied: [] };

  if (opts?.config?.memory?.suppressionEnabled === false) return result;

  const suppressions = memoryContext?.suppressions;
  if (!Array.isArray(suppressions) || suppressions.length === 0) return result;
  if (list.length === 0) return result;

  // Index suppressions by canonical fingerprint. Entries that lack a
  // fingerprint (pre-#687 PR-A) are intentionally ignored — they cannot
  // gate findings safely without reintroducing the old hashFinding /
  // computeFingerprint mismatch that PR-A documented as tech debt.
  const byFingerprint = new Map();
  for (const s of suppressions) {
    const fp = s?.context?.fingerprint;
    if (typeof fp === 'string' && fp.length === 16) byFingerprint.set(fp, s);
  }
  if (byFingerprint.size === 0) return result;

  const kept = [];
  const suppressed = [];
  const applied = [];

  for (const finding of list) {
    const fp = finding?.fingerprint;
    const match = fp ? byFingerprint.get(fp) : undefined;
    if (!match) {
      kept.push(finding);
      continue;
    }

    const sev = severityOf(finding);
    const feedbackType = match.context?.feedbackType ?? null;
    const minSeverity = match.context?.minSeverityToAutoSuppress;

    // Per-suppression cap: `minSeverityToAutoSuppress` is the highest
    // severity this entry is allowed to auto-suppress. A finding above
    // that rank stays.
    if (minSeverity && SEVERITY_RANK[sev] > SEVERITY_RANK[String(minSeverity).toLowerCase()]) {
      kept.push(finding);
      applied.push({
        fingerprint: fp,
        suppressionId: match.id,
        feedbackType,
        severity: sev,
        action: 'skipped',
        reason: 'severity-above-min-severity-cap',
      });
      continue;
    }

    // Global P1 guard: never auto-suppress major/critical without
    // accepted_risk. Other feedbackTypes (false_positive, wont_fix, ...)
    // require manual handling for high-severity findings.
    if (HIGH_SEVERITY.has(sev) && feedbackType !== 'accepted_risk') {
      kept.push(finding);
      applied.push({
        fingerprint: fp,
        suppressionId: match.id,
        feedbackType,
        severity: sev,
        action: 'skipped',
        reason: 'high-severity-requires-accepted-risk',
      });
      continue;
    }

    suppressed.push({
      ...finding,
      status: 'suppressed',
      suppressionRef: match.id,
    });
    applied.push({
      fingerprint: fp,
      suppressionId: match.id,
      feedbackType,
      severity: sev,
      action: 'suppressed',
    });
  }

  return { keptFindings: kept, suppressedFindings: suppressed, applied };
}
