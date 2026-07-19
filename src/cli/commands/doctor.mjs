// `river doctor` subcommand handler.
//
// Extracted verbatim from src/cli.mjs main() as part of the CLI dispatch
// refactor (split main() into per-subcommand handlers). Behavior, messages,
// and exit codes are unchanged; only the enclosing function and the relative
// import depth differ from the original inline block. The shared render helpers
// (printPlan / printExplain / printHintLines) live in src/cli/render.mjs.
import { doctorLocalReview } from '../../lib/local-runner.mjs';
import { isLlmEnabled } from '../../lib/utils.mjs';
import { MAX_DIFF_PREVIEW_LINES, printHintLines, printPlan, printExplain } from '../render.mjs';

/**
 * Handle the `doctor` command (setup check + hints).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @param {string} targetPath - resolved repo target path.
 * @returns {Promise<number>} process exit code.
 */
export async function runDoctorCommand(parsed, targetPath) {
  const result = await doctorLocalReview({
    cwd: targetPath,
    phase: parsed.phase,
    debug: parsed.debug,
    preferredModelHint: 'balanced',
    availableContexts: parsed.availableContexts,
    availableDependencies: parsed.availableDependencies,
  });

  const llmConfigured = isLlmEnabled();

  console.log(`River Review doctor
Repo: ${result.repoRoot}
Base branch: ${result.defaultBranch}
Merge base: ${result.mergeBase}
Skills loaded: ${result.skillsCount}
Project rules: ${result.projectRules ? 'present' : 'none'}
LLM (review): ${llmConfigured ? 'configured' : 'not set'}
LLM (planner): ${llmConfigured ? 'configured' : 'not set'}
Contexts: ${(result.availableContexts || []).join(', ') || 'none'}
Dependencies: ${
    result.availableDependencies
      ? result.availableDependencies.join(', ')
      : 'not specified (skip disabled)'
  }`);

  if (!llmConfigured) {
    printHintLines([
      'Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` to enable headless LLM reviews.',
      'Mechanical (no-key) checks and `--dry-run` / `--offline` still work without one.',
    ]);
  }

  if (!result.changedFiles.length) {
    console.log(`No changes to review compared to ${result.defaultBranch}.`);
    return 0;
  }

  if (result.plan) {
    printPlan(result.plan);
  }
  if (parsed.explain) {
    printExplain(result);
  }
  if (parsed.debug) {
    const impactTags = Array.isArray(result.plan?.impactTags) ? result.plan.impactTags : [];
    console.log(
      `\nDebug info:\n- Impact tags: ${impactTags.join(', ') || 'none'}\n- Token estimate: ${result.diff.tokenEstimate}\n`
    );
    console.log('--- diff preview ---');
    console.log(result.diff.diffText.split('\n').slice(0, MAX_DIFF_PREVIEW_LINES).join('\n'));
  }
  return 0;
}
