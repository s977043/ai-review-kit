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

import { computeFingerprint } from './finding-factory.mjs';

const GO_FAMILY = new Set(['GO', 'GO_WITH_OBSERVATION']);
const DEFAULT_FALLBACK_STREAK_THRESHOLD = 3;
// m3 (#1372 review): the store grows unbounded under CI auto-save and the
// escape scan is O(n²); cap the digest window to the most recent runs.
const MAX_DIGEST_RECORDS = 100;

/**
 * @param {Array<object>} records - run records, any order (sorted internally by timestamp)
 * @param {object} [opts]
 * @param {() => Date} [opts.now]
 * @param {number} [opts.fallbackStreakThreshold]
 * @returns {object} digest structure (see fields below)
 */
export function buildRunsDigest(records, { now = () => new Date(), ...opts } = {}) {
  const fallbackStreakThreshold = opts.fallbackStreakThreshold ?? DEFAULT_FALLBACK_STREAK_THRESHOLD;
  const sorted = [...(records ?? [])]
    .filter((r) => r && typeof r === 'object')
    .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')))
    .slice(-MAX_DIGEST_RECORDS);

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
  // is where the STREAK becomes visible). M2 (#1372 review): judged on the
  // TRAILING (currently ongoing) streak so a long-resolved incident does not
  // cry wolf forever. Note: run-path records always carry
  // humanApprovalMode=null (no plan-text scan on `river run`), so this
  // warning can only fire for review-namespace records.
  let trailingFallback = 0;
  for (let i = withGate.length - 1; i >= 0; i--) {
    if (withGate[i].gate.inputs?.humanApprovalMode === 'regex-fallback') trailingFallback += 1;
    else break;
  }
  if (trailingFallback >= fallbackStreakThreshold) {
    warnings.push({
      kind: 'regex-fallback-streak',
      message:
        `LLM adjudicator failed on the last ${trailingFallback} consecutive runs — the ` +
        'LOW-confidence escalation tier is currently disabled. Check API keys / endpoint health.',
    });
  }

  // circuit-breaker advisory: consecutive auto-GO runs vs the recorded limit.
  // The digest WARNS only — enforcement is host responsibility (S4).
  // M2 (#1372 review): trailing streak only — a past streak that already hit
  // an ESCALATE/NO_GO checkpoint must not warn forever.
  let trailingGo = 0;
  let breakerLimit = null;
  for (let i = withGate.length - 1; i >= 0; i--) {
    if (GO_FAMILY.has(withGate[i].gate.decision)) {
      trailingGo += 1;
      breakerLimit = breakerLimit ?? withGate[i].gate.configSnapshot?.maxConsecutiveAutoGo ?? null;
    } else {
      break;
    }
  }
  if (breakerLimit != null && trailingGo > breakerLimit) {
    warnings.push({
      kind: 'circuit-breaker-exceeded',
      message:
        `The last ${trailingGo} consecutive runs were auto-GO, exceeding the advisory ` +
        `circuit-breaker limit (${breakerLimit}). A human checkpoint is overdue — ` +
        'enforcement is the host loop’s responsibility.',
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
    const xPrints = new Set((x.findings ?? []).map((f) => f.fingerprint ?? computeFingerprint(f)));
    for (let j = i + 1; j < withGate.length; j++) {
      const y = withGate[j];
      const overlap = (y.changedFiles ?? []).filter((f) => xFiles.has(f));
      if (overlap.length === 0) continue;
      const newBlocking = (y.findings ?? []).filter(
        (f) =>
          f != null &&
          (f.severity === 'critical' || f.severity === 'major') &&
          !xPrints.has(f.fingerprint ?? computeFingerprint(f))
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
/** Strip markdown-significant characters from untrusted display strings (m2). */
function sanitizeInline(value) {
  return String(value ?? '')
    .replace(/[\r\n|#>`*_[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function formatDigestMarkdown(digest) {
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
          `on overlapping files (${e.overlappingFiles.map(sanitizeInline).join(', ')}): ${e.newBlockingFindings.map(sanitizeInline).join('; ')}`
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
