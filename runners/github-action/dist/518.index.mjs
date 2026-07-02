export const id = 518;
export const ids = [518];
export const modules = {

/***/ 9518:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   buildRunsDigest: () => (/* binding */ buildRunsDigest),
/* harmony export */   formatDigestMarkdown: () => (/* binding */ formatDigestMarkdown)
/* harmony export */ });
/* harmony import */ var _finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1535);
/**
 * Runs digest — human-readable supervision summary (Epic #1347 S3 / #1350).
 *
 * Aggregates persisted run records (result-store) into the single entry
 * point a human supervisor actually reads. Design lineage: the adversarial
 * design review's Blocker 1 — "passively viewable information does not
 * produce supervision" — so under GitHub Actions this digest is appended to
 * the job summary automatically (forced display point, wired in cli.mjs).
 *
 * Trust boundary (inherited from result-store): the run store is writable by
 * the agent under review and is NOT tamper-evident. Every number here is a
 * convenience reference, and override entries are always labeled UNVERIFIED.
 *
 * Escape candidates are deliberately NOT a rate (adversarial review
 * Blocker 2): fingerprints derive from LLM-generated messages (phrasing
 * drift), and a later run's finding may have been introduced by the later
 * diff rather than missed by the earlier one. Attribution is a human
 * judgment; threshold/automated decisions on this list are forbidden by
 * contract (see loop-convergence-contract).
 *
 * Pure functions — no I/O; the caller supplies records and `now`.
 */



const GO_FAMILY = new Set(['GO', 'GO_WITH_OBSERVATION']);
const DEFAULT_FALLBACK_STREAK_THRESHOLD = 3;

/**
 * @param {Array<object>} records - run records, any order (sorted internally by timestamp)
 * @param {object} [opts]
 * @param {() => Date} [opts.now]
 * @param {number} [opts.fallbackStreakThreshold]
 * @returns {object} digest structure (see fields below)
 */
function buildRunsDigest(records, { now = () => new Date(), ...opts } = {}) {
  const fallbackStreakThreshold = opts.fallbackStreakThreshold ?? DEFAULT_FALLBACK_STREAK_THRESHOLD;
  const sorted = [...(records ?? [])]
    .filter((r) => r && typeof r === 'object')
    .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')));

  const withGate = sorted.filter((r) => r.gate && typeof r.gate === 'object');

  // --- gate decision distribution / auto-GO share -------------------------
  const decisions = {};
  const escalateReasons = {};
  for (const r of withGate) {
    decisions[r.gate.decision] = (decisions[r.gate.decision] ?? 0) + 1;
    if (r.gate.decision === 'ESCALATE') {
      escalateReasons[r.gate.reasonCode] = (escalateReasons[r.gate.reasonCode] ?? 0) + 1;
    }
  }
  const goCount = (decisions.GO ?? 0) + (decisions.GO_WITH_OBSERVATION ?? 0);
  const autoGoShare = withGate.length > 0 ? goCount / withGate.length : null;

  // --- warnings ------------------------------------------------------------
  const warnings = [];

  // regex-fallback streak: a persistently failing adjudicator means the LOW
  // tier is silently disabled (S1/#1357 stderr warning is per-run; the digest
  // is where the STREAK becomes visible).
  let streak = 0;
  let maxStreak = 0;
  for (const r of withGate) {
    if (r.gate.inputs?.humanApprovalMode === 'regex-fallback') {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  }
  if (maxStreak >= fallbackStreakThreshold) {
    warnings.push({
      kind: 'regex-fallback-streak',
      message:
        `LLM adjudicator failed on ${maxStreak} consecutive runs — the LOW-confidence ` +
        'escalation tier is effectively disabled. Check API keys / endpoint health.',
    });
  }

  // circuit-breaker advisory: consecutive auto-GO runs vs the recorded limit.
  // The digest WARNS only — enforcement is host responsibility (S4).
  let goStreak = 0;
  let maxGoStreak = 0;
  let breakerLimit = null;
  for (const r of withGate) {
    if (GO_FAMILY.has(r.gate.decision)) {
      goStreak += 1;
      maxGoStreak = Math.max(maxGoStreak, goStreak);
      breakerLimit = r.gate.configSnapshot?.maxConsecutiveAutoGo ?? breakerLimit;
    } else {
      goStreak = 0;
    }
  }
  if (breakerLimit != null && maxGoStreak > breakerLimit) {
    warnings.push({
      kind: 'circuit-breaker-exceeded',
      message:
        `${maxGoStreak} consecutive auto-GO runs exceed the advisory circuit-breaker ` +
        `limit (${breakerLimit}). A human checkpoint is overdue — enforcement is the ` +
        'host loop’s responsibility.',
    });
  }

  // --- observation expiry candidates ---------------------------------------
  const nowMs = now().getTime();
  const expiredObservations = withGate
    .filter((r) => r.gate.decision === 'GO_WITH_OBSERVATION' && r.gate.observation)
    .map((r) => {
      const started = Date.parse(r.timestamp ?? '');
      const hours = r.gate.observation.expiresInHours;
      if (!Number.isFinite(started) || !Number.isFinite(hours)) return null;
      const ageHours = (nowMs - started) / 3_600_000;
      return ageHours > hours
        ? { runId: r.runId, ageHours: Math.round(ageHours), expiresInHours: hours }
        : null;
    })
    .filter(Boolean);
  if (expiredObservations.length > 0) {
    warnings.push({
      kind: 'observation-expired',
      message:
        `${expiredObservations.length} GO_WITH_OBSERVATION run(s) exceeded their review ` +
        'window — per contract, their changes count as UNREVIEWED (re-review required).',
    });
  }

  // --- escape candidates (reference list, NOT a rate) ----------------------
  const escapeCandidates = [];
  for (let i = 0; i < withGate.length; i++) {
    const x = withGate[i];
    if (!GO_FAMILY.has(x.gate.decision)) continue;
    const xFiles = new Set(x.changedFiles ?? []);
    const xPrints = new Set((x.findings ?? []).map((f) => f.fingerprint ?? (0,_finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__/* .computeFingerprint */ .Yo)(f)));
    for (let j = i + 1; j < withGate.length; j++) {
      const y = withGate[j];
      const overlap = (y.changedFiles ?? []).filter((f) => xFiles.has(f));
      if (overlap.length === 0) continue;
      const newBlocking = (y.findings ?? []).filter(
        (f) =>
          f != null &&
          (f.severity === 'critical' || f.severity === 'major') &&
          !xPrints.has(f.fingerprint ?? (0,_finding_factory_mjs__WEBPACK_IMPORTED_MODULE_0__/* .computeFingerprint */ .Yo)(f))
      );
      if (newBlocking.length > 0) {
        escapeCandidates.push({
          goRunId: x.runId,
          laterRunId: y.runId,
          overlappingFiles: overlap.slice(0, 5),
          newBlockingFindings: newBlocking.slice(0, 3).map((f) => f.title ?? f.ruleId),
        });
        break; // one candidate entry per GO run is enough for triage
      }
    }
  }

  // --- overrides (host-attested, always unverified) -------------------------
  const overrides = sorted
    .filter((r) => r.override && typeof r.override === 'object')
    .map((r) => ({
      runId: r.runId,
      actor: r.override.actor ?? null,
      timestamp: r.override.timestamp ?? null,
      gateInputsHashMatch:
        r.override.gateInputsHash != null && r.gate?.inputsHash != null
          ? r.override.gateInputsHash === r.gate.inputsHash
          : null,
    }));
  for (const o of overrides) {
    if (o.gateInputsHashMatch === false) {
      warnings.push({
        kind: 'override-hash-mismatch',
        message: `Override on run ${o.runId} references a gateInputsHash that does not match the recorded gate — investigate.`,
      });
    }
  }

  return {
    totalRuns: sorted.length,
    runsWithGate: withGate.length,
    decisions,
    autoGoShare,
    escalateReasons,
    warnings,
    expiredObservations,
    escapeCandidates,
    overrides,
  };
}

/**
 * Render the digest as GitHub-flavored markdown (job summary / --output markdown).
 * @param {ReturnType<typeof buildRunsDigest>} digest
 * @returns {string}
 */
function formatDigestMarkdown(digest) {
  const lines = ['## River Review — runs digest', ''];
  lines.push(
    `Runs: ${digest.totalRuns} (${digest.runsWithGate} with gate) — ` +
      `auto-GO share: ${digest.autoGoShare == null ? 'n/a' : `${Math.round(digest.autoGoShare * 100)}%`}`
  );
  const dist = Object.entries(digest.decisions)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  if (dist) lines.push(`Decisions: ${dist}`);
  const esc = Object.entries(digest.escalateReasons)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  if (esc) lines.push(`ESCALATE reasons: ${esc}`);

  if (digest.warnings.length > 0) {
    lines.push('', '### ⚠ Warnings');
    for (const w of digest.warnings) lines.push(`- **${w.kind}**: ${w.message}`);
  }

  if (digest.escapeCandidates.length > 0) {
    lines.push(
      '',
      '### Escape candidates (reference only — NOT a rate)',
      '',
      '> Attribution is a human judgment: fingerprints drift with LLM phrasing, and a',
      '> later finding may come from the later diff. Threshold/automated decisions on',
      '> this list are forbidden by contract.',
      ''
    );
    for (const e of digest.escapeCandidates) {
      lines.push(
        `- GO run \`${e.goRunId}\` → later run \`${e.laterRunId}\` added blocking finding(s) ` +
          `on overlapping files (${e.overlappingFiles.join(', ')}): ${e.newBlockingFindings.join('; ')}`
      );
    }
  }

  if (digest.overrides.length > 0) {
    lines.push('', '### Overrides (host-attested — UNVERIFIED)');
    for (const o of digest.overrides) {
      const hash =
        o.gateInputsHashMatch === true
          ? 'hash ok'
          : o.gateInputsHashMatch === false
            ? 'HASH MISMATCH'
            : 'no hash';
      lines.push(
        `- run \`${o.runId}\` by ${o.actor ?? 'unknown'} at ${o.timestamp ?? '?'} (${hash})`
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}


/***/ })

};

//# sourceMappingURL=518.index.mjs.map