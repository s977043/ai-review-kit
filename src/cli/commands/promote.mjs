// `river promote` subcommand handler (Judgment Promotion Loop Phase 2,
// #1568-B / #1622).
//
// Turns Phase 1 promotion_candidate entries into human-approved, PR-ready
// scaffolds. Generation (Phase 1) and approval (this command) stay separated:
// `promote` never creates candidates — it only lists, decides on, and scaffolds
// existing ones.
//
// Subcommands:
//   river promote list                 List promotion candidates
//   river promote approve <id>         Approve a candidate (promotionStatus -> approved)
//   river promote reject  <id>         Reject a candidate  (promotionStatus -> archived)
//   river promote template [<id>]      Emit PR scaffold(s) for approved candidate(s)
//   river promote retire               Archive expired candidates + sync promotionStatus (Phase 3)
//   river promote review-effectiveness Flag needs_review on negative post-activation feedback (Phase 3)
//
// The approval decision records who/when (context.approval) for auditability.
// `now` is injected via RIVER_NOW (ISO string) so tests can pin it.
import path from 'node:path';
import process from 'node:process';
import { ensureGitRepo } from '../../lib/git.mjs';
import { loadMemory } from '../../lib/riverbed-memory.mjs';
import { listFeedbackEntries } from '../../lib/feedback.mjs';
import {
  listPromotionCandidates,
  decidePromotion,
  buildPrScaffold,
  getPromotionCandidate,
  retirePromotions,
  reviewPromotionEffectiveness,
  DEFAULT_EFFECTIVENESS_THRESHOLD,
} from '../../lib/promotion.mjs';

/** Resolve `now` from RIVER_NOW (external injection) or fall back to real time. */
function resolveNow() {
  const raw = process.env.RIVER_NOW;
  if (!raw) return new Date();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`RIVER_NOW is not a valid date: ${raw}`);
  }
  return parsed;
}

/** Resolve the Riverbed index path: explicit --index, else the repo's .river/memory. */
async function resolveIndexPath(parsed, targetPath) {
  if (parsed.promoteIndex) {
    return path.resolve(process.cwd(), parsed.promoteIndex);
  }
  const repoRoot = await ensureGitRepo(targetPath);
  return path.resolve(repoRoot, '.river', 'memory', 'index.json');
}

function printCandidate(entry) {
  const pc = getPromotionCandidate(entry);
  console.log(`- ${entry.id}`);
  console.log(`    clusterKey:       ${pc.clusterKey}`);
  console.log(`    recurrenceCount:  ${pc.recurrenceCount}`);
  console.log(`    promotionStatus:  ${pc.promotionStatus}`);
  console.log(
    `    proposedTarget:   ${pc.proposedTarget?.kind}${pc.proposedTarget?.id ? ` (${pc.proposedTarget.id})` : ''}`
  );
  console.log(
    `    scope.paths:      ${pc.scope?.paths?.length ? pc.scope.paths.join(', ') : '(none)'}`
  );
  console.log(`    expiresAt:        ${entry.expiresAt ?? '(none)'}`);
  console.log(`    rationale:        ${pc.rationale}`);
}

function printScaffold(scaffold) {
  console.log(`# ${scaffold.id} (${scaffold.clusterKey})`);
  if (!scaffold.eligible) {
    console.log(`  skipped: ${scaffold.note}`);
    return;
  }
  if (scaffold.requiresPlanGate) {
    console.log(`  PlanGate: ${scaffold.note}`);
  } else if (scaffold.note) {
    console.log(`  note: ${scaffold.note}`);
  }
  if (scaffold.branchName) console.log(`  branch: ${scaffold.branchName}`);
  if (scaffold.prTitle) console.log(`  title:  ${scaffold.prTitle}`);
  if (scaffold.targetPaths.length) console.log(`  paths:  ${scaffold.targetPaths.join(', ')}`);
  if (scaffold.prBody) {
    console.log('  --- body ---');
    for (const line of scaffold.prBody.split('\n')) console.log(`  ${line}`);
    console.log('  --- end body ---');
  }
}

/**
 * Handle the `promote` command.
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @param {string} targetPath - resolved repo target path.
 * @returns {Promise<number>} process exit code.
 */
export async function runPromoteCommand(parsed, targetPath) {
  const sub = parsed.promoteSubcommand;
  if (!['list', 'approve', 'reject', 'template', 'retire', 'review-effectiveness'].includes(sub)) {
    console.error(
      'Error: usage: river promote <list|approve <id>|reject <id>|template [<id>]|retire|review-effectiveness [<id>]> [--approver <name>] [--reason <text>] [--index <path>] [--threshold <n>] [--feedback-root <path>] [--output json] [--include-inactive].'
    );
    return 1;
  }

  const indexPath = await resolveIndexPath(parsed, targetPath);
  const now = resolveNow();

  if (sub === 'list') {
    const index = loadMemory(indexPath);
    const candidates = listPromotionCandidates(index, {
      includeInactive: Boolean(parsed.promoteIncludeInactive),
    });
    if (parsed.output === 'json') {
      console.log(JSON.stringify({ count: candidates.length, candidates }, null, 2));
      return 0;
    }
    if (!candidates.length) {
      console.log('No promotion candidates found.');
      return 0;
    }
    console.log(`Promotion candidates (${candidates.length}):\n`);
    for (const entry of candidates) printCandidate(entry);
    return 0;
  }

  if (sub === 'approve' || sub === 'reject') {
    if (!parsed.promoteId) {
      console.error(`Error: river promote ${sub} requires a candidate <id>.`);
      return 1;
    }
    const decision = sub === 'approve' ? 'approved' : 'rejected';
    const approver =
      parsed.promoteApprover ||
      process.env.RIVER_APPROVER ||
      process.env.USER ||
      process.env.USERNAME || // Windows
      'unknown';
    let result;
    try {
      result = decidePromotion({
        indexPath,
        id: parsed.promoteId,
        decision,
        approver,
        reason: parsed.promoteReason ?? null,
        now,
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    const pc = getPromotionCandidate(result.entry);
    if (!result.changed) {
      console.log(`Candidate ${result.entry.id} already ${decision} (no change).`);
      return 0;
    }
    if (result.warning) {
      console.warn(`Warning: ${result.warning}`);
    }
    console.log(`Candidate ${result.entry.id} ${decision}.`);
    console.log(`  promotionStatus: ${pc.promotionStatus}`);
    console.log(`  approver: ${approver}`);
    console.log(`  decidedAt: ${result.entry.context.approval.decidedAt}`);
    // Rejecting a candidate that was previously approved invalidates any PR
    // scaffold already generated from it; make the orphaning explicit.
    if (decision === 'rejected' && result.previousDecision === 'approved') {
      console.log(
        '  note: any PR scaffold previously generated for this candidate is now invalid (regenerate after a fresh approval).'
      );
    }
    console.log(`  written to: ${indexPath}`);
    return 0;
  }

  if (sub === 'retire') {
    const out = retirePromotions({ indexPath, now });
    if (parsed.output === 'json') {
      console.log(JSON.stringify(out, null, 2));
      return 0;
    }
    if (!out.count) {
      console.log('No promotion candidates to retire.');
      return 0;
    }
    console.log(`Retired ${out.count} promotion candidate(s):`);
    for (const r of out.results) {
      const parts = [];
      if (r.willExpire) parts.push('expired (entry archived)');
      if (r.statusSync) parts.push(`promotionStatus ${r.statusSync.from} -> ${r.statusSync.to}`);
      console.log(`- ${r.id}: ${parts.join('; ')}`);
    }
    console.log(`  written to: ${indexPath}`);
    return 0;
  }

  if (sub === 'review-effectiveness') {
    const feedbackRoot = parsed.promoteFeedbackRoot
      ? path.resolve(process.cwd(), parsed.promoteFeedbackRoot)
      : await ensureGitRepo(targetPath);
    const feedbackEntries = await listFeedbackEntries({
      repoRoot: feedbackRoot,
      warn: (msg) => console.warn(msg),
    });
    const threshold = parsed.promoteThreshold ?? DEFAULT_EFFECTIVENESS_THRESHOLD;
    let out;
    try {
      out = reviewPromotionEffectiveness({
        indexPath,
        feedbackEntries,
        now,
        threshold,
        reviewer: parsed.promoteApprover ?? null,
        id: parsed.promoteId ?? null,
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    if (parsed.output === 'json') {
      console.log(JSON.stringify({ threshold, ...out }, null, 2));
      return 0;
    }
    if (!out.count) {
      console.log('No promotion candidates to review.');
      return 0;
    }
    console.log(`Reviewed ${out.count} promotion candidate(s) (threshold ${threshold}):`);
    for (const r of out.results) {
      const m = r.metrics;
      const summary = `negative=${m.negativeCount} (falsePositive=${m.falsePositiveCount}, reversal=${m.reversalCount}), related=${m.related}`;
      if (r.changed) {
        console.log(`- ${r.id}: FLAGGED needs_review — ${summary}`);
      } else if (!r.eligible) {
        console.log(`- ${r.id}: skipped — ${r.note}`);
      } else {
        console.log(`- ${r.id}: retained — ${summary}`);
      }
    }
    if (out.flagged) console.log(`  written to: ${indexPath}`);
    return 0;
  }

  // template
  const index = loadMemory(indexPath);
  let entries;
  if (parsed.promoteId) {
    const entry = listPromotionCandidates(index, { includeInactive: true }).find(
      (e) => e.id === parsed.promoteId
    );
    if (!entry) {
      console.error(`Error: No promotion_candidate entry with id: ${parsed.promoteId}`);
      return 1;
    }
    entries = [entry];
  } else {
    // Only approved candidates get scaffolds; rejected (archived) ones are excluded.
    entries = listPromotionCandidates(index).filter(
      (e) => getPromotionCandidate(e)?.promotionStatus === 'approved'
    );
  }

  const scaffolds = entries.map((e) => buildPrScaffold(e));
  if (parsed.output === 'json') {
    console.log(JSON.stringify({ count: scaffolds.length, scaffolds }, null, 2));
    return 0;
  }
  if (!scaffolds.length) {
    console.log('No approved promotion candidates to scaffold.');
    return 0;
  }
  for (const scaffold of scaffolds) printScaffold(scaffold);
  return 0;
}
