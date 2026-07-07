/**
 * Gate derivation for `river run` results (Epic #1347 S3 / #1350).
 *
 * Extracted from cli.mjs formatJsonOutput so the same derivation feeds both
 * the JSON output artifact and the persisted run record (result store) —
 * the audit trail must record the same gate the consumer saw.
 *
 * The `river run` path performs no plan-text human-approval scan, so
 * humanApprovalRequired is always false here (documented in
 * schemas/output.schema.json); riskMapDigest is likewise null on this path.
 */

import { scoreReview, resolveVerdict } from './scoring/engine.mjs';
import { deriveLoopSignalFromArtifact } from './loop-signal.mjs';
import { deriveGateDecision } from './gate-decision.mjs';

/**
 * Derive `{ decision, gate }` for a runLocalReview result. Both fields are
 * undefined on derivation failure (same fail-soft contract as
 * finalizeArtifact — the caller's output must never break on scoring).
 *
 * @param {object} result - runLocalReview result
 * @returns {{ decision: string|undefined, gate: object|undefined }}
 */
export function deriveRunGate(result) {
  // Defensive (PR #1372 gemini): a null/undefined result yields the same
  // fail-soft shape instead of throwing on property access.
  if (result == null || typeof result !== 'object') {
    return { decision: undefined, gate: undefined };
  }
  let decision;
  try {
    decision = resolveVerdict(result.decision, scoreReview(result.findings ?? []).verdict);
  } catch {
    if (typeof result.decision === 'string' && result.decision.length > 0) {
      decision = result.decision;
    }
  }

  let gate;
  try {
    const findings = result.findings ?? [];
    const riskAssessment = result.plan?.riskAssessment;
    const loopSignal = deriveLoopSignalFromArtifact({ decision, findings });
    gate = deriveGateDecision({
      loopSignal,
      decision,
      humanApprovalRequired: false,
      riskAction: riskAssessment?.aggregateAction,
      blockingFindings: findings.filter(
        (f) => f != null && (f.severity === 'critical' || f.severity === 'major')
      ).length,
      changedFiles: result.changedFiles ?? [],
      reviewExecuted: result.status === 'ok' && result.dryRun !== true,
      artifactStatus: result.status ?? null,
      riskMapPresent: riskAssessment != null,
      riskMapDigest: null,
      // Epic #1347 S4 (#1351): deterministic strict_block → unconditional NO_GO.
      strictBlock: result.strictBlock === true,
      // Epic #1347 §11.8 (c2) (#1401): deterministic gate could not run → rule 5c
      // ESCALATE. False unless the double-gated executor was opted in (§11.6).
      deterministicUnrunnable: result.deterministicUnrunnable === true,
      config: result.config ?? {},
    });
  } catch {
    // leave gate unset on derivation failure
  }

  return { decision, gate };
}
