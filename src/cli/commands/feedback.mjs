// `river feedback` subcommand handler.
//
// Extracted verbatim from src/cli.mjs main() as part of the CLI dispatch
// refactor (split main() into per-subcommand handlers). Behavior, messages,
// and exit codes are unchanged; only the enclosing function and the relative
// import depth differ from the original inline block.
import { ensureGitRepo } from '../../lib/git.mjs';

/**
 * Warn when `--fingerprint` names a value no saved finding carries (#1823 残件2).
 *
 * Emitted HERE, before the row is appended, because this is the only moment the
 * person who copied the value is present. Downstream the same mismatch is only
 * visible from `river evolve aggregate`, days later, to whoever reads the
 * aggregate — and it is not a drop: the row clusters under its own key and can
 * mint a candidate with `no-category` / `no-file-path`.
 *
 * Advisory only. Any failure to read the run store (no `.river/runs/`, an
 * unreadable record) is swallowed: the feedback row is the user's data and must
 * be written regardless, so this must never change the exit code. It is also
 * NOT a validity check — v1 and v2 share one hex space and a finding can be
 * older than the retained runs, so an unmatched value can still be correct.
 *
 * @param {string|null} fingerprint
 * @param {string} repoRoot
 */
async function warnWhenFingerprintMatchesNoFinding(fingerprint, repoRoot) {
  if (!fingerprint) return;
  try {
    const { resolveStoreDir, loadAllRunRecords } = await import('../../lib/result-store.mjs');
    const { classifyFingerprintAlgo, formatUnmatchedFeedbackFingerprintWarning } =
      await import('../../lib/finding-factory.mjs');
    const runRecords = await loadAllRunRecords(resolveStoreDir(repoRoot));
    // No saved runs at all: nothing to compare against, so staying quiet is the
    // only honest answer — warning here would fire on every first-ever run.
    if (runRecords.length === 0) return;
    const findings = runRecords.flatMap((record) => record?.findings ?? []);
    const algo = classifyFingerprintAlgo(fingerprint, findings);
    if (algo === 'v1') return;
    console.warn(
      formatUnmatchedFeedbackFingerprintWarning({
        fingerprint,
        likelyAlgo: algo === 'v2' ? 'v2' : null,
      })
    );
  } catch {
    // Advisory check only — see the note above.
  }
}

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
  await warnWhenFingerprintMatchesNoFinding(entry.findingFingerprint, repoRoot);
  const filePath = await appendFeedbackEntry(entry, { repoRoot });
  const scaffold = buildFeedbackScaffold(entry);
  console.log('Feedback recorded: ' + entry.feedbackType + ' for ' + entry.skillId);
  console.log('  written to: ' + filePath);
  console.log('  next action: ' + scaffold.action);
  console.log('  apply scaffolds with: npm run feedback:apply');
  return 0;
}
