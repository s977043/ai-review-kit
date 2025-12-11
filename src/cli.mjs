#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { GitRepoNotFoundError } from './lib/git.mjs';
import { planLocalReview, runLocalReview } from './lib/local-runner.mjs';
import { SkillLoaderError } from './lib/skill-loader.mjs';
import CostEstimator from './core/cost-estimator.mjs';
import { ProjectRulesError } from './lib/rules.mjs';

const MAX_PROMPT_PREVIEW_LENGTH = 800;
const MAX_DIFF_PREVIEW_LINES = 200;

function printHelp() {
  console.log(`Usage: river run <path> [options]

Commands:
  run <path>    Run River Reviewer locally against the git repo at <path>

Options:
  --phase <phase>   Review phase (upstream|midstream|downstream). Default: env RIVER_PHASE or midstream
  --dry-run         Do not call external services; print results to stdout
  --debug           Print debug information (merge base, files, token estimate)
  --estimate        Print cost estimate only (no review)
  --max-cost <usd>  Abort if estimated cost exceeds this USD amount
  -h, --help        Show this help message
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    command: null,
    target: '.',
    phase: process.env.RIVER_PHASE || 'midstream',
    dryRun: false,
    debug: false,
    estimate: false,
    maxCost: null,
  };

  while (args.length) {
    const arg = args.shift();
    if (!parsed.command && arg === 'run') {
      parsed.command = 'run';
      if (args[0] && !args[0].startsWith('-')) {
        parsed.target = args.shift();
      }
      continue;
    }
    if (arg === '--phase') {
      if (!args[0] || args[0].startsWith('-')) {
        console.error('Error: --phase option requires a value.');
        parsed.command = 'help';
        break;
      }
      parsed.phase = args.shift();
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--debug') {
      parsed.debug = true;
      continue;
    }
    if (arg === '--estimate') {
      parsed.estimate = true;
      continue;
    }
    if (arg === '--max-cost') {
      const value = args.shift();
      parsed.maxCost = value ? Number.parseFloat(value) : null;
      if (!Number.isFinite(parsed.maxCost) || parsed.maxCost < 0) {
        console.error('Error: --max-cost requires a non-negative numeric value.');
        parsed.command = 'help';
        break;
      }
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      parsed.command = 'help';
      break;
    }
  }

  return parsed;
}

function formatPlan(plan) {
  const selected = plan.selected.map(skill => skill.metadata?.id ?? skill.id);
  const skipped = plan.skipped.map(item => ({
    id: item.skill.metadata?.id ?? item.skill.id,
    reasons: item.reasons,
  }));
  return { selected, skipped };
}

function printPlan(plan) {
  const summary = formatPlan(plan);
  if (summary.selected.length) {
    console.log(`Selected skills (${summary.selected.length}): ${summary.selected.join(', ')}`);
  } else {
    console.log('Selected skills (0): none matched this diff');
  }
  if (summary.skipped.length) {
    console.log('Skipped skills:');
    summary.skipped.forEach(item => {
      console.log(`- ${item.id}: ${item.reasons.join('; ')}`);
    });
  }
}

function printComments(comments) {
  if (!comments.length) {
    console.log('No review comments generated.');
    return;
  }
  console.log('Review comments:');
  comments.forEach(comment => {
    console.log(`- ${comment.file}:${comment.line}: ${comment.message}`);
  });
}

function printDebugInfo(result) {
  const debug = result.reviewDebug ?? {};
  const rawTokens = result.rawTokenEstimate ?? result.tokenEstimate;
  const reduction = result.reduction ?? 0;
  console.log(`\nDebug info:
- LLM: ${debug.llmUsed ? `used (${debug.llmModel})` : debug.llmSkipped || debug.llmError || 'not used'}
- Token estimate (raw -> optimized): ${rawTokens} -> ${result.tokenEstimate} (${reduction}% reduction)
- Prompt truncated: ${debug.promptTruncated ? 'yes' : 'no'}
- Changed files (${result.changedFiles.length}): ${result.changedFiles.join(', ')}
- Project rules: ${result.projectRules ? 'present' : 'none'}
`);
  if (debug.llmError) {
    console.log(`LLM error: ${debug.llmError}`);
  }
  if (debug.promptPreview) {
    const trimmed =
      debug.promptPreview.length > MAX_PROMPT_PREVIEW_LENGTH
        ? `${debug.promptPreview.slice(0, MAX_PROMPT_PREVIEW_LENGTH)}...`
        : debug.promptPreview;
    console.log('Prompt preview:');
    console.log(trimmed);
  }
  console.log('\n--- diff preview ---');
  console.log(result.diffText.split('\n').slice(0, MAX_DIFF_PREVIEW_LINES).join('\n'));
}

function countChangedLines(files) {
  let lines = 0;
  for (const file of files ?? []) {
    for (const hunk of file.hunks ?? []) {
      lines += (hunk.lines ?? []).filter(l => l.startsWith('+') || l.startsWith('-')).length;
    }
  }
  return lines;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === 'help' || !parsed.command) {
    printHelp();
    return 0;
  }
  if (parsed.command !== 'run') {
    console.error(`Unknown command: ${parsed.command}`);
    printHelp();
    return 1;
  }

  const targetPath = path.resolve(parsed.target);

  try {
    const context = await planLocalReview({
      cwd: targetPath,
      phase: parsed.phase,
      debug: parsed.debug,
    });

    const estimator = new CostEstimator(process.env.OPENAI_MODEL || process.env.RIVER_OPENAI_MODEL || undefined);
    const estimatedCost = estimator.estimateFromDiff(context.diff, context.plan?.selected ?? []);

    console.log(`River Reviewer (local)
Phase: ${parsed.phase}
Repo: ${context.repoRoot}
Base branch: ${context.defaultBranch}
Merge base: ${context.mergeBase}
Dry run: ${parsed.dryRun ? 'yes' : 'no'}
Debug: ${parsed.debug ? 'yes' : 'no'}`);

    if (context.status === 'no-changes') {
      console.log(`No changes to review compared to ${context.defaultBranch}.`);
      return 0;
    }

    if (parsed.maxCost !== null && estimatedCost.usd > parsed.maxCost) {
      console.log(estimator.formatCost(estimatedCost));
      console.error(`Estimated cost $${estimatedCost.usd.toFixed(4)} exceeds max-cost ${parsed.maxCost}. Aborting.`);
      return 1;
    }

    if (parsed.estimate) {
      console.log('Cost Estimate:');
      console.log(estimator.formatCost(estimatedCost));
      console.log(`Files to review: ${context.changedFiles.length}`);
      console.log(`Lines changed (approx): ${countChangedLines(context.diff.filesForReview ?? context.diff.files)}`);
      return 0;
    }

    const result = await runLocalReview({
      cwd: targetPath,
      phase: parsed.phase,
      dryRun: parsed.dryRun,
      debug: parsed.debug,
      context,
    });

    printPlan(result.plan);
    printComments(result.comments);

    if (parsed.debug) {
      printDebugInfo(result);
    }

    return 0;
  } catch (error) {
    if (error instanceof GitRepoNotFoundError) {
      console.error(error.message);
      return 1;
    }
    if (error instanceof SkillLoaderError) {
      console.error(`Skill configuration error: ${error.message}`);
      return 1;
    }
    if (error instanceof ProjectRulesError) {
      console.error(error.message);
      return 1;
    }
    if (error.name === 'GitError') {
      console.error(`Git command failed: ${error.message}`);
      return 1;
    }
    console.error(`CLI error: ${error.message}`);
    return 1;
  }
}

main().then(code => {
  if (typeof code === 'number' && code !== 0) {
    process.exitCode = code;
  }
});
