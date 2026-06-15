/**
 * Loop-signal derivation (Epic #1171 item3).
 *
 * River Review emits two layers of loop signals:
 *
 * Layer 1 — single `river run` artifact:
 *   NO_SIGNAL | REVISE_REQUIRED | CONVERGED | ESCALATE_HUMAN
 *
 * Layer 2 — `runs diff` (3+ runs, oscillation detectable):
 *   adds STOP_OSCILLATED
 *
 * Layer 3 (STOP_MAX_ITERATIONS | STOP_POLICY_REQUIRED) is caller-synthesized.
 * River Review deliberately does NOT emit those values.
 *
 * All functions are pure — no side effects, no AI calls, no file I/O.
 */

/** @typedef {'NO_SIGNAL' | 'REVISE_REQUIRED' | 'CONVERGED' | 'ESCALATE_HUMAN'} ArtifactSignal */
/** @typedef {ArtifactSignal | 'STOP_OSCILLATED'} RunsDiffSignal */

/**
 * Derive the loop signal for a single review artifact (Layer 1).
 *
 * Rules (evaluated in order):
 * 1. decision === 'human-review-required'  → ESCALATE_HUMAN
 * 2. blocking findings (critical or major)  → REVISE_REQUIRED
 * 3. no blocking findings + decision is auto-approve equivalent → CONVERGED
 * 4. otherwise                              → NO_SIGNAL
 *
 * "auto-approve equivalent" covers 'auto-approve', 'approve', and 'approved'
 * to be forward-compatible with any future verdict alias.
 *
 * @param {object} artifact  A Review Artifact (schema version "1")
 * @returns {ArtifactSignal}
 */
export function deriveLoopSignalFromArtifact(artifact) {
  const decision = artifact?.decision;

  if (decision === 'human-review-required') {
    return 'ESCALATE_HUMAN';
  }

  const findings = artifact?.findings ?? [];
  const blockingCount = findings.filter(
    (f) => f.severity === 'critical' || f.severity === 'major'
  ).length;

  if (blockingCount > 0) {
    return 'REVISE_REQUIRED';
  }

  const AUTO_APPROVE = new Set(['auto-approve', 'approve', 'approved']);
  if (decision !== undefined && AUTO_APPROVE.has(decision)) {
    return 'CONVERGED';
  }

  return 'NO_SIGNAL';
}

/**
 * Derive the loop signal for a `runs diff` result (Layer 2).
 *
 * When `diff.oscillated` is non-empty, oscillation takes priority and returns
 * STOP_OSCILLATED regardless of finding severity — the fix loop is spinning
 * and human triage is needed.
 *
 * Otherwise, derives from the latest run's artifact embedded in the diff.
 * Falls back to NO_SIGNAL when neither oscillation nor a latest artifact is
 * available (e.g. a 2-run diff that lacks the full artifact).
 *
 * @param {object} diff  Output of diffRunHistory / diffReviews
 * @returns {RunsDiffSignal}
 */
export function deriveLoopSignalFromRunsDiff(diff) {
  if (Array.isArray(diff?.oscillated) && diff.oscillated.length > 0) {
    return 'STOP_OSCILLATED';
  }

  // Use the latest run artifact when available (multi-run path sets runs[]).
  const runs = diff?.runs;
  if (Array.isArray(runs) && runs.length > 0) {
    const latest = runs[runs.length - 1];
    const latestArtifact = latest?.artifact ?? latest;
    if (latestArtifact && typeof latestArtifact === 'object') {
      return deriveLoopSignalFromArtifact(latestArtifact);
    }
  }

  return 'NO_SIGNAL';
}
