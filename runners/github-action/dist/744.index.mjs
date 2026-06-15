export const id = 744;
export const ids = [744];
export const modules = {

/***/ 3744:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   diffReviews: () => (/* binding */ diffReviews),
/* harmony export */   diffRunHistory: () => (/* binding */ diffRunHistory),
/* harmony export */   formatRegressionSummary: () => (/* binding */ formatRegressionSummary)
/* harmony export */ });
/* harmony import */ var _scoring_breakdown_mjs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(9946);
/* harmony import */ var _finding_fingerprint_mjs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9597);



/**
 * @typedef {'new'|'resolved'|'persisting'|'score_changed'|'oscillated'} FindingStatus
 *
 * @typedef {object} ComparedFinding
 * @property {string} fingerprint
 * @property {FindingStatus} changeStatus
 * @property {object} current  — null when resolved
 * @property {object} previous — null when new
 * @property {number|null} scoreDelta — composite score change (current - previous), null when new/resolved
 */

/**
 * Compare two ordered lists of findings (previous run vs current run).
 *
 * @param {object[]} previousFindings
 * @param {object[]} currentFindings
 * @returns {{ new: ComparedFinding[], resolved: ComparedFinding[], persisting: ComparedFinding[], scoreChanged: ComparedFinding[], summary: object }}
 */
function diffReviews(previousFindings, currentFindings) {
  const prev = (0,_finding_fingerprint_mjs__WEBPACK_IMPORTED_MODULE_0__/* .annotateFingerprints */ .i)(previousFindings ?? []);
  const curr = (0,_finding_fingerprint_mjs__WEBPACK_IMPORTED_MODULE_0__/* .annotateFingerprints */ .i)(currentFindings ?? []);

  const prevByFp = new Map(prev.map((f) => [f.fingerprint, f]));
  const currByFp = new Map(curr.map((f) => [f.fingerprint, f]));

  const newFindings = [];
  const resolvedFindings = [];
  const persistingFindings = [];
  const scoreChangedFindings = [];

  // New: in current but not in previous
  for (const [fp, f] of currByFp) {
    if (!prevByFp.has(fp)) {
      newFindings.push({
        fingerprint: fp,
        changeStatus: 'new',
        current: f,
        previous: null,
        scoreDelta: null,
      });
    }
  }

  // Resolved: in previous but not in current
  for (const [fp, f] of prevByFp) {
    if (!currByFp.has(fp)) {
      resolvedFindings.push({
        fingerprint: fp,
        changeStatus: 'resolved',
        current: null,
        previous: f,
        scoreDelta: null,
      });
    }
  }

  // Persisting (and possibly score_changed): in both
  for (const [fp, currF] of currByFp) {
    const prevF = prevByFp.get(fp);
    if (!prevF) continue;

    const prevScore = (0,_scoring_breakdown_mjs__WEBPACK_IMPORTED_MODULE_1__/* .computeFindingBreakdown */ ._)(prevF).composite;
    const currScore = (0,_scoring_breakdown_mjs__WEBPACK_IMPORTED_MODULE_1__/* .computeFindingBreakdown */ ._)(currF).composite;
    const delta = currScore - prevScore;
    const changed = Math.abs(delta) >= 0.05;

    if (changed) {
      scoreChangedFindings.push({
        fingerprint: fp,
        changeStatus: 'score_changed',
        current: currF,
        previous: prevF,
        scoreDelta: delta,
      });
    } else {
      persistingFindings.push({
        fingerprint: fp,
        changeStatus: 'persisting',
        current: currF,
        previous: prevF,
        scoreDelta: delta,
      });
    }
  }

  const summary = {
    totalPrevious: prev.length,
    totalCurrent: curr.length,
    newCount: newFindings.length,
    resolvedCount: resolvedFindings.length,
    persistingCount: persistingFindings.length,
    scoreChangedCount: scoreChangedFindings.length,
    regressionScore: newFindings.length - resolvedFindings.length,
  };

  return {
    new: newFindings,
    resolved: resolvedFindings,
    persisting: persistingFindings,
    scoreChanged: scoreChangedFindings,
    summary,
  };
}

/**
 * Compare 3+ runs for oscillating findings (resolved then re-appeared).
 *
 * @param {{ runId: string, timestamp: string, findings: object[] }[]} runRecords
 *   Array of run records in any order; sorted internally by timestamp ascending.
 * @returns {{
 *   new: ComparedFinding[],
 *   resolved: ComparedFinding[],
 *   persisting: ComparedFinding[],
 *   scoreChanged: ComparedFinding[],
 *   oscillated: Array<{ fingerprint: string, finding: object, timeline: { runId: string, present: boolean }[] }>,
 *   summary: object
 * }}
 */
function diffRunHistory(runRecords) {
  // Defensive: sort by timestamp ascending, NaN-safe with runId tie-break
  const sorted = [...runRecords].sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    const aNaN = Number.isNaN(ta);
    const bNaN = Number.isNaN(tb);
    if (aNaN && bNaN) return (a.runId ?? '').localeCompare(b.runId ?? '');
    if (aNaN) return 1; // NaN goes to the end
    if (bNaN) return -1;
    if (ta !== tb) return ta - tb;
    return (a.runId ?? '').localeCompare(b.runId ?? ''); // stable tie-break
  });

  // Last adjacent diff for the main diff fields
  let lastDiff =
    sorted.length >= 2
      ? diffReviews(
          sorted[sorted.length - 2].findings ?? [],
          sorted[sorted.length - 1].findings ?? []
        )
      : diffReviews([], sorted.length === 1 ? (sorted[0].findings ?? []) : []);

  // Annotate each run exactly once: collect fingerprint set AND fingerprint→finding map
  // in a single pass — O(N+M) instead of two O(N×M) annotation loops.
  const fingerprintToFinding = new Map(); // fingerprint -> latest finding object
  const allFingerprints = new Set();

  const annotatedRuns = sorted.map((record) => {
    const annotated = (0,_finding_fingerprint_mjs__WEBPACK_IMPORTED_MODULE_0__/* .annotateFingerprints */ .i)(record.findings ?? []);
    const fingerprints = new Set();
    for (const f of annotated) {
      fingerprints.add(f.fingerprint);
      allFingerprints.add(f.fingerprint);
      fingerprintToFinding.set(f.fingerprint, f); // last run wins (chronological)
    }
    return { runId: record.runId, fingerprints };
  });

  // Build timeline per fingerprint
  const oscillated = [];

  for (const fp of allFingerprints) {
    const timeline = annotatedRuns.map((run) => ({
      runId: run.runId,
      present: run.fingerprints.has(fp),
    }));

    // Detect oscillation: present -> absent -> present pattern
    if (sorted.length >= 3 && _hasOscillation(timeline)) {
      oscillated.push({
        fingerprint: fp,
        finding: fingerprintToFinding.get(fp),
        timeline,
        changeStatus: 'oscillated',
      });
    }
  }

  return {
    ...lastDiff,
    oscillated,
    summary: {
      ...lastDiff.summary,
      oscillatedCount: oscillated.length,
    },
  };
}

/**
 * Returns true if the presence timeline contains a resolved→re-appeared pattern.
 * @param {{ runId: string, present: boolean }[]} timeline
 */
function _hasOscillation(timeline) {
  // Detect: present=true ... present=false ... present=true
  let seenPresent = false;
  let seenAbsent = false;
  for (const entry of timeline) {
    if (entry.present) {
      if (seenAbsent) return true; // re-appeared after absence
      seenPresent = true;
    } else {
      if (seenPresent) seenAbsent = true;
    }
  }
  return false;
}

/**
 * Format a regression diff as a Markdown summary block.
 */
function formatRegressionSummary(diff) {
  const { summary, new: newF, resolved, scoreChanged } = diff;
  const lines = ['## Regression Review Summary', ''];

  lines.push(`| Metric | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| New findings | ${summary.newCount} |`);
  lines.push(`| Resolved findings | ${summary.resolvedCount} |`);
  lines.push(`| Persisting | ${summary.persistingCount} |`);
  lines.push(`| Score changed | ${summary.scoreChangedCount} |`);
  lines.push(
    `| Regression score | ${summary.regressionScore > 0 ? `+${summary.regressionScore}` : summary.regressionScore} |`
  );
  lines.push('');

  if (newF.length) {
    lines.push('### New findings');
    for (const f of newF) {
      const sev = f.current.severity ?? 'unknown';
      const file = f.current.file ?? '?';
      lines.push(
        `- **[${sev}]** \`${file}\`: ${(f.current.title || f.current.message || '').slice(0, 80)}`
      );
    }
    lines.push('');
  }

  if (resolved.length) {
    lines.push('### Resolved findings');
    for (const f of resolved) {
      const sev = f.previous.severity ?? 'unknown';
      const file = f.previous.file ?? '?';
      lines.push(
        `- ~~[${sev}]~~ \`${file}\`: ${(f.previous.title || f.previous.message || '').slice(0, 80)}`
      );
    }
    lines.push('');
  }

  if (scoreChanged.length) {
    lines.push('### Score changes');
    for (const f of scoreChanged) {
      const delta = f.scoreDelta ?? 0;
      const sign = delta > 0 ? '+' : '';
      lines.push(
        `- \`${f.current.file ?? '?'}\` (${f.current.ruleId}): score ${sign}${delta.toFixed(2)}`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}


/***/ })

};

//# sourceMappingURL=744.index.mjs.map