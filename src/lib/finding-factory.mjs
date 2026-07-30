import { createHash } from 'node:crypto';
import { computeFindingBreakdown } from './scoring/breakdown.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FINDING_SEVERITIES = /** @type {const} */ (['blocker', 'warning', 'nit']);
const FINDING_CONFIDENCE = /** @type {const} */ (['high', 'medium', 'low']);

/**
 * Scope vocabulary for a finding (#1644 Phase 1).
 * - `in-diff`: introduced or changed by the added lines of this diff
 * - `pre-existing`: inside a changed file but outside the added lines
 * @see docs/review/output-format.md
 */
export const FINDING_SCOPES = /** @type {const} */ (['in-diff', 'pre-existing']);

/**
 * Fail-safe default scope. Unknown/absent scope MUST NOT demote a finding,
 * so the default is the non-demoting value (`in-diff`), mirroring the
 * "unknown severity → major" fail-safe direction of normalizeSeverity.
 */
export const DEFAULT_FINDING_SCOPE = /** @type {const} */ ('in-diff');

/**
 * Canonical severity ranking for the output schema vocabulary
 * (ascending: higher number = more severe). Single source of truth for every
 * module that needs to compare or sort severities.
 * @see .claude/rules/review-core.md for the canonical severity mapping
 */
export const SEVERITY_RANK = /** @type {const} */ ({ info: 0, minor: 1, major: 2, critical: 3 });

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
 * Self-reported scope label (#1644). Deliberately NOT a bare member of
 * LABEL_NAMES: an unconstrained `Scope:` in the label alternation would let any
 * prose occurrence (OAuth / IAM scopes appear verbatim in real review text)
 * terminate the preceding Evidence/Fix capture and silently truncate it. The
 * value is therefore constrained to the known vocabulary — both when extracting
 * the label and when using it as a capture terminator.
 */
const SCOPE_VALUE_PATTERN = 'in[-_ ]?diff|pre[-_ ]?existing';
const RE_SCOPE_LABEL = new RegExp(`(?:^|\\s)Scope:\\s*(${SCOPE_VALUE_PATTERN})\\b`, 'i');

/**
 * Traceability ref labels (#1666 / #1545 Phase 2). Same containment problem as
 * the Scope label — an unconstrained `CriterionRefs:` in LABEL_ALTERNATION would
 * let any prose occurrence terminate the preceding Evidence/Fix capture and
 * silently truncate it — but refs are free-form identifiers, so a closed value
 * vocabulary is not available. The value is constrained by SHAPE instead:
 *
 * - a ref token is whitespace-free (`AC-4`, `TC-7`, `plan.md#AC-4`), so prose —
 *   which always continues with spaces — cannot satisfy the label;
 * - a list is comma-separated, so an adjacent label (` Severity: warning`) ends
 *   it rather than being swallowed;
 * - a token that is itself a reserved label followed by `:` is rejected, so a
 *   stray trailing comma cannot consume the next label;
 * - matching is case-SENSITIVE, so the lowerCamel schema field name
 *   (`criterionRefs`) quoted inside review prose is not read as a label.
 *
 * River Review does not own these identifiers: they are copied verbatim from
 * the upstream artifact and never minted, validated, or renamed here.
 */
const REF_LABEL_NAMES = /** @type {const} */ (['CriterionRefs', 'ArtifactRefs']);
const REF_LABEL_ALTERNATION = REF_LABEL_NAMES.join('|');
const RESERVED_LABEL_ALTERNATION = [...LABEL_NAMES, 'Scope', ...REF_LABEL_NAMES].join('|');
const REF_TOKEN_PATTERN = `(?!(?:${RESERVED_LABEL_ALTERNATION}):)[A-Za-z0-9][\\w.#/-]*`;
const REF_LIST_PATTERN = `${REF_TOKEN_PATTERN}(?:[ \\t]*,[ \\t]*${REF_TOKEN_PATTERN})*`;
const RE_REF_LABELS = Object.fromEntries(
  REF_LABEL_NAMES.map((label) => [
    label,
    new RegExp(`(?:^|\\s)${label}:[ \\t]*(${REF_LIST_PATTERN})`),
  ])
);

/**
 * Every traceability-ref segment in a message, for removal. Global flag, so the
 * regex is instantiated per call (a shared `g` regex carries `lastIndex`).
 */
const RE_REF_SEGMENTS_SOURCE = `(?:^|\\s)(?:${REF_LABEL_ALTERNATION}):[ \\t]*${REF_LIST_PATTERN}`;

/**
 * Remove the traceability-ref segments from a finding message.
 *
 * Consumers that scan the message body with deliberately greedy regexes — the
 * verifier's evidence and actionability checks read to end-of-line — MUST call
 * this first. Refs are additive metadata (#1666) and must not shift any
 * decision: an `ArtifactRefs: plan.md#AC-4` anchor is otherwise indistinguishable
 * from an evidence file reference, and the artifact is by design not in the diff.
 * @param {string|null|undefined} message
 * @returns {string} the message as it read before the refs labels existed
 */
export function stripTraceabilityRefs(message) {
  return String(message ?? '').replace(new RegExp(RE_REF_SEGMENTS_SOURCE, 'g'), '');
}

/**
 * Extract one traceability ref label into a string array.
 * @param {string} text
 * @param {typeof REF_LABEL_NAMES[number]} label
 * @returns {string[]|null} null when the label is absent or carries no token,
 *   so the field is omitted downstream instead of emitted as an empty array.
 */
function extractRefs(text, label) {
  const raw = RE_REF_LABELS[label].exec(text)?.[1];
  if (!raw) return null;
  const refs = raw
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref.length > 0);
  return refs.length > 0 ? refs : null;
}

/**
 * Parse a labeled finding message string into structured fields.
 * @param {string} message
 * @returns {{ title: string, evidence: string[], impact: string, suggestion: string, severity: string|null, confidence: string|null, scope: string|null, criterionRefs: string[]|null, artifactRefs: string[]|null }}
 */
export function parseFindingMessage(message) {
  const text = String(message ?? '');
  // A genuine (value-constrained) Scope or refs label also terminates a capture,
  // so a trailing self-report is not absorbed into the preceding field.
  const terminator = [
    `\\s+(?:${LABEL_ALTERNATION}):`,
    `\\s+Scope:\\s*(?:${SCOPE_VALUE_PATTERN})\\b`,
    `\\s+(?:${REF_LABEL_ALTERNATION}):[ \\t]*(?:${REF_TOKEN_PATTERN})`,
    '$',
  ].join('|');
  const get = (label) => {
    const re = new RegExp(`${label}:\\s*([^]*?)(?=${terminator})`, 'm');
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
    // Optional LLM self-report (#1644). Machine determination in verifier.mjs
    // takes precedence; this is only the fallback when the diff cannot decide.
    // Null when the label is absent or carries an out-of-vocabulary value.
    scope: RE_SCOPE_LABEL.exec(text)?.[1] ?? null,
    // Optional traceability refs (#1666). Purely additive metadata: they never
    // reach the verifier's `verified` decision or any gate.
    criterionRefs: extractRefs(text, 'CriterionRefs'),
    artifactRefs: extractRefs(text, 'ArtifactRefs'),
  };
}

/**
 * Normalize a finding scope value to the output schema vocabulary.
 * Unknown / absent values fail safe to `in-diff` so that an undetermined
 * scope never demotes a finding.
 * @param {string|null|undefined} rawScope
 * @returns {'in-diff'|'pre-existing'}
 */
export function normalizeScope(rawScope) {
  // Collapse the separator variants the Scope label accepts (`in diff`,
  // `pre_existing`, …) onto the canonical hyphenated vocabulary.
  const canonical = String(rawScope ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-');
  switch (canonical) {
    case 'pre-existing':
    case 'preexisting':
      return 'pre-existing';
    case 'in-diff':
    case 'indiff':
      return 'in-diff';
    default:
      return DEFAULT_FINDING_SCOPE;
  }
}

/**
 * Map internal severity vocabulary (blocker/warning/nit) to output schema vocabulary.
 * Accepts both vocabularies; unknown values default to 'major' (fail-safe).
 * @param {string|null|undefined} internalSeverity
 * @returns {'critical'|'major'|'minor'|'info'}
 */
export function normalizeSeverity(internalSeverity) {
  switch (
    String(internalSeverity ?? '')
      .toLowerCase()
      .trim()
  ) {
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
