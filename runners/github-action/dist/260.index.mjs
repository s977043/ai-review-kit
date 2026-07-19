export const id = 260;
export const ids = [260];
export const modules = {

/***/ 4260:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   buildRunRecord: () => (/* binding */ buildRunRecord),
/* harmony export */   computeDashboard: () => (/* binding */ computeDashboard),
/* harmony export */   formatDashboard: () => (/* binding */ formatDashboard),
/* harmony export */   listRunRecords: () => (/* binding */ listRunRecords),
/* harmony export */   loadAllRunRecords: () => (/* binding */ loadAllRunRecords),
/* harmony export */   loadRunRecord: () => (/* binding */ loadRunRecord),
/* harmony export */   resolveStoreDir: () => (/* binding */ resolveStoreDir),
/* harmony export */   saveRunRecord: () => (/* binding */ saveRunRecord)
/* harmony export */ });
/* harmony import */ var node_fs_promises__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1455);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(6760);
/* harmony import */ var node_os__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(8161);
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(7598);





const STORE_DIR_NAME = '.river/runs';
const GLOBAL_STORE_DIR = node_path__WEBPACK_IMPORTED_MODULE_1__.join(node_os__WEBPACK_IMPORTED_MODULE_2__.homedir(), '.river', 'runs');

/** Compute the default store path from repoRoot (no override). */
function defaultStoreDir(repoRoot) {
  if (repoRoot) return node_path__WEBPACK_IMPORTED_MODULE_1__.join(repoRoot, STORE_DIR_NAME);
  return GLOBAL_STORE_DIR;
}

/** Resolve the store directory for a project. Prefers project-local, falls back to global. */
function resolveStoreDir(repoRoot, { storeDir } = {}) {
  return storeDir ?? defaultStoreDir(repoRoot);
}

/** Generate a unique run ID from timestamp + short hash. */
function generateRunId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = (0,node_crypto__WEBPACK_IMPORTED_MODULE_3__.createHash)('sha256').update(String(Math.random())).digest('hex').slice(0, 6);
  return `${ts}-${rand}`;
}

/**
 * Build a ReviewRun record from a runLocalReview result.
 *
 * @param {object} result — return value of runLocalReview
 * @param {{ phase?: string, runId?: string }} [opts]
 * @returns {object} run record ready for persistence
 */
/**
 * Trust-boundary note (Epic #1347 S3, adversarial design review): the run
 * store lives at `.river/runs/` INSIDE the reviewed repository, writable by
 * the agent under review, and runtime tampering is invisible to the gate's
 * rule 0 (which only sees diffs). Records here are a convenience audit
 * reference, NOT tamper-evident evidence — append-only storage, signing, or
 * off-repo persistence is host/CI responsibility (S4). The optional
 * `override` field is host-attested and always rendered as UNVERIFIED by
 * `river runs digest`.
 */
function buildRunRecord(result, { phase, runId, gate, decision } = {}) {
  const id = runId ?? generateRunId();
  const findings = result.findings ?? [];
  const suppressed = result.classified?.suppressed ?? [];
  const overview = result.classified?.overview ?? [];

  return {
    runId: id,
    timestamp: new Date().toISOString(),
    reviewedTarget: result.repoRoot ?? null,
    phase: phase ?? result.plan?.phase ?? 'midstream',
    reviewMode: result.reviewMode ?? result.plan?.reviewMode ?? 'medium',
    mergeBase: result.mergeBase ?? null,
    defaultBranch: result.defaultBranch ?? null,
    changedFiles: result.changedFiles ?? [],
    // Epic #1347 S3: persist the same gate/decision the consumer saw so the
    // digest can aggregate them (see trust-boundary note above).
    ...(decision !== undefined ? { decision } : {}),
    ...(gate ? { gate } : {}),
    // #1600: persist the calibration debug telemetry (verifierStats,
    // verifierAllRejected, findingFormat.recommendedGaps, etc.) so it
    // survives past process memory and can be inspected from the CI
    // artifact. `result.reviewDebug` is already redacted at the source
    // (review-engine.mjs redacts promptPreview and rawLlmOutput before
    // attaching them to `debug`), so no additional redaction is needed here.
    ...(result.reviewDebug ? { debug: result.reviewDebug } : {}),
    findings,
    suppressedFindings: suppressed,
    finalSummary: {
      findingsCount: findings.length,
      suppressedCount: suppressed.length,
      overviewCount: overview.length,
      changedFilesCount: (result.changedFiles ?? []).length,
      tokenEstimate: result.tokenEstimate ?? null,
    },
  };
}

/**
 * Load ALL full run records (shared by `runs digest` / `runs summary` and the
 * GitHub Actions job-summary path — the digest needs full records; the light
 * listRunRecords metadata has no gate/findings and would silently produce an
 * empty digest, #1372 review C1).
 * @param {string} storeDir
 * @returns {Promise<Array<object>>}
 */
async function loadAllRunRecords(storeDir) {
  const runs = await listRunRecords(storeDir);
  const full = await Promise.all(
    runs.map((r) => loadRunRecord(storeDir, r.runId).catch(() => null))
  );
  return full.filter(Boolean);
}

/**
 * Persist a run record to the store directory.
 * @returns {string} path to saved file
 */
async function saveRunRecord(runRecord, { storeDir } = {}) {
  const dir = resolveStoreDir(runRecord.reviewedTarget, { storeDir });
  await node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.mkdir(dir, { recursive: true });
  const filePath = node_path__WEBPACK_IMPORTED_MODULE_1__.join(dir, `${runRecord.runId}.json`);
  await node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.writeFile(filePath, JSON.stringify(runRecord, null, 2), 'utf8');
  return filePath;
}

/**
 * List all stored runs in a store directory, sorted newest first.
 * Sorting is lexicographic by filename — relies on runId having a timestamp prefix
 * (e.g. `2026-01-01T12-00-00-abc123`) so that lexicographic order equals chronological order.
 * Custom runIds without a timestamp prefix will sort unpredictably.
 * @returns {object[]} array of { runId, timestamp, phase, reviewedTarget, findingsCount }
 */
async function listRunRecords(storeDir) {
  try {
    const entries = await node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.readdir(storeDir);
    const jsonFiles = entries
      .filter((e) => e.endsWith('.json'))
      .sort()
      .reverse();
    const metas = await Promise.allSettled(
      jsonFiles.map(async (name) => {
        const raw = await node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.readFile(node_path__WEBPACK_IMPORTED_MODULE_1__.join(storeDir, name), 'utf8');
        const rec = JSON.parse(raw);
        return {
          runId: rec.runId,
          timestamp: rec.timestamp,
          phase: rec.phase,
          reviewedTarget: rec.reviewedTarget,
          findingsCount: rec.finalSummary?.findingsCount ?? 0,
          suppressedCount: rec.finalSummary?.suppressedCount ?? 0,
          overviewCount: rec.finalSummary?.overviewCount ?? 0,
          changedFilesCount: rec.finalSummary?.changedFilesCount ?? 0,
        };
      })
    );
    return metas.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  } catch {
    return [];
  }
}

/**
 * Load a full run record by runId from the store directory.
 * Validates that the resolved path stays within storeDir (path traversal guard).
 */
async function loadRunRecord(storeDir, runId) {
  const base = node_path__WEBPACK_IMPORTED_MODULE_1__.resolve(storeDir);
  const resolved = node_path__WEBPACK_IMPORTED_MODULE_1__.resolve(base, `${runId}.json`);
  if (!resolved.startsWith(base + node_path__WEBPACK_IMPORTED_MODULE_1__.sep) && resolved !== base) {
    throw new Error(`Invalid runId: path traversal detected`);
  }
  const raw = await node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.readFile(resolved, 'utf8');
  return JSON.parse(raw);
}

/**
 * Compute aggregate dashboard metrics across a list of run records.
 */
function computeDashboard(runRecords) {
  if (!runRecords.length) {
    return {
      totalRuns: 0,
      totalFindings: 0,
      totalSuppressed: 0,
      suppressRate: null,
      severityDistribution: {},
      confidenceDistribution: {},
      reviewerRoleDistribution: {},
      avgFindingsPerRun: null,
    };
  }

  const allFindings = runRecords.flatMap((r) => r.findings ?? []);
  const allSuppressed = runRecords.flatMap((r) => r.suppressedFindings ?? []);

  const severityDist = {};
  const confidenceDist = {};
  const roleDist = {};

  for (const f of allFindings) {
    const sev = f.severity ?? 'unknown';
    severityDist[sev] = (severityDist[sev] ?? 0) + 1;
    const conf = f.confidence ?? 'unknown';
    confidenceDist[conf] = (confidenceDist[conf] ?? 0) + 1;
    if (f.reviewerRole) {
      roleDist[f.reviewerRole] = (roleDist[f.reviewerRole] ?? 0) + 1;
    }
  }

  const total = allFindings.length;
  const suppTotal = allSuppressed.length;

  return {
    totalRuns: runRecords.length,
    totalFindings: total,
    totalSuppressed: suppTotal,
    suppressRate: total + suppTotal > 0 ? suppTotal / (total + suppTotal) : null,
    severityDistribution: severityDist,
    confidenceDistribution: confidenceDist,
    reviewerRoleDistribution: roleDist,
    avgFindingsPerRun: total / runRecords.length,
  };
}

/**
 * Format dashboard as a Markdown string.
 */
function formatDashboard(dashboard) {
  const lines = ['## River Review Dashboard', ''];

  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total runs | ${dashboard.totalRuns} |`);
  lines.push(`| Total findings | ${dashboard.totalFindings} |`);
  lines.push(`| Total suppressed | ${dashboard.totalSuppressed} |`);
  const suppPct =
    dashboard.suppressRate !== null ? `${(dashboard.suppressRate * 100).toFixed(1)}%` : 'N/A';
  lines.push(`| Suppress rate | ${suppPct} |`);
  const avgF =
    dashboard.avgFindingsPerRun !== null ? dashboard.avgFindingsPerRun.toFixed(1) : 'N/A';
  lines.push(`| Avg findings/run | ${avgF} |`);
  lines.push('');

  if (Object.keys(dashboard.severityDistribution).length) {
    lines.push('### Severity Distribution');
    lines.push('| Severity | Count |');
    lines.push('|---|---|');
    for (const [sev, cnt] of Object.entries(dashboard.severityDistribution).sort(
      (a, b) => b[1] - a[1]
    )) {
      lines.push(`| ${sev} | ${cnt} |`);
    }
    lines.push('');
  }

  if (Object.keys(dashboard.confidenceDistribution).length) {
    lines.push('### Confidence Distribution');
    lines.push('| Confidence | Count |');
    lines.push('|---|---|');
    for (const [conf, cnt] of Object.entries(dashboard.confidenceDistribution).sort(
      (a, b) => b[1] - a[1]
    )) {
      lines.push(`| ${conf} | ${cnt} |`);
    }
    lines.push('');
  }

  if (Object.keys(dashboard.reviewerRoleDistribution).length) {
    lines.push('### Reviewer Role Distribution');
    lines.push('| Role | Count |');
    lines.push('|---|---|');
    for (const [role, cnt] of Object.entries(dashboard.reviewerRoleDistribution).sort(
      (a, b) => b[1] - a[1]
    )) {
      lines.push(`| ${role} | ${cnt} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}


/***/ })

};

//# sourceMappingURL=260.index.mjs.map