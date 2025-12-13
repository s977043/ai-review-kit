#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { GitError, GitRepoNotFoundError } from './lib/git.mjs';
import { planLocalReview, runLocalReview } from './lib/local-runner.mjs';
import { SkillLoaderError } from './lib/skill-loader.mjs';
import CostEstimator from './core/cost-estimator.mjs';
import { ProjectRulesError } from './lib/rules.mjs';
import { parseList } from './lib/utils.mjs';

const MAX_PROMPT_PREVIEW_LENGTH = 800;
const MAX_DIFF_PREVIEW_LINES = 200;
const COMMENT_MARKER = '<!-- river-reviewer -->';

function printHintLines(lines = []) {
  const hints = lines.filter(Boolean);
  if (!hints.length) return;
  console.error('\nHints:');
  hints.forEach(line => console.error(`- ${line}`));
}

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
  --output <mode>   Output format: text|markdown. Default: text
  --context list    Comma-separated available contexts (e.g. diff,fullFile,tests). Overrides RIVER_AVAILABLE_CONTEXTS
  --dependency list Comma-separated available dependencies (e.g. code_search,test_runner). Overrides RIVER_AVAILABLE_DEPENDENCIES
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
    output: 'text',
    availableContexts: null,
    availableDependencies: null,
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
    if (arg === '--output') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --output option requires a value.');
        parsed.command = 'help';
        break;
      }
      const mode = value.toLowerCase();
      if (!['text', 'markdown'].includes(mode)) {
        console.error(`Error: --output must be one of: text, markdown (got "${value}").`);
        parsed.command = 'help';
        break;
      }
      parsed.output = mode;
      continue;
    }
    if (arg === '--context') {
      parsed.availableContexts = parseList(args.shift());
      continue;
    }
    if (arg === '--dependency') {
      parsed.availableDependencies = parseList(args.shift());
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
  const reasonCounts = skipped.reduce((acc, item) => {
    (item.reasons || []).forEach(reason => {
      acc.set(reason, (acc.get(reason) ?? 0) + 1);
    });
    return acc;
  }, new Map());
  return { selected, skipped, reasonCounts };
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
    if (summary.reasonCounts.size) {
      console.log('Skip reasons summary:');
      for (const [reason, count] of summary.reasonCounts.entries()) {
        console.log(`- ${reason}: ${count}`);
      }
    }
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

function formatCommentsMarkdown(comments) {
  if (!comments?.length) return '_No findings._';
  return comments.map(c => `- \`${c.file}:${c.line}\` ${c.message}`).join('\n');
}

function formatPlanMarkdown(plan) {
  const summary = formatPlan(plan);
  const selected = summary.selected.length ? summary.selected.map(id => `- \`${id}\``).join('\n') : '- _none_';

  if (!summary.skipped.length) {
    return `### 選択されたスキル (${summary.selected.length})\n${selected}\n`;
  }

  const skippedLines = summary.skipped.map(item => `- \`${item.id}\`: ${item.reasons.join('; ')}`).join('\n');
  return `### 選択されたスキル (${summary.selected.length})\n${selected}\n\n<details>\n<summary>スキップされたスキル (${summary.skipped.length})</summary>\n\n${skippedLines}\n\n</details>\n`;
}

function formatDebugSummaryMarkdown(result) {
  const debug = result.reviewDebug ?? {};
  const llmStatus = debug.llmUsed
    ? `used (\`${debug.llmModel}\`)`
    : debug.llmSkipped || debug.llmError
      ? `skipped (${debug.llmSkipped || debug.llmError})`
      : 'not used';

  return [
    `- LLM: ${llmStatus}`,
    `- 変更ファイル数: ${result.changedFiles.length}`,
    `- トークン見積もり: ${result.tokenEstimate}`,
  ].join('\n');
}

function printMarkdownReport(result, phase) {
  const header = `${COMMENT_MARKER}
## River Reviewer

- フェーズ: \`${phase}\`
${formatDebugSummaryMarkdown(result)}
`;
  const planSection = formatPlanMarkdown(result.plan);
  const findings = `### 指摘\n${formatCommentsMarkdown(result.comments)}\n`;
  console.log([header, planSection, findings].join('\n'));
}

function printDebugInfo(result, { log = console.log } = {}) {
  const debug = result.reviewDebug ?? {};
  const rawTokens = result.rawTokenEstimate ?? result.tokenEstimate;
  const reduction = result.reduction ?? 0;
  log(`\nDebug info:
- LLM: ${debug.llmUsed ? `used (${debug.llmModel})` : debug.llmSkipped || debug.llmError || 'not used'}
- Token estimate (raw -> optimized): ${rawTokens} -> ${result.tokenEstimate} (${reduction}% reduction)
- Prompt truncated: ${debug.promptTruncated ? 'yes' : 'no'}
- Changed files (${result.changedFiles.length}): ${result.changedFiles.join(', ')}
- Project rules: ${result.projectRules ? 'present' : 'none'}
- Available contexts: ${(result.availableContexts || []).join(', ') || 'none'}
- Available dependencies: ${
    result.availableDependencies ? result.availableDependencies.join(', ') : 'not specified (skip disabled)'
  }
`);
  if (debug.llmError) {
    log(`LLM error: ${debug.llmError}`);
  }
  if (debug.promptPreview) {
    const trimmed =
      debug.promptPreview.length > MAX_PROMPT_PREVIEW_LENGTH
        ? `${debug.promptPreview.slice(0, MAX_PROMPT_PREVIEW_LENGTH)}...`
        : debug.promptPreview;
    log('Prompt preview:');
    log(trimmed);
  }
  if (result.plan?.skipped?.length) {
    log('\nSkipped skills detail:');
    result.plan.skipped.forEach(item => {
      const id = item.skill?.metadata?.id ?? item.skill?.id ?? '(unknown)';
      log(`- ${id}: ${item.reasons.join('; ')}`);
    });
  }
  log('\n--- diff preview ---');
  log(result.diffText.split('\n').slice(0, MAX_DIFF_PREVIEW_LINES).join('\n'));
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
      availableContexts: parsed.availableContexts,
      availableDependencies: parsed.availableDependencies,
    });

    const estimator = new CostEstimator(process.env.OPENAI_MODEL || process.env.RIVER_OPENAI_MODEL || undefined);
    const estimatedCost = estimator.estimateFromDiff(context.diff, context.plan?.selected ?? []);

    console.log(`River Reviewer (local)
Phase: ${parsed.phase}
Repo: ${context.repoRoot}
Base branch: ${context.defaultBranch}
Merge base: ${context.mergeBase}
Dry run: ${parsed.dryRun ? 'yes' : 'no'}
Debug: ${parsed.debug ? 'yes' : 'no'}
Contexts: ${(context.availableContexts || []).join(', ') || 'none'}
Dependencies: ${
      context.availableDependencies ? context.availableDependencies.join(', ') : 'not specified (skip disabled)'
    }`);

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
      availableContexts: parsed.availableContexts,
      availableDependencies: parsed.availableDependencies,
    });

    if (parsed.output === 'markdown') {
      printMarkdownReport(result, parsed.phase);
    } else {
      printPlan(result.plan);
      printComments(result.comments);
    }

    if (parsed.debug) {
      if (parsed.output === 'markdown') {
        console.error('\nDebug info (not included in markdown output):');
        printDebugInfo(result, { log: console.error });
      } else {
        printDebugInfo(result);
      }
    }

    return 0;
  } catch (error) {
    if (error instanceof GitRepoNotFoundError) {
      console.error(error.message);
      printHintLines([
        'Run this command inside a git repository (or pass the repo path).',
        'If needed: `git init` or `git clone ...`',
      ]);
    } else if (error instanceof SkillLoaderError) {
      console.error(`Skill configuration error: ${error.message}`);
      printHintLines(['Run `npm run skills:validate` to see full validation errors.', 'Docs: pages/guides/validate-skill-schema.md']);
    } else if (error instanceof ProjectRulesError) {
      console.error(error.message);
      printHintLines([
        'Check `.river/rules.md` exists and is readable (or remove it to disable rules).',
        'Docs: README.md (Project-specific review rules)',
      ]);
    } else if (error instanceof GitError) {
      console.error(`Git command failed: ${error.message}`);
      printHintLines(['Ensure `git` is available and the repository has a default branch.', 'Try `river run . --debug` for more context.']);
    } else {
      console.error(`CLI error: ${error.message}`);
      printHintLines(['Try `river run . --debug` for more context.']);
    }
    return 1;
  }
}

main().then(code => {
  if (typeof code === 'number' && code !== 0) {
    process.exitCode = code;
  }
});
