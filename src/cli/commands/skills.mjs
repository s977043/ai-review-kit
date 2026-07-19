// `river skills` subcommand handler.
//
// Extracted verbatim from src/cli.mjs main() as part of the CLI dispatch
// refactor (split main() into per-subcommand handlers). Behavior, messages,
// and exit codes are unchanged; only the enclosing function and the relative
// import depth differ from the original inline block.
import { ensureGitRepo, detectDefaultBranch, findMergeBase } from '../../lib/git.mjs';
import { collectRepoDiff, renderDiffText } from '../../lib/diff-processor.mjs';
import { SkillDispatcher } from '../../core/skill-dispatcher.mjs';

/**
 * Handle the `skills` command (resolve | import/export/list | default run).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @param {string} targetPath - resolved repo target path.
 * @returns {Promise<number>} process exit code.
 */
export async function runSkillsCommand(parsed, targetPath) {
  if (parsed.command === 'skills' && parsed.skillsSubcommand === 'resolve') {
    // Deterministic resolution: which skills would run for the given
    // path(s) and phase. No git, no LLM — pure metadata routing, so
    // agents and CI can introspect skill selection cheaply (#1045).
    const paths = parsed.resolvePaths?.length ? parsed.resolvePaths : null;
    if (!paths) {
      console.error('Error: `river skills resolve` requires at least one --path <file>.');
      return 1;
    }
    const { buildExecutionPlan } = await import('../../../runners/core/review-runner.mjs');
    const plan = await buildExecutionPlan({
      phase: parsed.phase,
      changedFiles: paths,
      availableContexts: parsed.availableContexts ?? ['diff'],
      preferredModelHint: 'balanced',
    });
    if (parsed.output === 'json') {
      console.log(
        JSON.stringify(
          {
            phase: parsed.phase,
            paths,
            selected: plan.selected.map((s) => s.metadata?.id ?? s.id),
            skipped: plan.skipped.map((e) => ({
              id: e.skill?.metadata?.id ?? e.skill?.id,
              reasons: e.reasons,
            })),
          },
          null,
          2
        )
      );
      return 0;
    }
    console.log(`Resolved skills (phase=${parsed.phase}, paths=${paths.join(', ')}):`);
    if (!plan.selected.length) console.log('  (none matched)');
    for (const skill of plan.selected) {
      console.log(`  ✓ ${skill.metadata?.id ?? skill.id}`);
    }
    const skippedWithReasons = plan.skipped.filter((e) => e.reasons?.length);
    if (skippedWithReasons.length) {
      console.log('Skipped:');
      for (const e of skippedWithReasons) {
        console.log(`  - ${e.skill?.metadata?.id ?? e.skill?.id}: ${e.reasons.join('; ')}`);
      }
    }
    return 0;
  }

  if (parsed.command === 'skills' && parsed.skillsSubcommand) {
    const { runSkillsSubcommand } = await import('../../lib/agent-skill-bridge.mjs');
    return runSkillsSubcommand(parsed);
  }

  if (parsed.command === 'skills') {
    const repoRoot = await ensureGitRepo(targetPath);
    const defaultBranch = await detectDefaultBranch(repoRoot);
    const mergeBase = await findMergeBase(repoRoot, defaultBranch);
    const repoDiff = await collectRepoDiff(repoRoot, mergeBase);

    const dispatcher = new SkillDispatcher(repoRoot);

    const getFileDiff = async (targetFile) => {
      const fileData = repoDiff.files.find((f) => f.path === targetFile);
      if (!fileData) return '';
      return renderDiffText([fileData]);
    };

    console.log(`River Review (Skills) - Target: ${targetPath}`);
    const results = await dispatcher.run(
      repoDiff.changedFiles,
      getFileDiff,
      parsed.phase,
      parsed.dryRun,
      parsed.debug
    );

    if (parsed.output === 'markdown') {
      console.log(`## Review Results\n`);
      for (const res of results) {
        console.log(`### ${res.file} (Skill: ${res.skill})`);
        console.log(res.review);
        console.log('\n---');
      }
    } else {
      console.log(JSON.stringify(results, null, 2));
    }
    return 0;
  }
}
