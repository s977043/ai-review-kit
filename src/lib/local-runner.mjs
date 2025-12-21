import fs from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { ConfigLoader } from '../config/loader.mjs';
import { collectRepoDiff } from './diff.mjs';
import { renderDiffText } from './diff-optimizer.mjs';
import { generateReview } from './review-engine.mjs';
import { detectDefaultBranch, ensureGitRepo, findMergeBase } from './git.mjs';
import { createOpenAIPlanner } from './openai-planner.mjs';
import { normalizePlannerMode } from './planner-utils.mjs';
import { buildExecutionPlan } from './review-runner.mjs';
import { loadProjectRules } from './rules.mjs';
import { loadSkills } from './skill-loader.mjs';
import { parseList } from './utils.mjs';

function normalizePhase(phase) {
  const normalized = (phase || '').toLowerCase();
  if (['upstream', 'midstream', 'downstream'].includes(normalized)) return normalized;
  return 'midstream';
}

// NOTE: Keep this list in sync with schemas/skill.schema.json dependencies enum.
const dependencyStubs = ['code_search', 'test_runner', 'coverage_report', 'adr_lookup', 'repo_metadata', 'tracing'];

const configLoader = new ConfigLoader();

function shouldExclude(filePath, patterns = []) {
  return patterns.some(pattern => minimatch(filePath, pattern, { dot: true }));
}

function applyFileExclusions(diff, patterns = []) {
  if (!patterns.length) return diff;

  const changedFiles = (diff.changedFiles ?? []).filter(filePath => !shouldExclude(filePath, patterns));
  const rawFiles = (diff.files ?? []).filter(file => !shouldExclude(file.path, patterns));
  const optimizedFiles = (diff.filesForReview ?? diff.files ?? []).filter(file => !shouldExclude(file.path, patterns));

  const rawDiffText = renderDiffText(rawFiles);
  const diffText = renderDiffText(optimizedFiles);
  const rawTokenEstimate = Math.ceil(rawDiffText.length / 4);
  const tokenEstimate = Math.ceil(diffText.length / 4);
  const reduction = rawTokenEstimate === 0 ? 0 : Math.max(0, Math.round(((rawTokenEstimate - tokenEstimate) / rawTokenEstimate) * 100));

  return {
    ...diff,
    changedFiles,
    files: rawFiles,
    filesForReview: optimizedFiles,
    rawDiffText,
    diffText,
    rawTokenEstimate,
    tokenEstimate,
    reduction,
  };
}

async function resolvePullRequestLabels() {
  const envLabels = parseList(process.env.RIVER_PR_LABELS);
  if (envLabels.length) return envLabels;

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return [];

  try {
    const raw = await fs.readFile(eventPath, 'utf8');
    const event = JSON.parse(raw);
    const pullRequestLabels = event?.pull_request?.labels ?? event?.labels ?? [];
    return pullRequestLabels.map(label => label?.name).filter(Boolean);
  } catch {
    return [];
  }
}

function shouldSkipByLabel(prLabels = [], ignorePatterns = []) {
  if (!prLabels.length || !ignorePatterns.length) return { matched: [], shouldSkip: false };
  const normalizedLabels = prLabels.map(label => label.toLowerCase());
  const matched = ignorePatterns.filter(pattern => {
    const needle = pattern.toLowerCase();
    return normalizedLabels.some(label => label.includes(needle));
  });
  return { matched, shouldSkip: matched.length > 0 };
}

function resolveAvailableContexts(inputContexts) {
  const envContexts = parseList(process.env.RIVER_AVAILABLE_CONTEXTS);
  const base = inputContexts?.length ? inputContexts : ['diff'];
  return [...new Set([...base, ...envContexts])];
}

function resolveAvailableDependencies(inputDependencies) {
  const envDeps = parseList(process.env.RIVER_AVAILABLE_DEPENDENCIES);
  const stubEnabled =
    typeof process.env.RIVER_DEPENDENCY_STUBS === 'string' &&
    ['1', 'true', 'yes', 'stub'].includes(process.env.RIVER_DEPENDENCY_STUBS.toLowerCase());
  if (inputDependencies?.length) return [...new Set(inputDependencies)];
  if (envDeps.length) return [...new Set(envDeps)];
  if (stubEnabled) return [...dependencyStubs];
  return null; // null disables dependency-based skipping (backward-compatible)
}

async function collectLocalContext({
  cwd,
  debug = false,
  contextLines = 3,
  availableContexts,
  availableDependencies,
} = {}) {
  const repoRoot = await ensureGitRepo(cwd);
  const { config, path: configPath, source: configSource } = await configLoader.load(repoRoot);
  const prLabels = await resolvePullRequestLabels();
  const { rulesText: projectRules } = await loadProjectRules(repoRoot);
  const defaultBranch = await detectDefaultBranch(repoRoot);
  const mergeBase = await findMergeBase(repoRoot, defaultBranch);
  const rawDiff = await collectRepoDiff(repoRoot, mergeBase, { contextLines });
  const diff = applyFileExclusions(rawDiff, config.exclude?.files ?? []);
  const reviewFiles = diff.filesForReview?.map(file => file.path) ?? diff.changedFiles;
  const contexts = resolveAvailableContexts(availableContexts);
  const dependencies = resolveAvailableDependencies(availableDependencies);

  return {
    repoRoot,
    config,
    configPath,
    configSource,
    projectRules,
    defaultBranch,
    mergeBase,
    diff,
    reviewFiles,
    availableContexts: contexts,
    availableDependencies: dependencies,
    prLabels,
    debug,
  };
}

export async function planLocalReview({
  cwd = process.cwd(),
  phase = 'midstream',
  dryRun = false,
  debug = false,
  preferredModelHint = 'balanced',
  availableContexts,
  availableDependencies,
  plannerMode,
} = {}) {
  const base = await collectLocalContext({
    cwd,
    debug,
    contextLines: debug ? 10 : 3,
    availableContexts,
    availableDependencies,
  });
  const {
    repoRoot,
    projectRules,
    defaultBranch,
    mergeBase,
    diff,
    reviewFiles,
    availableContexts: contexts,
    availableDependencies: dependencies,
    config,
    configPath,
    configSource,
    prLabels,
  } = base;
  const requestedPlannerMode = normalizePlannerMode(plannerMode ?? process.env.RIVER_PLANNER_MODE, {
    defaultMode: 'off',
  });
  const plannerRequested = requestedPlannerMode !== 'off';

  const { matched: ignoredLabels, shouldSkip } = shouldSkipByLabel(
    prLabels,
    config.exclude?.prLabelsToIgnore ?? [],
  );

  if (shouldSkip) {
    return {
      status: 'skipped-by-label',
      repoRoot,
      defaultBranch,
      mergeBase,
      projectRules,
      availableContexts: contexts,
      availableDependencies: dependencies,
      config,
      configPath,
      configSource,
      prLabels,
      matchedLabels: ignoredLabels,
    };
  }

  if (!reviewFiles.length) {
    return {
      status: 'no-changes',
      repoRoot,
      defaultBranch,
      mergeBase,
      projectRules,
      diff,
      availableContexts: contexts,
      availableDependencies: dependencies,
      config,
      configPath,
      configSource,
      prLabels,
    };
  }

  let planner = null;
  let plannerSkipped = null;
  if (plannerRequested) {
    if (dryRun) {
      plannerSkipped = 'dry-run enabled';
    } else if (!process.env.RIVER_OPENAI_API_KEY && !process.env.OPENAI_API_KEY) {
      plannerSkipped = 'OPENAI_API_KEY (or RIVER_OPENAI_API_KEY) not set';
    } else {
      planner = createOpenAIPlanner();
    }
  }

  const plan = await buildExecutionPlan({
    phase: normalizePhase(phase),
    changedFiles: reviewFiles,
    diffText: diff.diffText,
    availableContexts: contexts,
    availableDependencies: dependencies,
    preferredModelHint,
    planner: planner ?? undefined,
    plannerMode: requestedPlannerMode,
  });

  const plannerUsed = planner ? !plan.plannerFallback : false;
  const augmentedPlan = {
    ...plan,
    plannerRequested,
    plannerMode: plannerRequested ? requestedPlannerMode : 'off',
    plannerUsed,
    ...(plannerSkipped ? { plannerSkipped } : {}),
  };

  return {
    status: 'ok',
    repoRoot,
    defaultBranch,
    mergeBase,
    changedFiles: reviewFiles,
    plan: augmentedPlan,
    diff,
    projectRules,
    availableContexts: contexts,
    availableDependencies: dependencies,
    prLabels,
    config,
    configPath,
    configSource,
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
    availableContexts,
    availableDependencies,
    plannerMode,
  } = {},
) {
  const context =
    providedContext ??
    (await planLocalReview({
      cwd,
      phase,
      dryRun,
      debug,
      preferredModelHint,
      availableContexts,
      availableDependencies,
      plannerMode,
    }));
  if (context.status === 'no-changes') {
    return {
      status: 'no-changes',
      repoRoot: context.repoRoot,
      defaultBranch: context.defaultBranch,
      mergeBase: context.mergeBase,
      config: context.config,
      configPath: context.configPath,
      configSource: context.configSource,
      prLabels: context.prLabels,
    };
  }

  if (context.status === 'skipped-by-label') {
    return {
      status: 'skipped-by-label',
      reason: 'pr-label',
      matchedLabels: context.matchedLabels,
      repoRoot: context.repoRoot,
      defaultBranch: context.defaultBranch,
      mergeBase: context.mergeBase,
      availableContexts: context.availableContexts,
      availableDependencies: context.availableDependencies,
      config: context.config,
      configPath: context.configPath,
      configSource: context.configSource,
      prLabels: context.prLabels,
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
    config: context.config,
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
    availableContexts: context.availableContexts,
    availableDependencies: context.availableDependencies,
    prLabels: context.prLabels,
    config: context.config,
    configPath: context.configPath,
    configSource: context.configSource,
  };
}

export async function doctorLocalReview({
  cwd = process.cwd(),
  phase = 'midstream',
  debug = false,
  preferredModelHint = 'balanced',
  availableContexts,
  availableDependencies,
} = {}) {
  const skills = await loadSkills();
  const base = await collectLocalContext({
    cwd,
    debug,
    contextLines: debug ? 10 : 0,
    availableContexts,
    availableDependencies,
  });
  const { repoRoot, projectRules, defaultBranch, mergeBase, diff, reviewFiles, availableContexts: contexts, availableDependencies: dependencies } =
    base;

  const plan = reviewFiles.length
    ? await buildExecutionPlan({
        phase: normalizePhase(phase),
        changedFiles: reviewFiles,
        diffText: diff.diffText,
        availableContexts: contexts,
        availableDependencies: dependencies,
        preferredModelHint,
        skills,
      })
    : null;

  return {
    status: 'ok',
    repoRoot,
    defaultBranch,
    mergeBase,
    skillsCount: skills.length,
    projectRules,
    changedFiles: reviewFiles,
    plan,
    availableContexts: contexts,
    availableDependencies: dependencies,
    diff,
    config: base.config,
    configPath: base.configPath,
    configSource: base.configSource,
  };
}
