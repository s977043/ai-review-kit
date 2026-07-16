import { createHash } from 'node:crypto';
import { computeFindingBreakdown } from './scoring/breakdown.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FINDING_SEVERITIES = /** @type {const} */ (['blocker', 'warning', 'nit']);
export const FINDING_CONFIDENCE = /** @type {const} */ (['high', 'medium', 'low']);

export const SUPPRESS_REASONS = {
  LOW_CONFIDENCE: 'low_confidence',
  DUPLICATE: 'duplicate',
  STYLE_ONLY: 'style_only',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
  COVERED_BY_HIGHER_LEVEL: 'covered_by_higher_level_finding',
};

// ---------------------------------------------------------------------------
// Format helpers (finding-format)
// ---------------------------------------------------------------------------

function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(text, maxChars) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Format a finding message for line-comments (`<file>:<line>: <message>`).
 * @param {{
 *   finding: string,
 *   evidence: string,
 *   impact: string,
 *   fix: string,
 *   severity: typeof FINDING_SEVERITIES[number],
 *   confidence: typeof FINDING_CONFIDENCE[number],
 * }} finding
 */
export function formatFindingMessage({ finding, evidence, impact, fix, severity, confidence }) {
  const sev = FINDING_SEVERITIES.includes(severity) ? severity : 'warning';
  const conf = FINDING_CONFIDENCE.includes(confidence) ? confidence : 'medium';

  return [
    `Finding: ${clamp(finding, 80)}`,
    `Evidence: ${clamp(evidence, 60)}`,
    `Impact: ${clamp(impact, 60)}`,
    `Fix: ${clamp(fix, 80)}`,
    `Severity: ${sev}`,
    `Confidence: ${conf}`,
  ].join(' ');
}

const LABEL_NAMES = ['Finding', 'Evidence', 'Impact', 'Fix', 'Severity', 'Confidence'];
const LABEL_ALTERNATION = LABEL_NAMES.join('|');

/**
 * Parse a labeled finding message string into structured fields.
 * @param {string} message
 * @returns {{ title: string, evidence: string[], impact: string, suggestion: string, severity: string|null, confidence: string|null }}
 */
export function parseFindingMessage(message) {
  const text = String(message ?? '');
  const get = (label) => {
    const re = new RegExp(`${label}:\\s*([^]*?)(?=\\s+(?:${LABEL_ALTERNATION}):|$)`, 'm');
    return (text.match(re)?.[1] ?? '').trim();
  };
  const evidenceText = get('Evidence');
  return {
    title: get('Finding'),
    evidence: evidenceText ? [evidenceText] : [],
    impact: get('Impact'),
    suggestion: get('Fix'),
    severity: get('Severity') || null,
    confidence: get('Confidence') || null,
  };
}

/**
 * Map internal severity vocabulary (blocker/warning/nit) to output schema vocabulary.
 * Accepts both vocabularies; unknown values default to 'major' (fail-safe).
 * @param {string|null|undefined} internalSeverity
 * @returns {'critical'|'major'|'minor'|'info'}
 */
export function normalizeSeverity(internalSeverity) {
  switch ((internalSeverity ?? '').toLowerCase().trim()) {
    case 'blocker':
    case 'critical':
      return 'critical';
    case 'warning':
    case 'major':
      return 'major';
    case 'nit':
    case 'minor':
      return 'minor';
    case 'info':
      return 'info';
    default:
      return 'major';
  }
}

/**
 * Map output schema severity to P1/P2/P3/P4 priority label.
 * @param {'critical'|'major'|'minor'|'info'|string|null|undefined} severity
 * @returns {'P1'|'P2'|'P3'|'P4'}
 */
export function severityToPriority(severity) {
  switch ((severity ?? '').toLowerCase().trim()) {
    case 'critical':
      return 'P1';
    case 'major':
      return 'P2';
    case 'minor':
      return 'P3';
    case 'info':
      return 'P4';
    default:
      return 'P2';
  }
}

/**
 * Labels a finding message may carry.
 *
 * `REQUIRED` are the machine-load-bearing labels: `normalizeSeverity`,
 * `severityToPriority`, and the classifier's low-confidence suppression all
 * key off Severity/Confidence, so a finding without them cannot be scored and
 * must fail validation (fail-safe → dropped, and heuristic fallback when the
 * whole batch is invalid).
 *
 * `RECOMMENDED` are prose content labels. When a model emits the finding text
 * inline (as observed in a calibration run where Severity/Confidence were
 * appended at end-of-line but the content labels were omitted), their absence
 * loses no reviewer content — `parseFindingMessage`/finding construction fall
 * back to the raw message for the title — so they are reported but do not
 * invalidate the finding. This keeps validation aligned with the model's
 * natural output instead of collapsing an otherwise-usable batch to the
 * heuristic fallback. The per-finding verifier (verifier.mjs) still enforces
 * evidence/actionability as a non-fatal filter downstream.
 */
const REQUIRED_FINDING_LABELS = ['Severity:', 'Confidence:'];
const RECOMMENDED_FINDING_LABELS = ['Finding:', 'Evidence:', 'Impact:', 'Fix:'];

/**
 * Validate whether a finding message contains the required labeled fields.
 * @param {string} message
 * @returns {{ ok: boolean, missing: string[], missingRecommended: string[], invalid: string[] }}
 */
export function validateFindingMessage(message) {
  const text = String(message ?? '');
  const missing = REQUIRED_FINDING_LABELS.filter((label) => !text.includes(label));
  const missingRecommended = RECOMMENDED_FINDING_LABELS.filter((label) => !text.includes(label));

  const sevMatch = /Severity:\s*(\w+)/.exec(text);
  const confMatch = /Confidence:\s*(\w+)/.exec(text);
  const severity = sevMatch?.[1]?.toLowerCase() ?? null;
  const confidence = confMatch?.[1]?.toLowerCase() ?? null;

  const invalid = [];
  if (severity && !FINDING_SEVERITIES.includes(severity)) invalid.push(`Severity:${severity}`);
  if (confidence && !FINDING_CONFIDENCE.includes(confidence))
    invalid.push(`Confidence:${confidence}`);

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    missingRecommended,
    invalid,
  };
}

// ---------------------------------------------------------------------------
// Classifier (finding-classifier)
// ---------------------------------------------------------------------------

function evidenceTotalChars(finding) {
  const ev = finding.evidence;
  if (!Array.isArray(ev) || ev.length === 0) return 0;
  return ev.reduce((sum, e) => sum + String(e ?? '').length, 0);
}

function deduplicateWithinFile(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const ruleId = String(f.ruleId ?? '');
    if (ruleId === 'unknown') return true;
    const key = `${f.file ?? ''}::${ruleId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateWithinPR(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = String(f.ruleId ?? '');
    if (key === 'unknown') return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {object[]} findings
 * @param {{ reviewMode?: 'tiny'|'medium'|'large' }} [options]
 * @returns {{ overview: object[], inlineCandidates: object[], suppressed: object[] }}
 */
export function classifyFindings(findings, options = {}) {
  const reviewMode = options.reviewMode ?? 'medium';
  const maxOverview = reviewMode === 'tiny' ? 3 : reviewMode === 'large' ? 8 : 5;

  const suppressed = [];
  const active = [];

  for (const finding of findings) {
    if (finding.confidence === 'low' && finding.severity !== 'critical') {
      suppressed.push({ ...finding, suppressReason: SUPPRESS_REASONS.LOW_CONFIDENCE });
      continue;
    }
    if (evidenceTotalChars(finding) < 30 && finding.severity !== 'critical') {
      suppressed.push({ ...finding, suppressReason: SUPPRESS_REASONS.INSUFFICIENT_EVIDENCE });
      continue;
    }
    const ruleId = String(finding.ruleId ?? '');
    if (finding.severity === 'minor' && /readability|style|format/i.test(ruleId)) {
      suppressed.push({ ...finding, suppressReason: SUPPRESS_REASONS.STYLE_ONLY });
      continue;
    }
    active.push(finding);
  }

  const deduped = deduplicateWithinPR(deduplicateWithinFile(active));
  const dedupedSet = new Set(deduped.map((f) => f.id));
  for (const f of active) {
    if (!dedupedSet.has(f.id)) {
      suppressed.push({ ...f, suppressReason: SUPPRESS_REASONS.DUPLICATE });
    }
  }

  const sorted = [...deduped].sort(
    (a, b) => computeFindingBreakdown(b).composite - computeFindingBreakdown(a).composite
  );

  const overview = [];
  const overviewRuleIds = new Set();
  for (const f of sorted) {
    const rid = String(f.ruleId ?? '');
    const isUnknown = rid === 'unknown';
    if (!isUnknown && overviewRuleIds.has(rid)) {
      suppressed.push({ ...f, suppressReason: SUPPRESS_REASONS.COVERED_BY_HIGHER_LEVEL });
    } else if (overview.length < maxOverview) {
      overview.push(f);
      if (!isUnknown) overviewRuleIds.add(rid);
    } else {
      suppressed.push({ ...f, suppressReason: SUPPRESS_REASONS.COVERED_BY_HIGHER_LEVEL });
    }
  }

  return { overview, inlineCandidates: [], suppressed };
}

// ---------------------------------------------------------------------------
// Fingerprint (finding-fingerprint)
// ---------------------------------------------------------------------------

/**
 * Stable fingerprint for a finding so that the same logical issue can be
 * matched across review runs even when IDs regenerate.
 *
 * Strategy: hash(ruleId + file + first-60-chars-of-message).
 * Intentionally omits lineStart/lineEnd because line numbers shift as code
 * changes, but the same logical finding should still be considered persisting.
 */
export function computeFingerprint(finding) {
  const ruleId = String(finding.ruleId ?? 'unknown');
  const file = String(finding.file ?? '');
  const msgNorm = String(finding.message ?? finding.title ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const raw = `${ruleId}::${file}::${msgNorm}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Annotate findings with their fingerprint (non-mutating).
 */
export function annotateFingerprints(findings) {
  return findings.map((f) => ({ ...f, fingerprint: computeFingerprint(f) }));
}
