/**
 * Review scoring engine.
 *
 * Deterministic (no AI): derives axis scores, overall score, and verdict from
 * structured findings. Inspired by unilabo/site-management-system's scoring
 * rubric, adapted to river-review's HITL-first posture.
 *
 * The output is always flagged `derived: true` to signal that this is a
 * heuristic indicator, not an authoritative quality metric.
 */

import { AXES, AXIS_PATTERNS, DEFAULT_DEDUCTIONS, VERDICT_THRESHOLDS } from './rubric.mjs';
import { computeFindingBreakdown } from './breakdown.mjs';

/**
 * Classify a finding into one of the 5 axes based on its ruleId.
 * Falls back to `maintainability` when no pattern matches.
 *
 * @param {{ ruleId?: string, category?: string }} finding
 * @returns {typeof AXES[number]}
 */
export function classifyAxis(finding) {
  if (finding?.category && AXES.includes(finding.category)) {
    return finding.category;
  }
  const ruleId = finding?.ruleId ?? '';
  for (const { axis, pattern } of AXIS_PATTERNS) {
    if (pattern.test(ruleId)) return axis;
  }
  return 'maintainability';
}

/**
 * Compute axis scores from findings.
 *
 * @param {Array<{severity: string, ruleId?: string, category?: string}>} findings
 * @param {object} [options]
 * @param {object} [options.deductions] - Override default deduction table.
 * @returns {Record<typeof AXES[number], number>}
 */
export function computeAxisScores(findings, options = {}) {
  const deductions = options.deductions ?? DEFAULT_DEDUCTIONS;
  const scores = Object.fromEntries(AXES.map((a) => [a, 100]));

  for (const finding of findings ?? []) {
    const axis = classifyAxis(finding);
    const severity = normalizeSeverity(finding.severity);
    const deduction = deductions[axis]?.[severity] ?? 0;
    scores[axis] = Math.max(0, scores[axis] - deduction);
  }

  return scores;
}

/**
 * Compute overall score as the mean of axis scores.
 *
 * @param {Record<typeof AXES[number], number>} axisScores
 * @returns {number}
 */
export function computeOverallScore(axisScores) {
  const values = AXES.map((a) => axisScores[a] ?? 100);
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round(sum / values.length);
}

/**
 * Count findings per severity.
 *
 * @param {Array<{severity: string}>} findings
 * @returns {{critical: number, major: number, minor: number, info: number}}
 */
export function countBySeverity(findings) {
  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const f of findings ?? []) {
    const s = normalizeSeverity(f.severity);
    counts[s]++;
  }
  return counts;
}

/**
 * Derive verdict from overall score, axis scores, and severity counts.
 *
 * Return values:
 * - `auto-approve`: Recommendation only; does NOT bypass HITL policy.
 * - `human-review-recommended`: Notable findings but not blocking.
 * - `human-review-required`: Critical findings or very low score.
 * - `human-review-required` (via humanApprovalRequired): Policy-level override
 *   (e.g. destructive commands, credentials, deployment). Returned before
 *   score-based logic so axis scores are unaffected.
 *
 * @param {{overall: number, axes: Record<string, number>, counts: object, humanApprovalRequired?: boolean}} args
 * @returns {'auto-approve' | 'human-review-recommended' | 'human-review-required'}
 */
export function deriveVerdict({ overall, axes, counts, humanApprovalRequired = false }) {
  if (humanApprovalRequired) {
    return 'human-review-required';
  }

  const t = VERDICT_THRESHOLDS;

  if (counts.critical > t.humanReviewRecommended.maxCritical) {
    return 'human-review-required';
  }
  if (overall < t.humanReviewRecommended.minOverall) {
    return 'human-review-required';
  }
  if (
    overall >= t.autoApprove.minOverall &&
    (axes.security ?? 100) >= t.autoApprove.minSecurity &&
    counts.critical <= t.autoApprove.maxCritical &&
    counts.major <= t.autoApprove.maxMajor
  ) {
    return 'auto-approve';
  }
  return 'human-review-recommended';
}

/**
 * Complete scoring entry point.
 *
 * @param {Array<object>} findings - Findings with at least `severity` and `ruleId`.
 * @param {object} [options]
 * @param {boolean} [options.humanApprovalRequired=false] - When true, forces verdict to
 *   'human-review-required' regardless of score (e.g. plan-review-gate trigger).
 * @returns {{
 *   overall: number,
 *   axes: Record<typeof AXES[number], number>,
 *   verdict: string,
 *   counts: {critical: number, major: number, minor: number, info: number},
 *   findingBreakdowns: Array<{id: string, evidenceStrength: number, reproducibility: number, blastRadius: number, reviewerAgreement: number, composite: number}>,
 *   derived: true,
 * }}
 */
export function scoreReview(findings, { humanApprovalRequired = false } = {}) {
  const axes = computeAxisScores(findings);
  const overall = computeOverallScore(axes);
  const counts = countBySeverity(findings);
  const verdict = deriveVerdict({ overall, axes, counts, humanApprovalRequired });
  const findingBreakdowns = (findings ?? []).map((f) => ({
    id: f.id,
    ...computeFindingBreakdown(f),
  }));
  return { overall, axes, verdict, counts, findingBreakdowns, derived: true };
}

/**
 * Resolve the verdict a formatter should render (#1170 F3).
 *
 * The canonical verdict is finalized once on the artifact (`artifact.decision`),
 * reflecting gate signals such as `humanApprovalRequired` that formatters do not
 * receive. Prefer that canonical value over a formatter-local recomputation,
 * which would silently drop those signals and let the verdict drift across the
 * JSON / YAML / HTML / Markdown outputs. Fall back to the recomputed verdict
 * when no canonical decision is present (the run / diff path never sets one).
 *
 * @param {unknown} canonicalDecision - `artifact.decision`, may be absent.
 * @param {string} recomputedVerdict - `scoreReview(findings).verdict`.
 * @returns {string} The verdict to display.
 */
export function resolveVerdict(canonicalDecision, recomputedVerdict) {
  if (typeof canonicalDecision === 'string' && canonicalDecision.length > 0) {
    return canonicalDecision;
  }
  return recomputedVerdict;
}

/**
 * Normalize severity to the canonical vocabulary used by the scoring engine.
 * Accepts both the output schema values (critical/major/minor/info) and
 * internal values (blocker/warning/nit) via fall-through.
 *
 * @param {string} severity
 * @returns {'critical' | 'major' | 'minor' | 'info'}
 */
function normalizeSeverity(severity) {
  const s = String(severity ?? '')
    .toLowerCase()
    .trim();
  if (s === 'critical' || s === 'blocker') return 'critical';
  if (s === 'major' || s === 'warning') return 'major';
  if (s === 'minor' || s === 'nit') return 'minor';
  return 'info';
}
