#!/usr/bin/env node
// Suppression pattern analytics (L4 in
// docs/development/skill-improvement-loop-design.md §3).
//
// Scans Riverbed Memory suppression entries and flags patterns that signal
// "this needs a skill fix, not another suppression":
// - the same fingerprint suppressed across N+ distinct PRs (default 3)
// - active major/critical suppressions older than N days (default 14)
// The output feeds the skill-optimizer diagnosis as-is; this script only
// detects and reports — it never edits memory or skills.
//
// Usage: node scripts/suppression-analytics.mjs [--index <path>] [--issue-body] [--json]
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

import { isSuppressionExpired } from '../src/lib/suppression.mjs';

import { isDirectRun } from './lib/is-direct-run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INDEX = path.join(repoRoot, '.river', 'memory', 'index.json');

export const THRESHOLDS = {
  repeatPrCount: 3,
  staleHighSeverityDays: 14,
};

/**
 * Whether a memory entry is a suppression that is still in effect at `now`.
 *
 * The expiry decision is delegated to `isSuppressionExpired`
 * (`src/lib/suppression.mjs`), the single definition of the rule that the
 * review path (`findActiveSuppressions`) also uses. This script previously
 * compared `new Date(expiresAt).getTime() <= now.getTime()` itself, which
 * answered `false` for an unparseable value (`NaN <= now` is `false`) and so
 * counted an entry as ACTIVE that the review path treats as expired — the
 * report and the actual review behaviour disagreed (#1764).
 *
 * @param {object} entry Riverbed Memory entry
 * @param {Date} now
 * @returns {boolean}
 */
function isActiveSuppression(entry, now) {
  if (entry?.type !== 'suppression') return false;
  if (entry?.context?.active === false) return false;
  if (isSuppressionExpired(entry, now)) return false;
  return true;
}

/**
 * Pure analysis over memory entries.
 *
 * @param {Array<object>} entries Riverbed Memory entries
 * @param {{ now?: Date, thresholds?: typeof THRESHOLDS }} [options]
 * @returns {{ active: number, repeatedFingerprints: Array, staleHighSeverity: Array }}
 */
export function analyzeSuppressions(entries, { now = new Date(), thresholds = THRESHOLDS } = {}) {
  const active = entries.filter((e) => isActiveSuppression(e, now));

  const byFingerprint = new Map();
  for (const entry of active) {
    const fp = entry.context?.fingerprint;
    if (!fp) continue;
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, []);
    byFingerprint.get(fp).push(entry);
  }
  const repeatedFingerprints = [];
  for (const [fingerprint, group] of byFingerprint) {
    const prs = new Set(group.map((e) => e.context?.sourcePR).filter(Boolean));
    if (prs.size >= thresholds.repeatPrCount) {
      repeatedFingerprints.push({
        fingerprint,
        prCount: prs.size,
        prs: [...prs].sort((a, b) => a - b),
        severities: [...new Set(group.map((e) => e.context?.severity).filter(Boolean))],
      });
    }
  }

  const staleMs = thresholds.staleHighSeverityDays * 24 * 60 * 60 * 1000;
  const staleHighSeverity = active
    .filter((e) => ['major', 'critical'].includes(e.context?.severity))
    .filter((e) => e.createdAt && now.getTime() - new Date(e.createdAt).getTime() >= staleMs)
    .map((e) => ({
      id: e.id,
      fingerprint: e.context?.fingerprint ?? null,
      severity: e.context.severity,
      createdAt: e.createdAt,
      ageDays: Math.floor(
        (now.getTime() - new Date(e.createdAt).getTime()) / (24 * 60 * 60 * 1000)
      ),
      rationale: e.context?.rationale ?? e.summary ?? null,
    }));

  return { active: active.length, repeatedFingerprints, staleHighSeverity };
}

export function formatIssueBody(result) {
  const lines = [
    '## Suppression pattern analytics（skill 改善の診断推奨）',
    '',
    `アクティブな suppression: ${result.active} 件`,
    '',
  ];
  if (result.repeatedFingerprints.length) {
    lines.push(`### 反復 suppress（${THRESHOLDS.repeatPrCount} PR 以上で同一 fingerprint）`, '');
    for (const r of result.repeatedFingerprints) {
      lines.push(
        `- \`${r.fingerprint}\` — ${r.prCount} PRs (${r.prs.map((p) => `#${p}`).join(', ')})` +
          (r.severities.length ? ` / severity: ${r.severities.join(', ')}` : '')
      );
    }
    lines.push('');
  }
  if (result.staleHighSeverity.length) {
    lines.push(
      `### 長期滞留している major / critical suppression（${THRESHOLDS.staleHighSeverityDays} 日以上）`,
      ''
    );
    for (const s of result.staleHighSeverity) {
      lines.push(`- \`${s.fingerprint ?? s.id}\` — ${s.severity}, ${s.ageDays} 日経過`);
    }
    lines.push('');
  }
  lines.push(
    '次のアクション: 該当 skill に対して skill-optimizer の診断を実行し、suppression の恒久化ではなく skill 本体の改善（fixture 追加・gate 修正）を検討してください。'
  );
  return lines.join('\n');
}

export async function runSuppressionAnalytics({
  indexPath = DEFAULT_INDEX,
  now = new Date(),
  log = console.log,
} = {}) {
  let raw;
  try {
    raw = await fs.readFile(indexPath, 'utf8');
  } catch {
    log(`No memory index found at ${indexPath}; nothing to analyze.`);
    return { active: 0, repeatedFingerprints: [], staleHighSeverity: [] };
  }
  let index;
  try {
    index = JSON.parse(raw);
  } catch (err) {
    log(`Memory index at ${indexPath} is not valid JSON (${err.message}); nothing to analyze.`);
    return { active: 0, repeatedFingerprints: [], staleHighSeverity: [] };
  }
  const entries = Array.isArray(index?.entries) ? index.entries : [];
  return analyzeSuppressions(entries, { now });
}

if (isDirectRun(import.meta.url)) {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--index');
  if (idx >= 0 && !args[idx + 1]) {
    console.error('Error: --index requires a path argument.');
    process.exit(2);
  }
  const indexPath = idx >= 0 ? path.resolve(args[idx + 1]) : DEFAULT_INDEX;
  const result = await runSuppressionAnalytics({ indexPath });
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (args.includes('--issue-body')) {
    console.log(formatIssueBody(result));
  } else {
    console.log(`active suppressions: ${result.active}`);
    console.log(
      `repeated fingerprints (>=${THRESHOLDS.repeatPrCount} PRs): ${result.repeatedFingerprints.length}`
    );
    console.log(
      `stale major/critical (>=${THRESHOLDS.staleHighSeverityDays}d): ${result.staleHighSeverity.length}`
    );
    if (result.repeatedFingerprints.length || result.staleHighSeverity.length) {
      console.log('\nRun with --issue-body to generate a diagnosis-request issue body.');
      process.exitCode = 2;
    }
  }
}
