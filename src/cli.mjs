#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { runLocalReview } from './lib/local-runner.mjs';
import { GitRepoNotFoundError } from './lib/git.mjs';

function printHelp() {
  console.log(`Usage: river run <path> [options]

Commands:
  run <path>    Run River Reviewer locally against the git repo at <path>

Options:
  --phase <phase>   Review phase (upstream|midstream|downstream). Default: env RIVER_PHASE or midstream
  --dry-run         Do not call external services; print results to stdout
  --debug           Print debug information (merge base, files, token estimate)
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
      parsed.phase = args.shift() || parsed.phase;
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
    console.log(`- ${comment.file}:${comment.line} ${comment.message}`);
  });
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
    const result = await runLocalReview({
      cwd: targetPath,
      phase: parsed.phase,
      dryRun: parsed.dryRun,
      debug: parsed.debug,
    });

    console.log(`River Reviewer (local)
Phase: ${parsed.phase}
Repo: ${result.repoRoot}
Base branch: ${result.defaultBranch}
Merge base: ${result.mergeBase}
Dry run: ${parsed.dryRun ? 'yes' : 'no'}
Debug: ${parsed.debug ? 'yes' : 'no'}`);

    if (result.status === 'no-changes') {
      console.log(`No changes to review compared to ${result.defaultBranch}.`);
      return 0;
    }

    if (parsed.debug) {
      console.log(`Changed files (${result.changedFiles.length}): ${result.changedFiles.join(', ')}`);
      console.log(`Approx prompt tokens (chars/4): ${result.tokenEstimate}`);
    }

    printPlan(result.plan);
    printComments(result.comments);

    if (parsed.debug) {
      console.log('\n--- diff preview ---');
      console.log(result.diffText.split('\n').slice(0, 200).join('\n'));
    }

    return 0;
  } catch (error) {
    if (error instanceof GitRepoNotFoundError) {
      console.error(error.message);
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
