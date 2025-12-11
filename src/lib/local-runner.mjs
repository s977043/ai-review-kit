import path from 'node:path';
import { collectRepoDiff } from './diff.mjs';
import { generateReview } from './review-engine.mjs';
import { detectDefaultBranch, ensureGitRepo, findMergeBase } from './git.mjs';
import { buildExecutionPlan } from './review-runner.mjs';
import { loadProjectRules } from './rules.mjs';

function normalizePhase(phase) {
  const normalized = (phase || '').toLowerCase();
  if (['upstream', 'midstream', 'downstream'].includes(normalized)) return normalized;
  return 'midstream';
}

export async function planLocalReview({
  cwd = process.cwd(),
  phase = 'midstream',
  debug = false,
  preferredModelHint = 'balanced',
} = {}) {
  const repoRoot = await ensureGitRepo(cwd);
  const { rulesText: projectRules } = await loadProjectRules(repoRoot);
  const defaultBranch = await detectDefaultBranch(repoRoot);
  const mergeBase = await findMergeBase(repoRoot, defaultBranch);
  const diff = await collectRepoDiff(repoRoot, mergeBase, { contextLines: debug ? 10 : 3 });
  const reviewFiles = diff.filesForReview?.map(file => file.path) ?? diff.changedFiles;

  if (!reviewFiles.length) {
    return {
      status: 'no-changes',
      repoRoot,
      defaultBranch,
      mergeBase,
      projectRules,
      diff,
    };
  }

  const plan = await buildExecutionPlan({
    phase: normalizePhase(phase),
    changedFiles: reviewFiles,
    availableContexts: ['diff'],
    preferredModelHint,
  });

  return {
    status: 'ok',
    repoRoot,
    defaultBranch,
    mergeBase,
    changedFiles: reviewFiles,
    plan,
    diff,
    projectRules,
  };
}

export async function runLocalReview(
  {
    cwd = process.cwd(),
    phase = 'midstream',
    dryRun = false,
    debug = false,
    preferredModelHint = 'balanced',
    model,
    apiKey,
    context: providedContext,
  } = {},
) {
  const context = providedContext ?? (await planLocalReview({ cwd, phase, debug, preferredModelHint }));
  if (context.status === 'no-changes') {
    return {
      status: 'no-changes',
      repoRoot: context.repoRoot,
      defaultBranch: context.defaultBranch,
      mergeBase: context.mergeBase,
    };
  }

  const review = await generateReview({
    diff: context.diff,
    plan: context.plan,
    phase: normalizePhase(phase),
    dryRun,
    model,
    apiKey,
    projectRules: context.projectRules,
  });

  return {
    status: 'ok',
    repoRoot: path.resolve(context.repoRoot),
    defaultBranch: context.defaultBranch,
    mergeBase: context.mergeBase,
    changedFiles: context.changedFiles,
    plan: context.plan,
    diffText: context.diff.diffText,
    files: context.diff.filesForReview ?? context.diff.files,
    comments: review.comments,
    tokenEstimate: context.diff.tokenEstimate,
    rawTokenEstimate: context.diff.rawTokenEstimate,
    reduction: context.diff.reduction,
    prompt: review.prompt,
    reviewDebug: review.debug,
    projectRules: context.projectRules,
  };
}
