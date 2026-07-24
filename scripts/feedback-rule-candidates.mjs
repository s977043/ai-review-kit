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
// The builders themselves now live in src/lib/promotion-candidates.mjs
// (#1624 / #1574 P0 contract 4): this file is the detection CLI plus a
// backward-compatible re-export surface for existing importers.
//
// Usage: node scripts/feedback-rule-candidates.mjs [--min <n>] [--month YYYY-MM] [--json] [--out <path>]
import path from 'path';
import { fileURLToPath } from 'url';
import { listFeedbackEntries } from '../src/lib/feedback.mjs';
import { appendEntry } from '../src/lib/riverbed-memory.mjs';
import {
  DEFAULT_EXPIRY_DAYS,
  buildCandidatesArtifact,
  buildPromotionCandidate,
  buildPromotionCandidateEntry,
  buildPromotionCandidates,
  findRuleCandidates,
  writeCandidatesArtifact,
} from '../src/lib/promotion-candidates.mjs';
import { isDirectRun } from './lib/is-direct-run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Re-exported so existing importers of this script keep working after the
// move to src/lib/promotion-candidates.mjs.
export {
  DEFAULT_EXPIRY_DAYS,
  buildCandidatesArtifact,
  buildPromotionCandidate,
  buildPromotionCandidateEntry,
  buildPromotionCandidates,
  findRuleCandidates,
  writeCandidatesArtifact,
};

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
  const promoteIdx = args.indexOf('--promote');
  let promotePath = null;
  if (promoteIdx >= 0) {
    promotePath = args[promoteIdx + 1];
    if (!promotePath || promotePath.startsWith('--')) {
      console.error('Error: --promote requires a Riverbed index.json path.');
      process.exit(2);
    }
  }
  const entries = await listFeedbackEntries({ repoRoot, month, warn: (m) => console.warn(m) });
  const candidates = findRuleCandidates(entries, { min });
  // --promote writes structured promotion_candidate entries into a Riverbed
  // index. Generation only: entries land with promotionStatus=candidate; the
  // approval transition and shared-asset promotion stay a separate human step
  // (#1568-B). Duplicate ids (same clusterKey already recorded today) are
  // skipped, not fatal.
  //
  // Deprecated in favor of `river promote propose` (#1624): this path still
  // mints date-based ids, so re-running on another day duplicates a candidate
  // for the same evidence. Kept until the next minor for existing callers.
  if (promotePath) {
    console.warn(
      'Warning: --promote is deprecated (date-based candidate ids are not idempotent). ' +
        'Use `river promote propose --input <jsonl> --cluster-key <skillId::feedbackType>` instead.'
    );
    const promotionEntries = buildPromotionCandidates(entries, { min });
    let written = 0;
    let skipped = 0;
    for (const entry of promotionEntries) {
      try {
        appendEntry(path.resolve(promotePath), entry);
        written += 1;
      } catch (err) {
        if (/Duplicate entry ID/.test(err.message)) {
          skipped += 1;
        } else {
          console.error(
            `Error: Failed to write promotion candidate to ${promotePath}: ${err.message}`
          );
          process.exit(1);
        }
      }
    }
    console.log(
      `Promotion candidates written to ${promotePath}: ${written} new, ${skipped} skipped (duplicate).`
    );
  }
  // --out writes a structured artifact alongside whichever stdout mode below
  // runs; it does not change stdout content or the exit-code-2-on-candidates
  // behavior (kept for backward compatibility with existing CI usage).
  if (outPath) {
    try {
      await writeCandidatesArtifact(
        path.resolve(outPath),
        buildCandidatesArtifact({ entriesCount: entries.length, min, candidates })
      );
    } catch (err) {
      console.error(`Error: Failed to write artifact to ${outPath}: ${err.message}`);
      process.exit(1);
    }
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
