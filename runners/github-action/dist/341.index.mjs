export const id = 341;
export const ids = [341];
export const modules = {

/***/ 9341:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   verifyFinding: () => (/* binding */ verifyFinding)
/* harmony export */ });
/* harmony import */ var _finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1535);
/**
 * Verify individual review findings before emission.
 *
 * Rule-based checks only (no LLM calls). Returns verification result
 * with per-check details. Rejected findings should be logged but not emitted.
 */



// Module-scope regexes to avoid re-creation per call
const RE_EVIDENCE = /Evidence:\s*(\S.{4,})/;
const RE_SEVERITY = /Severity:\s*(\w+)/;
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

  const findingNormalized = (0,_finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__/* .normalizeSeverity */ .lv)(sevMatch[1]);
  const skillNormalized = (0,_finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__/* .normalizeSeverity */ .lv)(skillSeverity);

  const findingRank = _finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__/* .SEVERITY_RANK */ .f3[findingNormalized] ?? _finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__/* .SEVERITY_RANK */ .f3.major;
  const skillRank = _finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__/* .SEVERITY_RANK */ .f3[skillNormalized] ?? _finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__/* .SEVERITY_RANK */ .f3.major;

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
 * @param {{ finding: object, diff: string, skill: object, fileTypes?: object }} params
 * @returns {{ verified: boolean, reasons: string[], checks: object }}
 */
function verifyFinding({ finding, diff, skill, fileTypes }) {
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

  return {
    verified: reasons.length === 0,
    reasons,
    checks,
  };
}


/***/ })

};

//# sourceMappingURL=341.index.mjs.map