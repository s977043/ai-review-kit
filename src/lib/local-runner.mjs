import path from 'node:path';
import { buildExecutionPlan } from './review-runner.mjs';
import {
  collectAddedLineHints,
  detectDefaultBranch,
  diffWithContext,
  ensureGitRepo,
  findMergeBase,
  listChangedFiles,
} from './git.mjs';

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
} = {}) {
  const repoRoot = await ensureGitRepo(cwd);
  const defaultBranch = await detectDefaultBranch(repoRoot);
  const mergeBase = await findMergeBase(repoRoot, defaultBranch);
  const changedFiles = await listChangedFiles(repoRoot, mergeBase);

  if (!changedFiles.length) {
    return {
      status: 'no-changes',
      repoRoot,
      defaultBranch,
      mergeBase,
    };
  }

  const plan = await buildExecutionPlan({
    phase: normalizePhase(phase),
    changedFiles,
    availableContexts: ['diff'],
    preferredModelHint,
  });

  const diffText = await diffWithContext(repoRoot, mergeBase, { unified: 3 });
  const lineHints = collectAddedLineHints(diffText);
  const tokenEstimate = Math.ceil(diffText.length / 4);
  const skillIds = plan.selected.map(skill => skill.metadata?.id ?? skill.id);

  const comments = changedFiles.map(file => ({
    file,
    line: lineHints.get(file) ?? 1,
    message: skillIds.length
      ? `Planned skills: ${skillIds.join(', ')}`
      : 'No matching skills selected; review manually.',
  }));

  return {
    status: 'ok',
    repoRoot: path.resolve(repoRoot),
    defaultBranch,
    mergeBase,
    changedFiles,
    plan,
    diffText,
    comments,
    tokenEstimate,
  };
}
