// `river review` subcommand handler.
//
// Extracted verbatim from src/cli.mjs main() as part of the CLI dispatch
// refactor (#issue: split main() into per-subcommand handlers). Behavior,
// messages, and exit codes are unchanged; only the enclosing function and the
// relative import depth differ from the original inline block.
import path from 'node:path';
import process from 'node:process';
import { ensureGitRepo, detectDefaultBranch, findMergeBase } from '../../lib/git.mjs';
import { collectRepoDiff } from '../../lib/diff-processor.mjs';
import { SkillLoaderError, resolveSkillSet } from '../../../runners/core/skill-loader.mjs';

/**
 * Handle the `review` command (plan | exec | verify | route).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @returns {Promise<number>} process exit code.
 */
export async function runReviewCommand(parsed) {
  // `review exec --dry-run` (without --plan): per spec, dry-run does
  // no LLM/skill execution — it only resolves inputs and produces a
  // deterministic plan, which is exactly `runReviewPlan`'s behavior.
  // It is routed through the shared plan path below.
  const isExecDryRun = parsed.reviewSubcommand === 'exec' && parsed.dryRun && !parsed.planFile;

  // `review exec --plan <path>` (replay): the external plan is the
  // source of truth (#802 Phase 3, replay contract). Artifact
  // resolution and buildExecutionPlan are NOT re-run. Skill execution
  // is out of scope here, so `findings` stays empty for now.
  const isExecPlanReplay =
    parsed.reviewSubcommand === 'exec' && typeof parsed.planFile === 'string';

  // `review exec` (no flags): #802 Phase 3 A2-1. Resolve artifacts,
  // build the execution plan with `llmEnabled: true` so non-heuristic
  // skills can be selected, and call generateReview to populate the
  // artifact findings via the LLM-or-heuristic pipeline. When no API
  // key is configured, generateReview gracefully falls back to
  // heuristic findings (or an empty set) instead of failing.
  const isExecExecute =
    parsed.reviewSubcommand === 'exec' && !parsed.dryRun && typeof parsed.planFile !== 'string';

  if (parsed.reviewSubcommand === 'verify') {
    return runReviewVerify(parsed);
  }
  if (parsed.reviewSubcommand === 'route') {
    return runReviewRoute(parsed);
  }
  // At this point, the verify/route branches above have already returned, so the
  // remaining valid subcommands are `plan` and `exec` (in any of its
  // exec dry-run / replay / deferred forms). Anything else is unknown.
  //
  // Unreachable from the CLI since #1755: parseArgs rejects a missing or
  // unknown subcommand itself, so that it exits 1 like every other usage error
  // rather than 3 (= the `--gate` ESCALATE code). Kept as a guard for
  // programmatic callers, and aligned on exit 1 for the same reason.
  if (parsed.reviewSubcommand !== 'plan' && parsed.reviewSubcommand !== 'exec') {
    console.error(
      parsed.reviewSubcommand
        ? `Error: "${parsed.reviewSubcommand}" is not a river review subcommand (plan | exec | verify | route).`
        : 'Error: river review requires a subcommand (plan | exec | verify | route).'
    );
    return 1;
  }
  try {
    const { runReviewPlan, runReviewExecReplay, ReviewPlanError, resolveReviewOutputFormat } =
      await import('../../lib/review-plan.mjs');
    let reviewFormat;
    try {
      reviewFormat = resolveReviewOutputFormat(parsed);
    } catch (err) {
      if (err instanceof ReviewPlanError) {
        console.error(`Error: ${err.message}`);
        return 3;
      }
      throw err;
    }
    // #976/#1027: resolve --skill-set within the review namespace so
    // `river review plan|exec --skill-set <name>` restricts candidates
    // (previously only `river run` honored it; the flag was silently
    // ignored here). Skip on the replay path: --plan replays a fixed
    // source plan, so skill selection (and thus --skill-set) does not apply.
    let reviewSkillIds = null;
    if (parsed.skillSet && !isExecPlanReplay) {
      try {
        reviewSkillIds = await resolveSkillSet(parsed.skillSet);
      } catch (err) {
        if (err instanceof SkillLoaderError) {
          console.error(`Error: ${err.message}`);
          return 3;
        }
        throw err;
      }
    }
    let artifact;
    try {
      if (isExecPlanReplay) {
        artifact = await runReviewExecReplay({
          planFile: path.resolve(parsed.planFile),
          debug: parsed.debug,
          // #878 A2-3-impl: replay executes (not just echoes) unless --dry-run.
          // The source plan stays the source of truth (no re-plan); the diff
          // is resolved from the current working tree / --artifact.
          executeReview: !parsed.dryRun,
          cwd: path.resolve(parsed.target),
          cliArtifacts: parsed.cliArtifacts,
          artifactsDir: parsed.artifactsDir,
        });
      } else {
        artifact = await runReviewPlan({
          cwd: path.resolve(parsed.target),
          phase: parsed.phase,
          // exec --dry-run and exec (real run) both reuse the plan path
          // entrypoint; the differentiator is `executeReview`, which
          // enables LLM-backed skill selection and the generateReview
          // adapter so findings are populated.
          planOnly: isExecDryRun || isExecExecute ? true : parsed.planOnly,
          cliArtifacts: parsed.cliArtifacts,
          artifactsDir: parsed.artifactsDir,
          debug: parsed.debug,
          executeReview: isExecExecute,
          skillIds: reviewSkillIds,
          // Forward CLI-level --context / --dependency overrides so
          // authors can opt additional artifact IDs / dependency stubs
          // into selection without env vars.
          availableContexts: parsed.availableContexts ?? undefined,
          availableDependencies: parsed.availableDependencies ?? undefined,
        });
      }
    } catch (err) {
      if (err instanceof ReviewPlanError) {
        console.error(`Error: ${err.message}`);
        return 3;
      }
      throw err;
    }
    const outputFilePath = parsed.outputFile ? path.resolve(parsed.outputFile) : null;
    const summaryFilePath = parsed.summaryFile ? path.resolve(parsed.summaryFile) : null;
    if (outputFilePath && summaryFilePath && outputFilePath === summaryFilePath) {
      console.error('Error: --output-file and --summary-file must not point to the same path.');
      return 3;
    }
    const { writeFile } = await import('node:fs/promises');
    let serialized;
    if (reviewFormat === 'markdown') {
      // #976: human-readable Markdown rendering of the artifact (findings +
      // plan). The JSON artifact stays the machine-readable contract.
      const { formatReviewPlanSummaryMarkdown } = await import('../../lib/review-plan-summary.mjs');
      serialized = formatReviewPlanSummaryMarkdown(artifact);
    } else {
      serialized = JSON.stringify(artifact, null, 2);
    }
    if (outputFilePath) {
      await writeFile(outputFilePath, serialized + '\n', 'utf8');
    } else {
      // The artifact (JSON or Markdown) is the requested output, not a
      // progress log: --quiet does not suppress it.
      process.stdout.write(serialized + '\n');
    }
    if (summaryFilePath) {
      const { formatReviewPlanSummaryMarkdown } = await import('../../lib/review-plan-summary.mjs');
      await writeFile(summaryFilePath, formatReviewPlanSummaryMarkdown(artifact) + '\n', 'utf8');
    }
    // #976: opt-in review gate. Only when --fail-on / --warn-on / --advisory-only
    // / --gate is given do we translate findings into a CI exit code; otherwise
    // exit 0 (non-breaking for existing callers / the plangate-review workflow).
    if (parsed.failOn || parsed.warnOn || parsed.advisoryOnly || parsed.gate) {
      const { resolveGateExitCode } = await import('../../lib/gate-exit.mjs');
      return await resolveGateExitCode({
        failOn: parsed.failOn,
        warnOn: parsed.warnOn,
        advisoryOnly: parsed.advisoryOnly,
        gate: parsed.gate,
        getGateInput: () => artifact,
        getGateObject: () => artifact.gate,
      });
    }
    return 0;
  } catch (err) {
    console.error(`Error: ${err?.message ?? err}`);
    return 1;
  }
}

/**
 * `river review verify` — accept the argument/output contract, defer execution.
 *
 * verify (and any future review subcommand that is not exec): the
 * CLI/output contract is fixed and validated here (PR-3), but skill
 * execution and verify-side artifact reading are not implemented
 * yet. The contract depends only on the Artifact Input Contract IDs
 * — it does not depend on PlanGate.
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @returns {Promise<number>} process exit code.
 */
async function runReviewVerify(parsed) {
  try {
    const { ReviewPlanError, resolveReviewOutputFormat } =
      await import('../../lib/review-plan.mjs');
    try {
      resolveReviewOutputFormat(parsed);
    } catch (err) {
      if (err instanceof ReviewPlanError) {
        console.error(`Error: ${err.message}`);
        return 3;
      }
      throw err;
    }
  } catch (err) {
    console.error(`Error: ${err?.message ?? err}`);
    return 1;
  }
  console.error(
    `river review ${parsed.reviewSubcommand}: the argument/output contract is accepted, ` +
      'but execution is not implemented yet (#802 Phase 3). ' +
      'See pages/reference/cli-review-' +
      parsed.reviewSubcommand +
      '-spec.md.'
  );
  return 3;
}

/**
 * `river review route` — risk-based review mode recommendation (dry-run, no LLM).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @returns {Promise<number>} process exit code.
 */
async function runReviewRoute(parsed) {
  try {
    const { routeReviewMode, formatRouterResultMarkdown } =
      await import('../../lib/review-mode-router.mjs');
    const { loadRiskMap } = await import('../../lib/risk-map.mjs');
    const routeTargetPath = path.resolve(parsed.target);
    const repoRoot = await ensureGitRepo(routeTargetPath);
    const defaultBranch = await detectDefaultBranch(repoRoot);
    const mergeBase = await findMergeBase(repoRoot, parsed.base ?? defaultBranch);
    const repoDiff = await collectRepoDiff(repoRoot, mergeBase);
    const riskMap = await loadRiskMap(repoRoot).catch((err) => {
      console.warn(`Warning: could not load risk-map.yaml: ${err?.message ?? err}`);
      return null;
    });
    const result = routeReviewMode({
      changedFiles: repoDiff.changedFiles,
      diffText: repoDiff.rawDiffText,
      riskMap,
      targetPath: routeTargetPath,
    });
    const outputFormat = parsed.formatExplicit
      ? parsed.format
      : parsed.outputExplicit && ['json', 'markdown'].includes(parsed.output)
        ? parsed.output
        : 'json';
    if (outputFormat === 'markdown') {
      console.log(formatRouterResultMarkdown(result));
    } else if (outputFormat === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(
        `Error: river review route only supports --format json or --format markdown` +
          (parsed.outputExplicit
            ? ` (--output is not supported for this subcommand; use --format instead)`
            : ` (got "${outputFormat}").`)
      );
      return 3;
    }
    return 0;
  } catch (err) {
    console.error(`Error: ${err?.message ?? err}`);
    return 1;
  }
}
