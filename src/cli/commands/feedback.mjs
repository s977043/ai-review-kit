// `river feedback` subcommand handler.
//
// Extracted verbatim from src/cli.mjs main() as part of the CLI dispatch
// refactor (split main() into per-subcommand handlers). Behavior, messages,
// and exit codes are unchanged; only the enclosing function and the relative
// import depth differ from the original inline block.
import { ensureGitRepo } from '../../lib/git.mjs';

/**
 * Handle the `feedback` command (feedback add).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @param {string} targetPath - resolved repo target path.
 * @returns {Promise<number>} process exit code.
 */
export async function runFeedbackCommand(parsed, targetPath) {
  if (parsed.feedbackSubcommand !== 'add') {
    console.error(
      'Error: only `river feedback add` is supported (need: --type --skill; optional: --trigger --fingerprint --evidence --pr --reviewer --model --reversed-by --run-id).'
    );
    return 1;
  }
  const { buildFeedbackEntry, appendFeedbackEntry, buildFeedbackScaffold, FeedbackError } =
    await import('../../lib/feedback.mjs');
  const repoRoot = await ensureGitRepo(targetPath);
  let entry;
  try {
    entry = buildFeedbackEntry({
      feedbackType: parsed.feedbackType,
      skillId: parsed.feedbackSkillId,
      trigger: parsed.feedbackTrigger ?? undefined,
      findingFingerprint: parsed.feedbackFingerprint,
      evidence: parsed.feedbackEvidence,
      pr: parsed.feedbackPrNumber,
      reviewer: parsed.feedbackReviewer,
      model: parsed.feedbackModel,
      reversedBy: parsed.feedbackReversedBy,
      // #1673: `--run-id <id>` from `river run --save` ("Run saved: <runId>").
      // Written as `review_run_id` so `river evolve aggregate` can join this
      // entry back to that run (契約2).
      reviewRunId: parsed.feedbackRunId,
    });
  } catch (err) {
    if (err instanceof FeedbackError) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    throw err;
  }
  const filePath = await appendFeedbackEntry(entry, { repoRoot });
  const scaffold = buildFeedbackScaffold(entry);
  console.log('Feedback recorded: ' + entry.feedbackType + ' for ' + entry.skillId);
  console.log('  written to: ' + filePath);
  console.log('  next action: ' + scaffold.action);
  console.log('  apply scaffolds with: npm run feedback:apply');
  return 0;
}
