/**
 * Verify individual review findings before emission.
 *
 * Rule-based checks only (no LLM calls). Returns verification result
 * with per-check details. Rejected findings should be logged but not emitted.
 */

import {
  DEFAULT_FINDING_SCOPE,
  normalizeScope,
  normalizeSeverity,
  SEVERITY_RANK,
} from './finding-factory.mjs';

// Module-scope regexes to avoid re-creation per call
const RE_EVIDENCE = /Evidence:\s*(\S.{4,})/;
const RE_SEVERITY = /Severity:\s*(\w+)/;
const RE_SCOPE = /Scope:\s*([\w-]+)/;
const RE_ACTIONABLE = /(?:Fix|Suggestion):\s*(.{10,})/;
const RE_FILE_REF = /[\w/-]+(?:\.[\w]+)+/g;

/**
 * Check that the finding message contains "Evidence:" followed by
 * at least 5 non-whitespace characters of content.
 * @param {{ message?: string }} finding
 * @returns {boolean}
 */
function checkEvidenceExists(finding) {
  const text = String(finding?.message ?? '');
  const match = RE_EVIDENCE.exec(text);
  return match !== null;
}

/**
 * Check that the finding's phase matches the skill's declared phase.
 * The skill phase may be a single phase or an array of phases.
 * Lenient: returns true when either side is missing phase information.
 * @param {{ phase?: string }} finding
 * @param {{ metadata?: { phase?: string | string[] } }} skill
 * @returns {boolean}
 */
function checkPhaseCoherent(finding, skill) {
  const findingPhase = finding?.phase;
  const skillPhase = skill?.metadata?.phase;
  if (!findingPhase || !skillPhase) return true;
  return Array.isArray(skillPhase)
    ? skillPhase.includes(findingPhase)
    : findingPhase === skillPhase;
}

/**
 * Check that the finding severity does not exceed the skill's declared
 * severity level. Uses the internal vocabulary mapping from review-core.md.
 * Lenient: returns true when severity cannot be determined from either side.
 * @param {{ message?: string }} finding
 * @param {{ metadata?: { severity?: string } }} skill
 * @returns {boolean}
 */
function checkSeverityJustified(finding, skill) {
  const text = String(finding?.message ?? '');
  const sevMatch = RE_SEVERITY.exec(text);
  if (!sevMatch) return true;

  const skillSeverity = skill?.metadata?.severity;
  if (!skillSeverity) return true;

  const findingNormalized = normalizeSeverity(sevMatch[1]);
  const skillNormalized = normalizeSeverity(skillSeverity);

  const findingRank = SEVERITY_RANK[findingNormalized] ?? SEVERITY_RANK.major;
  const skillRank = SEVERITY_RANK[skillNormalized] ?? SEVERITY_RANK.major;

  return findingRank <= skillRank;
}

/**
 * Check that the finding message contains "Fix:" or "Suggestion:" followed
 * by at least 10 characters of actionable content.
 * @param {{ message?: string }} finding
 * @returns {boolean}
 */
function checkSuggestionActionable(finding) {
  const text = String(finding?.message ?? '');
  const match = RE_ACTIONABLE.exec(text);
  return match !== null;
}

/**
 * Check that file names referenced in the Evidence text actually appear
 * in the diff. Lenient: returns true when no file references are found
 * in the evidence (to avoid false negatives on prose-only evidence).
 * @param {{ message?: string }} finding
 * @param {string} diffText
 * @returns {boolean}
 */
function checkEvidenceInDiff(finding, diffText) {
  const text = String(finding?.message ?? '');
  const evidenceMatch = RE_EVIDENCE.exec(text);
  if (!evidenceMatch) return true;

  const evidenceText = evidenceMatch[1];
  const fileRefs = evidenceText.match(RE_FILE_REF);
  if (!fileRefs || fileRefs.length === 0) return true;

  const diff = String(diffText ?? '');
  return fileRefs.some((ref) => diff.includes(ref));
}

/**
 * Expected phase(s) for each file type category from file-classifier.
 * Lenient: categories not listed here are not checked.
 */
const FILE_TYPE_PHASE_MAP = {
  test: ['downstream'],
  docs: ['upstream', 'midstream'],
  schema: ['upstream', 'midstream'],
  migration: ['upstream', 'midstream'],
};

/**
 * Check that the finding's file category is coherent with the finding's phase.
 * Uses file-classifier output to map file → category → expected phases.
 * Lenient: returns true when information is insufficient.
 * @param {{ file?: string, phase?: string }} finding
 * @param {Record<string, string[]> | null | undefined} fileTypes
 * @returns {boolean}
 */
function checkFilePhaseCoherent(finding, fileTypes) {
  if (!fileTypes || !finding?.file || !finding?.phase) return true;
  const fileCategory = Object.entries(fileTypes).find(([, files]) =>
    files.includes(finding.file)
  )?.[0];
  if (!fileCategory) return true;
  const expectedPhases = FILE_TYPE_PHASE_MAP[fileCategory];
  if (!expectedPhases) return true;
  return expectedPhases.includes(finding.phase);
}

/**
 * Tolerance (in lines) when matching a finding line against the diff's added
 * lines. Mirrors the ±2 window used by findingsOverlap in
 * reviewer-orchestrator.mjs, absorbing off-by-a-line LLM line numbers.
 */
const SCOPE_LINE_TOLERANCE = 2;

/**
 * Locate the parsed-diff entry for a finding's file.
 * Accepts an exact path match first, then a suffix match so that findings
 * reported with a repo-relative path still match a prefixed diff path.
 * @param {string} file
 * @param {Array<{ path?: string, newPath?: string, addedLines?: number[] }>} diffFiles
 * @returns {{ path?: string, newPath?: string, addedLines?: number[] } | null}
 */
function findDiffFileEntry(file, diffFiles) {
  const target = String(file ?? '');
  if (!target) return null;
  const candidates = (entry) => [entry?.path, entry?.newPath].filter(Boolean).map(String);
  const exact = diffFiles.find((entry) => candidates(entry).includes(target));
  if (exact) return exact;
  return (
    diffFiles.find((entry) =>
      candidates(entry).some((p) => p.endsWith(`/${target}`) || target.endsWith(`/${p}`))
    ) ?? null
  );
}

/**
 * Machine determination of a finding's scope by matching its line against the
 * added lines of the parsed diff (#1644 Phase 1, option B).
 *
 * Returns `null` when the diff cannot decide (no parsed diff, file not present
 * in the diff, or the finding carries no line number). Callers fall back to the
 * LLM self-report and then to the fail-safe default.
 *
 * Context lines (unified ±3) are deliberately treated as `pre-existing`: they
 * are not changed lines.
 *
 * @param {{ file?: string, line?: number|null, lineStart?: number|null }} finding
 * @param {Array<object>|null|undefined} diffFiles parsed diff files (diff-processor parseUnifiedDiff)
 * @returns {'in-diff'|'pre-existing'|null}
 */
export function determineScopeFromDiff(finding, diffFiles) {
  if (!Array.isArray(diffFiles) || diffFiles.length === 0) return null;
  const entry = findDiffFileEntry(finding?.file, diffFiles);
  if (!entry) return null;

  const line = finding?.line ?? finding?.lineStart ?? null;
  if (typeof line !== 'number' || !Number.isFinite(line)) return null;

  const addedLines = Array.isArray(entry.addedLines) ? entry.addedLines : [];
  if (addedLines.length === 0) return null;

  const isAdded = addedLines.some((added) => Math.abs(added - line) <= SCOPE_LINE_TOLERANCE);
  return isAdded ? 'in-diff' : 'pre-existing';
}

/**
 * Resolve the final scope of a finding by combining the machine determination
 * with the optional LLM self-report (`Scope:` label), per the adopted hybrid
 * (option C): machine wins, self-report fills the gap, default is fail-safe.
 *
 * @param {{ finding: object, diffFiles?: Array<object>|null }} params
 * @returns {{ scope: 'in-diff'|'pre-existing', source: 'machine'|'self-reported'|'default', selfReported: 'in-diff'|'pre-existing'|null, mismatch: boolean }}
 */
export function resolveFindingScope({ finding, diffFiles }) {
  const machineScope = determineScopeFromDiff(finding, diffFiles);
  const selfReportMatch = RE_SCOPE.exec(String(finding?.message ?? ''));
  const selfReported = selfReportMatch ? normalizeScope(selfReportMatch[1]) : null;

  if (machineScope) {
    return {
      scope: machineScope,
      source: 'machine',
      selfReported,
      mismatch: selfReported !== null && selfReported !== machineScope,
    };
  }
  if (selfReported) {
    return { scope: selfReported, source: 'self-reported', selfReported, mismatch: false };
  }
  return { scope: DEFAULT_FINDING_SCOPE, source: 'default', selfReported: null, mismatch: false };
}

/**
 * @param {{ finding: object, diff: string, skill: object, fileTypes?: object, diffFiles?: Array<object>|null }} params
 * @returns {{ verified: boolean, reasons: string[], checks: object, scope: 'in-diff'|'pre-existing', scopeSource: string, scopeSelfReported: string|null, scopeMismatch: boolean }}
 */
export function verifyFinding({ finding, diff, skill, fileTypes, diffFiles }) {
  const checks = {
    evidenceExists: checkEvidenceExists(finding),
    evidenceInDiff: checkEvidenceInDiff(finding, diff),
    phaseCoherent: checkPhaseCoherent(finding, skill),
    filePhaseCoherent: checkFilePhaseCoherent(finding, fileTypes),
    severityJustified: checkSeverityJustified(finding, skill),
    suggestionActionable: checkSuggestionActionable(finding),
  };

  const reasons = [];
  if (!checks.evidenceExists) reasons.push('No evidence provided in finding');
  if (!checks.evidenceInDiff) reasons.push('Evidence references file not found in diff');
  if (!checks.filePhaseCoherent) reasons.push('File type does not match finding phase');
  if (!checks.phaseCoherent) {
    const skillPhase = skill?.metadata?.phase;
    const skillPhaseLabel = Array.isArray(skillPhase) ? skillPhase.join('/') : skillPhase;
    reasons.push(`Phase mismatch: finding phase does not match skill phase "${skillPhaseLabel}"`);
  }
  if (!checks.severityJustified)
    reasons.push('Severity exceeds skill severity without justification');
  if (!checks.suggestionActionable) reasons.push('Fix/suggestion is missing or too brief');

  // Scope is metadata only (#1644 Phase 1): it never contributes a rejection
  // reason and never changes `verified`.
  const scopeResult = resolveFindingScope({ finding, diffFiles });

  return {
    verified: reasons.length === 0,
    reasons,
    checks,
    scope: scopeResult.scope,
    scopeSource: scopeResult.source,
    scopeSelfReported: scopeResult.selfReported,
    scopeMismatch: scopeResult.mismatch,
  };
}
