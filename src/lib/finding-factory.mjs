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
const RE_SCOPE_LABEL_SOURCE = `(?:^|\\s)Scope:\\s*(?:${SCOPE_VALUE_PATTERN})\\b`;
const RE_SCOPE_LABEL = new RegExp(`(?:^|\\s)Scope:\\s*(${SCOPE_VALUE_PATTERN})\\b`, 'i');

/**
 * Extract the self-reported `Scope:` label value from a message (#1644).
 *
 * The single reader of the label grammar: `parseFindingMessage` here and
 * `resolveFindingScope` (src/lib/verifier.mjs) both go through this function,
 * so `SCOPE_VALUE_PATTERN` stays the one place the vocabulary is written.
 * The value is constrained to the known vocabulary so that prose containing
 * the word "Scope:" (OAuth / IAM scopes are common in review text) cannot be
 * mistaken for a self-report, and so that an out-of-vocabulary label
 * (`Scope: unknown`) yields `null` rather than being normalized into a
 * fabricated self-report.
 *
 * A function rather than an exported RegExp: sharing one regex object across
 * modules would also share its `lastIndex`, so adding `g` or `y` later would
 * silently make the match position depend on the previous caller. The regex
 * stays module-private and stateless (`i` only) behind this boundary.
 *
 * @param {string|null|undefined} message
 * @returns {string|null} the raw matched vocabulary token (not normalized —
 *   pass it through `normalizeScope` for the canonical value), or `null` when
 *   the message carries no in-vocabulary `Scope:` label
 */
export function matchSelfReportedScope(message) {
  return RE_SCOPE_LABEL.exec(String(message ?? ''))?.[1] ?? null;
}

/**
 * Remove the self-reported `Scope:` label from a finding message (#1915 A).
 *
 * The label is a prompt-protocol artifact, not reviewer content: it is consumed
 * by `resolveFindingScope` (src/lib/verifier.mjs), where the machine
 * determination from the parsed diff OUTRANKS it. Once a finding carries a
 * resolved `scope` field, the two can disagree — that disagreement is a
 * designed state, counted as `debug.scopeStats.mismatch` — and a surface that
 * renders both puts two opposite scopes on one finding.
 *
 * Callers MUST only strip when the finding actually carries a resolved `scope`.
 * On a legacy artifact that predates the field the self-report is the only
 * scope information there is, so removing it would delete information rather
 * than de-duplicate it.
 *
 * Same shape as `stripTraceabilityRefs`: the grammar is shared with the
 * extraction regex above, so the strip can never target a different set of
 * strings than the parse does.
 * @param {string|null|undefined} message
 * @returns {string} the message with every self-reported `Scope:` label removed
 */
export function stripSelfReportedScope(message) {
  return String(message ?? '').replace(new RegExp(RE_SCOPE_LABEL_SOURCE, 'gi'), '');
}

/**
 * Traceability ref labels (#1666 / #1545 Phase 2).
 * @see docs/review/output-format.md
 */
export const REF_LABEL_NAMES = /** @type {const} */ (['CriterionRefs', 'ArtifactRefs']);
const REF_LABEL_ALTERNATION = REF_LABEL_NAMES.join('|');

/**
 * Single source of truth for every label a finding message may carry.
 *
 * Any consumer that needs to know "this word followed by a colon is structural,
 * not content" MUST import this instead of re-listing the labels. `Suggestion`
 * is an accepted alias of `Fix` in the verifier's actionability check, but it
 * was missing from the reserved set, so `CriterionRefs: AC-4, Suggestion: …`
 * swallowed the suggestion and emitted `"Suggestion"` as a ref value.
 */
export const RESERVED_FINDING_LABELS = /** @type {const} */ ([
  ...LABEL_NAMES,
  'Suggestion',
  'Scope',
  ...REF_LABEL_NAMES,
]);
const RESERVED_LABEL_ALTERNATION = RESERVED_FINDING_LABELS.join('|');

/**
 * Grammar of the traceability-ref labels. Same containment problem as the Scope
 * label — an unconstrained `CriterionRefs:` in LABEL_ALTERNATION would let any
 * prose occurrence terminate the preceding Evidence/Fix capture and silently
 * truncate it — but refs are free-form identifiers, so a closed value vocabulary
 * is not available. The value is constrained by SHAPE instead:
 *
 * - a ref token is whitespace-free (`AC-4`, `TC-7`, `plan.md#AC-4`), so prose —
 *   which always continues with spaces — cannot satisfy the label;
 * - a list is separated by `,` or `、`, so an adjacent label (` Severity: warning`)
 *   ends it rather than being swallowed;
 * - a token that is itself a reserved label followed by a colon is rejected, so
 *   a stray trailing comma cannot consume the next label;
 * - a `https://…` value is rejected: it truncates at the scheme colon, so URLs
 *   are not a supported ref shape (write the repo-relative anchor instead);
 * - matching is case-SENSITIVE, so the lowerCamel schema field name
 *   (`criterionRefs`) quoted inside review prose is not read as a label.
 *
 * LABEL_PREFIX is a zero-width negative lookbehind rather than a consuming
 * `(?:^|\s)`: the label may follow Japanese punctuation (`…直す。CriterionRefs:`
 * is what the filling skills actually emit), and stripping a segment must not
 * eat the punctuation that preceded it. A backtick is deliberately NOT a valid
 * prefix — docs and SKILL.md wrap label mentions in backticks precisely so that
 * prose about a label never becomes a label.
 *
 * River Review does not own these identifiers: they are copied verbatim from
 * the upstream artifact and never minted, validated, or renamed here.
 */
const LABEL_PREFIX = '(?<![^\\s。、（）「」])';
const REF_COLON = '[:：]';
const REF_SEPARATOR = '[ \\t]*[,、][ \\t]*';
const REF_TOKEN_BODY = `(?!(?:${RESERVED_LABEL_ALTERNATION})${REF_COLON})(?!https?:\\/\\/)(?:\\.{1,2}\\/)?[A-Za-z0-9][\\w.#/-]*`;
// Markdown-quoted values (`` `plan.md#AC-4` ``) are accepted and unwrapped.
const REF_TOKEN_PATTERN = `\`?${REF_TOKEN_BODY}\`?`;
const REF_LIST_PATTERN = `${REF_TOKEN_PATTERN}(?:${REF_SEPARATOR}${REF_TOKEN_PATTERN})*`;
const REF_LABEL_HEAD = `${LABEL_PREFIX}(?:${REF_LABEL_ALTERNATION})${REF_COLON}[ \\t]*`;
// A refs label is structural as soon as it is followed by something that looks
// like a value — including a URL, which is NOT a supported ref shape. Otherwise
// `Fix: … ArtifactRefs: https://…` would leave the unsupported value glued to
// the Fix text instead of merely being dropped.
const REF_VALUE_START = `(?:${REF_TOKEN_PATTERN}|https?:\\/\\/\\S)`;

/**
 * Terminator alternation shared by every field capture. A Scope or refs label
 * ends a capture only when it carries a well-formed value, so prose mentioning
 * the label word does not truncate the preceding field.
 *
 * The leading whitespace matcher is a single `\s`, not `\s+`: the terminator is
 * always used inside a lookahead behind a lazy `[^]*?`, so an unbounded `\s+`
 * re-scans the whole whitespace run at every position the lazy quantifier steps
 * to — quadratic on a message padded with spaces (measured: 1.2 s at 20k
 * spaces). Matching only the whitespace character immediately before the label
 * is equivalent, because every consumer trims the captured field.
 */
const FIELD_TERMINATOR = [
  `\\s(?:${LABEL_ALTERNATION}):`,
  `\\sScope:\\s*(?:${SCOPE_VALUE_PATTERN})\\b`,
  `${REF_LABEL_HEAD}${REF_VALUE_START}`,
  '$',
].join('|');

const RE_REF_LABELS = Object.fromEntries(
  REF_LABEL_NAMES.map((label) => [
    label,
    new RegExp(`${LABEL_PREFIX}${label}${REF_COLON}[ \\t]*(${REF_LIST_PATTERN})`, 'g'),
  ])
);

/** Every traceability-ref segment in a message, for removal. */
const RE_REF_SEGMENTS_SOURCE = `${REF_LABEL_HEAD}${REF_LIST_PATTERN}`;

/**
 * The full field text of every traceability-ref label — from the label to the
 * next recognized label — not just the strictly-parsed value list.
 *
 * The verifier uses this to decide which file references in a message are
 * artifact citations rather than evidence claims. It is deliberately wider than
 * the extraction grammar so that a shape we do not parse (a space-separated
 * list, a URL) still does not destroy the whole finding.
 * @param {string|null|undefined} message
 * @returns {string[]}
 */
export function extractRefFieldSpans(message) {
  const re = new RegExp(
    `${REF_LABEL_HEAD}(?=${REF_VALUE_START})([^]*?)(?=${FIELD_TERMINATOR})`,
    'g'
  );
  return [...String(message ?? '').matchAll(re)].map((m) => m[1]);
}

/**
 * Remove the traceability-ref segments from a finding message.
 *
 * Consumers that measure the message body with deliberately greedy regexes —
 * the verifier's minimum-length checks on Evidence and Fix read to end-of-line —
 * MUST call this first, so appended refs cannot pad a too-short field into
 * passing. Removal only ever makes those checks stricter, so it cannot be used
 * to smuggle content past them. Checks that scan for file references must NOT
 * use this (deleting text would let a hallucinated path escape) — see
 * `extractRefFieldSpans`.
 * @param {string|null|undefined} message
 * @returns {string} the message as it read before the refs labels existed
 */
export function stripTraceabilityRefs(message) {
  return String(message ?? '').replace(new RegExp(RE_REF_SEGMENTS_SOURCE, 'g'), '');
}

/**
 * Extract one traceability ref label into a string array. Every occurrence of
 * the label is merged (a model that repeats `CriterionRefs:` must not have the
 * later ones silently dropped) and duplicates are removed, order preserved.
 * @param {string} text
 * @param {typeof REF_LABEL_NAMES[number]} label
 * @returns {string[]|null} null when the label is absent or carries no token,
 *   so the field is omitted downstream instead of emitted as an empty array.
 */
function extractRefs(text, label) {
  const refs = [];
  for (const match of text.matchAll(RE_REF_LABELS[label])) {
    for (const raw of match[1].split(/[,、]/)) {
      const ref = raw
        .trim()
        .replace(/^`+|`+$/g, '')
        .trim();
      if (ref.length > 0 && !refs.includes(ref)) refs.push(ref);
    }
  }
  return refs.length > 0 ? refs : null;
}

/**
 * Parse a labeled finding message string into structured fields.
 * @param {string} message
 * @returns {{ title: string, evidence: string[], impact: string, suggestion: string, severity: string|null, confidence: string|null, scope: string|null, criterionRefs: string[]|null, artifactRefs: string[]|null }}
 */
export function parseFindingMessage(message) {
  const text = String(message ?? '');
  const get = (label) => {
    const re = new RegExp(`${label}:\\s*([^]*?)(?=${FIELD_TERMINATOR})`, 'm');
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
    scope: matchSelfReportedScope(text),
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
 * Stage 1 of the classification pipeline (#1857 Phase 1): the deterministic,
 * cheap prefilter. It owns the four dispositions that need no semantic
 * judgement — low confidence, insufficient evidence, style-only, and
 * deterministic duplicate — and nothing else. Scoring, the overview cap and
 * output ordering belong to {@link rankFindingsForOutput}; semantic
 * adjudication belongs to {@link adjudicateFindings}.
 *
 * Suppressed entries are copies (`{ ...finding, suppressReason }`); the input
 * findings are never mutated. `retained` holds the ORIGINAL objects.
 *
 * @param {object[]} findings
 * @returns {{ retained: object[], suppressed: object[] }}
 * @see docs/adr/007-semantic-precision-pass.md
 */
export function prefilterFindings(findings) {
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

  return { retained: deduped, suppressed };
}

/**
 * Stage 2 of the classification pipeline (#1857 Phase 1): the seam where the
 * Semantic Precision Pass (the Judge of ADR-007) will run.
 *
 * In Phase 1 this is deliberately the identity function — it retains every
 * input finding and suppresses none — so that `classifyFindings` reproduces
 * the pre-refactor result exactly. Phase 2 fills the body in; the contract
 * that Phase 2 must keep is that a Judge failure returns every input finding
 * in `retained` rather than an empty list (ADR-007 "Judge 失敗時は legacy
 * findings をそのまま Gate へ渡す").
 *
 * @param {object[]} findings
 * @param {{ reviewMode?: 'tiny'|'medium'|'large' }} [_options]
 * @returns {{ retained: object[], suppressed: object[] }}
 * @see docs/adr/007-semantic-precision-pass.md
 */
export function adjudicateFindings(findings, _options = {}) {
  return { retained: [...findings], suppressed: [] };
}

/**
 * Stage 3 of the classification pipeline (#1857 Phase 1): scoring, output
 * ordering and the overview cap. Per ADR-007 the cap is a RANKING outcome, not
 * a disposition — it is only reported through `suppressReason` here because
 * Phase 1 keeps the emitted values byte-identical to the pre-refactor ones.
 *
 * The `overviewRuleIds` guard collapses a second finding that carries an
 * already-shown non-`unknown` ruleId. Reached through `classifyFindings` that
 * branch is unreachable, because `prefilterFindings` has already collapsed
 * every duplicate ruleId; it is kept so the function is also correct when
 * called on a set that was not prefiltered.
 *
 * @param {object[]} findings
 * @param {{ reviewMode?: 'tiny'|'medium'|'large' }} [options]
 * @returns {{ overview: object[], inlineCandidates: object[], suppressed: object[] }}
 * @see docs/adr/007-semantic-precision-pass.md
 */
export function rankFindingsForOutput(findings, options = {}) {
  const reviewMode = options.reviewMode ?? 'medium';
  const maxOverview = reviewMode === 'tiny' ? 3 : reviewMode === 'large' ? 8 : 5;

  const suppressed = [];
  const sorted = [...findings].sort(
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

/**
 * Compatibility facade over the three stages above (#1857 Phase 1). With
 * adjudication disabled — the only state Phase 1 ships — the return value is
 * identical to the pre-split implementation, including the ORDER of
 * `suppressed`: prefilter dispositions first (in input order, duplicates
 * last), then adjudication, then the ranking overflow.
 *
 * @param {object[]} findings
 * @param {{ reviewMode?: 'tiny'|'medium'|'large' }} [options]
 * @returns {{ overview: object[], inlineCandidates: object[], suppressed: object[] }}
 */
export function classifyFindings(findings, options = {}) {
  const prefiltered = prefilterFindings(findings);
  const adjudicated = adjudicateFindings(prefiltered.retained, options);
  const ranked = rankFindingsForOutput(adjudicated.retained, options);

  return {
    overview: ranked.overview,
    inlineCandidates: ranked.inlineCandidates,
    suppressed: [...prefiltered.suppressed, ...adjudicated.suppressed, ...ranked.suppressed],
  };
}

// ---------------------------------------------------------------------------
// Fingerprint (finding-fingerprint)
// ---------------------------------------------------------------------------

/**
 * Shared normalized key base for both fingerprint algorithms:
 * `ruleId::file::first-60-chars-of-normalized-message`. The v1 hash input is
 * exactly this string; v2 appends a line segment to the SAME base so the two
 * algorithms cannot drift on normalization or truncation rules (#1797).
 */
function fingerprintKeyBase(finding) {
  const ruleId = String(finding.ruleId ?? 'unknown');
  const file = String(finding.file ?? '');
  const msgNorm = String(finding.message ?? finding.title ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${ruleId}::${file}::${msgNorm}`;
}

/**
 * Stable fingerprint for a finding so that the same logical issue can be
 * matched across review runs even when IDs regenerate.
 *
 * Strategy: hash(ruleId + file + first-60-chars-of-message).
 * Intentionally omits lineStart/lineEnd because line numbers shift as code
 * changes, but the same logical finding should still be considered persisting.
 *
 * This is the `v1` algorithm (`context.fingerprintAlgo` in
 * schemas/suppression-context.schema.json). Its input MUST NOT change:
 * review-differ.mjs and runs-digest.mjs use it for cross-run finding tracking,
 * and every suppression already persisted in `.river/memory/index.json`
 * stores a v1 value (#1797).
 */
export function computeFingerprint(finding) {
  return createHash('sha256').update(fingerprintKeyBase(finding)).digest('hex').slice(0, 16);
}

/**
 * Line-anchored fingerprint (`v2`, #1797). Same key base as v1 plus the
 * finding's start line, so suppressing one occurrence of a kind does NOT
 * suppress every same-kind finding in the same file (v1 collapses them
 * because heuristic detector messages are static per kind).
 *
 * Known, deliberate trade-off: a v2 suppression stops matching when the
 * finding's line shifts (any edit above it re-surfaces the finding). That is
 * inherent to line anchoring; v1 remains the default for suppressions that
 * should survive line drift.
 *
 * Line resolution mirrors the pipeline's dual field convention
 * (`lineStart` internally, `line` on comments/issues — see
 * src/lib/review-plan.mjs normalizeFindingForArtifact). A finding that is not
 * line-anchored hashes with line 0, keeping the value stable and distinct
 * from v1.
 */
export function computeFingerprintV2(finding) {
  const lineStart = finding.lineStart ?? finding.line;
  const line = Number.isInteger(lineStart) && lineStart >= 1 ? lineStart : 0;
  const raw = `${fingerprintKeyBase(finding)}::L${line}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Annotate findings with their fingerprints (non-mutating). `fingerprint`
 * stays the v1 value (unchanged consumers: review-differ, runs-digest,
 * existing suppressions); `fingerprintV2` is the line-anchored value used by
 * applySuppressions for entries with `fingerprintAlgo: 'v2'` (#1797).
 */
export function annotateFingerprints(findings) {
  return findings.map((f) => ({
    ...f,
    fingerprint: computeFingerprint(f),
    fingerprintV2: computeFingerprintV2(f),
  }));
}

/**
 * Decide which fingerprint algorithm a 16-hex value belongs to, by looking it
 * up among findings that already carry BOTH annotations (#1823 残件2).
 *
 * v1 and v2 share one 16-hex space, so a value copied out of `river review
 * --debug` is indistinguishable on sight. Every consumer that indexes findings
 * by `finding.fingerprint` (shadow aggregation, `promote propose`) therefore
 * fails to match a v2 value with no error of any kind. This classifier is what
 * lets those consumers say WHICH mistake was made instead of staying silent:
 * the run records already persist `fingerprintV2` alongside `fingerprint`
 * (annotateFingerprints runs before the record is saved), so the algorithm can
 * be inferred rather than declared by the caller.
 *
 * `v1` wins when a finding somehow carries the same value in both fields,
 * because v1 is what the consumers index — reporting `v2` there would send the
 * reader after a mismatch that does not exist.
 *
 * @param {string} fingerprint 16-hex value to classify.
 * @param {Iterable<object>} findings Findings annotated by annotateFingerprints.
 * @returns {'v1'|'v2'|null} null when the value matches no known finding.
 */
export function classifyFingerprintAlgo(fingerprint, findings) {
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) return null;
  let sawV2 = false;
  for (const finding of findings ?? []) {
    if (finding?.fingerprint === fingerprint) return 'v1';
    if (finding?.fingerprintV2 === fingerprint) sawV2 = true;
  }
  return sawV2 ? 'v2' : null;
}

/**
 * Warning text for a `findingFingerprint` that joins to no saved finding
 * (#1823 残件2). Exported so the emitting sites and their tests share ONE
 * string, the same contract as `formatUnknownFingerprintAlgoWarning`
 * (src/lib/suppression.mjs).
 *
 * @param {{ fingerprint: string, likelyAlgo: 'v2'|null }} entry
 */
export function formatUnmatchedFeedbackFingerprintWarning({ fingerprint, likelyAlgo }) {
  const head = `Warning: findingFingerprint ${fingerprint} matches no finding in the saved runs under .river/runs/`;
  if (likelyAlgo === 'v2') {
    return (
      `${head}; it is the v2 (line-anchored) fingerprint of a saved finding. ` +
      'Feedback is joined on the v1 fingerprint, so this entry stays unjoined and clusters under its own key. ' +
      'Re-record it with the v1 value from `river review --debug`.'
    );
  }
  return `${head}. Check the value copied from \`river review --debug\`.`;
}
