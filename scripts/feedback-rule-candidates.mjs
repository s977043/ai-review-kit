#!/usr/bin/env node
// Rule-promotion candidate detection (L6 in
// docs/development/skill-improvement-loop-design.md §3, automating
// IMPROVEMENT_LOOP.md Step 9: "same class of problem twice or more").
//
// Groups captured feedback entries (.river/feedback/*.jsonl) by
// (skillId, feedbackType) and reports classes that recurred N+ times
// (default 2) as candidates for codification — a guard fixture, a SKILL.md
// gate fix, or a project rule. Detection only; codification stays a human
// decision via the improvement flow.
//
// Usage: node scripts/feedback-rule-candidates.mjs [--min <n>] [--month YYYY-MM] [--json] [--out <path>]
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listFeedbackEntries } from '../src/lib/feedback.mjs';
import { isDirectRun } from './lib/is-direct-run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SUGGESTED_ACTION = {
  false_positive: 'guard fixture を追加し、skill の False-positive guards を強化する',
  missed_issue: 'happy-path fixture を追加し、skill の Rule / Heuristics を拡張する',
  not_actionable: 'SKILL.md の出力契約（Fix の具体性）を見直す',
  unclear: 'SKILL.md の文言・出力例を改善する',
  duplicate: 'routing（owner skill）を明確化する',
  accepted_risk: '繰り返し許容しているリスクをプロジェクトルール（.river/rules.md）へ昇格する',
  accepted: null,
};

/**
 * Pure grouping: (skillId, feedbackType) classes with count >= min.
 *
 * @param {Array<{skillId?: string, feedbackType?: string, pr?: number}>} entries
 * @param {{ min?: number }} [options]
 */
export function findRuleCandidates(entries, { min = 2 } = {}) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry?.skillId || !entry?.feedbackType) continue;
    if (entry.feedbackType === 'accepted') continue; // positive signal, nothing to codify
    const key = `${entry.skillId}::${entry.feedbackType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const candidates = [];
  for (const [key, group] of groups) {
    if (group.length < min) continue;
    const [skillId, feedbackType] = key.split('::');
    candidates.push({
      skillId,
      feedbackType,
      count: group.length,
      prs: [...new Set(group.map((e) => e.pr).filter(Boolean))].sort((a, b) => a - b),
      suggestedAction: SUGGESTED_ACTION[feedbackType] ?? '改善フローで対応先を判断する',
    });
  }
  candidates.sort((a, b) => b.count - a.count);
  return candidates;
}

/**
 * Build the structured artifact payload written by `--out`.
 *
 * Minimal shape: metadata plus the same per-candidate fields already used by
 * `--json` stdout (`{skillId, feedbackType, count, prs, suggestedAction}`), so
 * a future CI artifact / improvement-flow consumer has one contract to read
 * regardless of which output mode produced it.
 *
 * @param {{ entriesCount: number, min: number, candidates: ReturnType<typeof findRuleCandidates>, now?: Date }} options
 */
export function buildCandidatesArtifact({ entriesCount, min, candidates, now = new Date() }) {
  return {
    generatedAt: now.toISOString(),
    threshold: min,
    entries: entriesCount,
    candidates,
  };
}

/**
 * Write the artifact payload to `outPath` as pretty-printed JSON, creating
 * parent directories as needed. Pure I/O helper kept separate from
 * `buildCandidatesArtifact` so tests can validate the JSON shape without
 * touching the filesystem.
 *
 * @param {string} outPath
 * @param {ReturnType<typeof buildCandidatesArtifact>} payload
 */
export async function writeCandidatesArtifact(outPath, payload) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

if (isDirectRun(import.meta.url)) {
  const args = process.argv.slice(2);
  const minIdx = args.indexOf('--min');
  let min = 2;
  if (minIdx >= 0) {
    const parsed = parseInt(args[minIdx + 1] ?? '', 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      console.error('Error: --min requires a positive integer.');
      process.exit(2);
    }
    min = parsed;
  }
  const monthIdx = args.indexOf('--month');
  const month = monthIdx >= 0 ? args[monthIdx + 1] : null;
  const outIdx = args.indexOf('--out');
  let outPath = null;
  if (outIdx >= 0) {
    outPath = args[outIdx + 1];
    if (!outPath || outPath.startsWith('--')) {
      console.error('Error: --out requires a file path.');
      process.exit(2);
    }
  }
  const entries = await listFeedbackEntries({ repoRoot, month, warn: (m) => console.warn(m) });
  const candidates = findRuleCandidates(entries, { min });
  // --out writes a structured artifact alongside whichever stdout mode below
  // runs; it does not change stdout content or the exit-code-2-on-candidates
  // behavior (kept for backward compatibility with existing CI usage).
  if (outPath) {
    await writeCandidatesArtifact(
      path.resolve(outPath),
      buildCandidatesArtifact({ entriesCount: entries.length, min, candidates })
    );
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify({ entries: entries.length, candidates }, null, 2));
  } else if (!candidates.length) {
    console.log(`No rule-promotion candidates (entries: ${entries.length}, threshold: ${min}).`);
  } else {
    console.log(`Rule-promotion candidates (threshold: ${min}):\n`);
    for (const c of candidates) {
      const prs = c.prs.length ? ` (PRs: ${c.prs.map((p) => `#${p}`).join(', ')})` : '';
      console.log(`- ${c.skillId} × ${c.feedbackType}: ${c.count} 回${prs}`);
      console.log(`  → ${c.suggestedAction}`);
    }
    console.log(
      '\n次のアクション: docs/development/improvement-flow.md の手順で codify してください。'
    );
    process.exitCode = 2;
  }
}
