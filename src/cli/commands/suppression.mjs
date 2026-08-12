// `river suppression` subcommand handler.
//
// Extracted verbatim from src/cli.mjs main() as part of the CLI dispatch
// refactor (split main() into per-subcommand handlers). Behavior, messages,
// and exit codes are unchanged; only the enclosing function and the relative
// import depth differ from the original inline block.
import path from 'node:path';
import { ensureGitRepo } from '../../lib/git.mjs';

/**
 * Handle the `suppression` command (suppression add).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @param {string} targetPath - resolved repo target path.
 * @returns {Promise<number>} process exit code.
 */
export async function runSuppressionCommand(parsed, targetPath) {
  if (parsed.suppressionSubcommand !== 'add') {
    console.error(
      'Error: only `river suppression add` is supported (need: --fingerprint --feedback --rationale).'
    );
    return 1;
  }
  if (!parsed.suppressionFingerprint) {
    console.error('Error: --fingerprint <16-hex> is required.');
    return 1;
  }
  if (!/^[0-9a-f]{16}$/.test(parsed.suppressionFingerprint)) {
    console.error('Error: --fingerprint must be exactly 16 lowercase hex chars.');
    return 1;
  }
  if (!parsed.suppressionFeedbackType) {
    console.error(
      'Error: --feedback <false_positive|accepted_risk|wont_fix|not_relevant|duplicate> is required.'
    );
    return 1;
  }
  const validFeedback = new Set([
    'false_positive',
    'accepted_risk',
    'wont_fix',
    'not_relevant',
    'duplicate',
  ]);
  if (!validFeedback.has(parsed.suppressionFeedbackType)) {
    console.error('Error: --feedback must be one of: ' + [...validFeedback].join(', ') + '.');
    return 1;
  }
  if (!parsed.suppressionRationale) {
    console.error('Error: --rationale "<why this finding is being suppressed>" is required.');
    return 1;
  }
  const validScope = new Set(['global', 'subsystem', 'file']);
  if (!validScope.has(parsed.suppressionScope)) {
    console.error('Error: --scope must be one of: global, subsystem, file.');
    return 1;
  }
  const repoRoot = await ensureGitRepo(targetPath);
  const indexPath = path.resolve(repoRoot, '.river', 'memory', 'index.json');
  const { createSuppression } = await import('../../lib/suppression.mjs');
  const entry = createSuppression({
    indexPath,
    findingId: parsed.suppressionFindingId,
    fingerprint: parsed.suppressionFingerprint,
    // #1797: opt-in; parseArgs defaults this to 'v1' and rejects any value
    // outside the schema enum, so createSuppression never sees an unknown algo.
    ...(parsed.suppressionFingerprintAlgo
      ? { fingerprintAlgo: parsed.suppressionFingerprintAlgo }
      : {}),
    feedbackType: parsed.suppressionFeedbackType,
    scope: parsed.suppressionScope,
    rationale: parsed.suppressionRationale,
    severity: parsed.suppressionSeverity,
    filePaths: parsed.suppressionFiles,
    expiresAt: parsed.suppressionExpiresAt,
    prNumber: parsed.suppressionPrNumber,
  });
  console.log('Suppression created: ' + entry.id);
  console.log('  fingerprint: ' + entry.context.fingerprint);
  console.log('  fingerprintAlgo: ' + entry.context.fingerprintAlgo);
  console.log('  feedbackType: ' + entry.context.feedbackType);
  console.log('  scope: ' + entry.context.scope);
  if (entry.context.severity) console.log('  severity: ' + entry.context.severity);
  console.log('  written to: ' + indexPath);
  return 0;
}
