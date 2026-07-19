// `river eval` subcommand handler.
//
// Extracted verbatim from src/cli.mjs main() as part of the CLI dispatch
// refactor (split main() into per-subcommand handlers). Behavior, messages,
// and exit codes are unchanged; only the enclosing function and the relative
// import depth differ from the original inline block.
import path from 'node:path';
import process from 'node:process';

/**
 * Handle the `eval` command (review fixtures evaluation).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @returns {Promise<number>} process exit code.
 */
export async function runEvalCommand(parsed) {
  const { evaluateReviewFixtures } = await import('../../lib/review-fixtures-eval.mjs');
  const casesPath =
    parsed.fixturesCasesPath ||
    path.join(process.cwd(), 'tests', 'fixtures', 'review-eval', 'cases.json');
  return evaluateReviewFixtures({ casesPath, phase: parsed.phase, verbose: parsed.verbose });
}
