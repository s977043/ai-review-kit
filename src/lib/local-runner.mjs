import path from 'node:path';
import { collectRepoDiff } from './diff.mjs';
import { generateReview } from './review-engine.mjs';
import { buildExecutionPlan } from './review-runner.mjs';
import { detectDefaultBranch, ensureGitRepo, findMergeBase } from './git.mjs';

function normalizePhase(phase) {
  const normalized = (phase || '').toLowerCase();
  if (['upstream', 'midstream', 'downstream'].includes(normalized)) return normalized;
  return 'midstream';
}

export async function runLocalReview({
  cwd = process.cwd(),
  phase = 'midstream',
  dryRun = false,
  debug = false,
  preferredModelHint = 'balanced',
  model,
  apiKey,
} = {}) {
  const repoRoot = await ensureGitRepo(cwd);
  const defaultBranch = await detectDefaultBranch(repoRoot);
  const mergeBase = await findMergeBase(repoRoot, defaultBranch);
  const diff = await collectRepoDiff(repoRoot, mergeBase, { contextLines: debug ? 10 : 3 });

  if (!diff.changedFiles.length) {
    return {
      status: 'no-changes',
      repoRoot,
      defaultBranch,
      mergeBase,
    };
  }

  const plan = await buildExecutionPlan({
    phase: normalizePhase(phase),
    changedFiles: diff.changedFiles,
    availableContexts: ['diff'],
    preferredModelHint,
  });

  const review = await generateReview({
    diff,
    plan,
    phase: normalizePhase(phase),
    dryRun,
    model,
    apiKey,
  });

  return {
    status: 'ok',
    repoRoot: path.resolve(repoRoot),
    defaultBranch,
    mergeBase,
    changedFiles: diff.changedFiles,
    plan,
    diffText: diff.diffText,
    files: diff.files,
    comments: review.comments,
    tokenEstimate: diff.tokenEstimate,
    prompt: review.prompt,
    reviewDebug: review.debug,
  };
}
