import fs from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { ConfigLoader } from '../config/loader.mjs';
import { hasSelection, resolveSelectionSkillIds } from './selection.mjs';
import { collectRepoDiff, renderDiffText } from './diff-processor.mjs';
import { generateReview } from './review-engine.mjs';
import { runReviewerOrchestration } from './reviewer-orchestrator.mjs';
import { detectDefaultBranch, ensureGitRepo, findMergeBase } from './git.mjs';
import { createOpenAIPlanner } from './openai-planner.mjs';
import { normalizePlannerMode, PHASES } from './planner-utils.mjs';
import { buildExecutionPlan } from '../../runners/core/review-runner.mjs';
import { loadProjectRules } from './rules.mjs';
import { loadRiskMap } from './risk-map.mjs';
import { loadReviewMemory } from './memory-context.mjs';
import { collectRepoContext } from './repo-context.mjs';
import { loadSkills } from '../../runners/core/skill-loader.mjs';
import {
  isLlmEnabled,
  isOfflineMode,
  parseList,
  resolveAvailableContexts as resolveAvailableContextsShared,
  resolveAvailableDependencies as resolveAvailableDependenciesShared,
} from './utils.mjs';
import { annotateFingerprints, computeFingerprint } from './finding-factory.mjs';
import { applySuppressions } from './suppression-apply.mjs';
import { computeStrictBlock } from './deterministic-gate.mjs';

function normalizePhase(phase) {
  const normalized = (phase || '').toLowerCase();
  if (PHASES.includes(normalized)) return normalized;
  return 'midstream';
}

const configLoader = new ConfigLoader();

function shouldExclude(filePath, patterns = []) {
  return patterns.some((pattern) => minimatch(filePath, pattern, { dot: true }));
}

function applyFileExclusions(diff, patterns = []) {
  if (!patterns.length) return diff;

  const changedFiles = (diff.changedFiles ?? []).filter(
    (filePath) => !shouldExclude(filePath, patterns)
  );
  const rawFiles = (diff.files ?? []).filter((file) => !shouldExclude(file.path, patterns));
  const optimizedFiles = (diff.filesForReview ?? diff.files ?? []).filter(
    (file) => !shouldExclude(file.path, patterns)
  );

  const rawDiffText = renderDiffText(rawFiles);
  const diffText = renderDiffText(optimizedFiles);
  const rawTokenEstimate = Math.ceil(rawDiffText.length / 4);
  const tokenEstimate = Math.ceil(diffText.length / 4);
  const reduction =
    rawTokenEstimate === 0
      ? 0
      : Math.max(0, Math.round(((rawTokenEstimate - tokenEstimate) / rawTokenEstimate) * 100));

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
    return pullRequestLabels.map((label) => label?.name).filter(Boolean);
  } catch {
    return [];
  }
}

async function resolvePullRequestBody() {
  // Explicit env wins (works for any runner / non-Action use).
  const envBody = process.env.RIVER_PR_BODY;
  if (envBody && envBody.trim()) return envBody;

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;

  try {
    const raw = await fs.readFile(eventPath, 'utf8');
    const event = JSON.parse(raw);
    const body = event?.pull_request?.body;
    return body && String(body).trim() ? String(body) : null;
  } catch {
    return null;
  }
}

function shouldSkipByLabel(prLabels = [], ignorePatterns = []) {
  if (!prLabels.length || !ignorePatterns.length) return { matched: [], shouldSkip: false };
  const normalizedLabels = prLabels.map((label) => label.toLowerCase());
  const matched = ignorePatterns.filter((pattern) => {
    const needle = pattern.toLowerCase();
    return normalizedLabels.some((label) => label.includes(needle));
  });
  return { matched, shouldSkip: matched.length > 0 };
}

// Re-export the shared helper under the legacy name so the rest of this
// module continues to call `resolveAvailableContexts(...)` unchanged.
// The single source of truth now lives in src/lib/utils.mjs and is also
// used by src/lib/review-plan.mjs (#802 Phase 3 A2-fix-1).
const resolveAvailableContexts = (inputContexts, options = {}) =>
  resolveAvailableContextsShared(inputContexts, options);

// The helper now lives in src/lib/utils.mjs; this thin wrapper preserves
// the legacy call sites inside this module unchanged.
const resolveAvailableDependencies = (inputDependencies) =>
  resolveAvailableDependenciesShared(inputDependencies);

async function collectLocalContext({
  cwd,
  debug = false,
  contextLines = 3,
  availableContexts,
  availableDependencies,
  baseRef = null,
} = {}) {
  const repoRoot = await ensureGitRepo(cwd);
  const { config, path: configPath, source: configSource } = await configLoader.load(repoRoot);
  const prLabels = await resolvePullRequestLabels();
  const prBody = await resolvePullRequestBody();
  const { rulesText: projectRules } = await loadProjectRules(repoRoot);
  const riskMap = await loadRiskMap(repoRoot);
  // When --base is provided, compare against the explicit ref instead of the
  // auto-detected default branch. Falls back to detection when unset.
  const defaultBranch = baseRef ?? (await detectDefaultBranch(repoRoot));
  const mergeBase = await findMergeBase(repoRoot, defaultBranch);
  const rawDiff = await collectRepoDiff(repoRoot, mergeBase, { contextLines });
  const diff = applyFileExclusions(rawDiff, config.exclude?.files ?? []);
  const reviewFiles = diff.filesForReview?.map((file) => file.path) ?? diff.changedFiles;
  // Expose `prDescription` as an available input context only when a PR body is
  // present, so the pr-description skill activates exactly when it has input.
  const contexts = resolveAvailableContexts(availableContexts, {
    alwaysInclude: prBody ? ['prDescription'] : [],
  });
  const dependencies = resolveAvailableDependencies(availableDependencies);

  return {
    repoRoot,
    config,
    configPath,
    configSource,
    projectRules,
    riskMap,
    defaultBranch,
    mergeBase,
    diff,
    reviewFiles,
    availableContexts: contexts,
    availableDependencies: dependencies,
    prLabels,
    prBody,
    debug,
  };
}

// --- テスト用 named export (内部ヘルパー) ---
export {
  normalizePhase,
  shouldExclude,
  shouldSkipByLabel,
  resolveAvailableContexts,
  resolveAvailableDependencies,
  resolvePullRequestBody,
};

export async function planLocalReview({
  cwd = process.cwd(),
  phase = 'midstream',
  dryRun = false,
  debug = false,
  preferredModelHint = 'balanced',
  availableContexts,
  availableDependencies,
  plannerMode,
  baseRef = null,
  skillIds = null,
  manualReviewMode = null,
} = {}) {
  const base = await collectLocalContext({
    cwd,
    debug,
    contextLines: debug ? 10 : 3,
    availableContexts,
    availableDependencies,
    baseRef,
  });
  const {
    repoRoot,
    projectRules,
    riskMap,
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
    prBody,
  } = base;
  const requestedPlannerMode = normalizePlannerMode(plannerMode ?? process.env.RIVER_PLANNER_MODE, {
    defaultMode: 'off',
  });
  const plannerRequested = requestedPlannerMode !== 'off';

  // Config-level selection (.river-review.yaml `selection`) supplies the
  // skill id list unless the CLI already provided one via --skill-set,
  // which takes precedence as the explicit per-run override (design §6).
  let effectiveSkillIds = skillIds;
  if (effectiveSkillIds == null && hasSelection(config.selection)) {
    effectiveSkillIds = await resolveSelectionSkillIds(config.selection, {});
  } else if (
    effectiveSkillIds == null &&
    config.selection &&
    !hasSelection(config.selection) &&
    (config.selection.skills?.exclude?.length ?? 0) > 0
  ) {
    console.warn(
      '⚠️  selection: skills.exclude has no effect without packs, tags, or skills.include; all skills remain eligible.'
    );
  }

  const { matched: ignoredLabels, shouldSkip } = shouldSkipByLabel(
    prLabels,
    config.exclude?.prLabelsToIgnore ?? []
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
  const llmEnabled = isLlmEnabled();

  if (plannerRequested) {
    if (dryRun) {
      plannerSkipped = 'dry-run enabled';
    } else if (!llmEnabled) {
      plannerSkipped = isOfflineMode()
        ? 'offline (rules-only) mode enabled'
        : 'AI API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY) not set';
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
    dryRun,
    llmEnabled,
    repoRoot,
    riskMap,
    skillIds: effectiveSkillIds,
    manualReviewMode,
    specDirs: config.review?.specDirs ?? [],
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
    prBody,
    config,
    configPath,
    configSource,
  };
}

export async function runLocalReview({
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
  reviewers,
  baseRef = null,
  skillIds = null,
  manualReviewMode = null,
} = {}) {
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
      baseRef,
      skillIds,
      manualReviewMode,
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

  const memoryContext = loadReviewMemory(context.repoRoot, {
    phase: normalizePhase(phase),
    changedFiles: context.changedFiles,
  });

  const repoContext = await collectRepoContext({
    changedFiles: context.changedFiles,
    repoRoot: path.resolve(context.repoRoot),
    security: context.config?.security,
    context: context.config?.context,
  }).catch(() => null);

  const reviewArgs = {
    diff: context.diff,
    plan: context.plan,
    phase: normalizePhase(phase),
    dryRun,
    model,
    apiKey,
    projectRules: context.projectRules,
    riskAssessment: context.plan?.riskAssessment ?? null,
    memoryContext,
    fileTypes: context.plan?.fileTypes,
    relatedADRs: context.plan?.relatedADRs,
    reviewMode: context.plan?.reviewMode,
    repoContext,
    prBody: context.prBody,
    config: context.config,
  };

  const review = reviewers?.length
    ? await runReviewerOrchestration({ ...reviewArgs, reviewers })
    : await generateReview(reviewArgs);

  // #687 PR-C: gate findings by Riverbed Memory suppressions.
  // Run AFTER fingerprint annotation so applySuppressions sees the canonical
  // 16-hex fingerprint produced by computeFingerprint(). Bypassed when
  // config.memory.suppressionEnabled === false (see suppression-apply.mjs).
  const annotatedFindings = annotateFingerprints(review.findings ?? []);
  const {
    keptFindings,
    suppressedFindings,
    applied: suppressionsApplied,
  } = applySuppressions(annotatedFindings, memoryContext, { config: context.config });

  // Epic #1347 S4 (#1351): deterministic strict_block gate. Computed over the
  // PRE-suppression finding set joined with the selected skills so a suppressed
  // deterministic block still forces the gate — a suppression must not be a
  // strict_block bypass (fail-safe, mirroring SKIPPED_BY_POLICY).
  const { strictBlock } = computeStrictBlock({
    findings: annotatedFindings,
    selected: context.plan?.selected ?? [],
  });

  // Comments and findings are 1:1 in review-engine.mjs (`findings =
  // comments.map(...)`). When a finding is suppressed, the corresponding
  // PR comment must also be filtered — otherwise the suppressed finding
  // still surfaces verbatim in the review thread, defeating the entire
  // point of the suppression. Match by fingerprint computed from the
  // comment's own fields so this stays robust if the 1:1 ordering ever
  // drifts.
  const suppressedFingerprints = new Set(
    suppressedFindings.map((f) => f.fingerprint).filter(Boolean)
  );
  const reviewComments = review.comments ?? [];
  const keptComments =
    suppressedFingerprints.size === 0
      ? reviewComments
      : reviewComments.filter((c) => {
          const fp = computeFingerprint({
            ruleId: c.skillId || 'unknown',
            file: c.file,
            message: c.message,
          });
          return !suppressedFingerprints.has(fp);
        });

  return {
    status: 'ok',
    // Gate fail-safe input (Epic #1347 S2 review M1): dry-run skips the LLM,
    // so a clean diff scores a vacuous auto-approve — the gate must not read
    // that as CONVERGED_CLEAN.
    dryRun: dryRun === true,
    // Epic #1347 S4 (#1351): deterministic strict_block signal for the gate.
    // deriveRunGate forwards this to deriveGateDecision → unconditional NO_GO.
    strictBlock,
    repoRoot: path.resolve(context.repoRoot),
    defaultBranch: context.defaultBranch,
    mergeBase: context.mergeBase,
    changedFiles: context.changedFiles,
    plan: context.plan,
    reviewMode: context.plan?.reviewMode ?? 'medium',
    diffText: context.diff.diffText,
    files: context.diff.filesForReview ?? context.diff.files,
    comments: keptComments,
    findings: keptFindings,
    suppressedFindings,
    classified: review.classified,
    reviewerResults: review.reviewerResults ?? null,
    teamLeadReport: review.teamLeadReport ?? null,
    tokenEstimate: context.diff.tokenEstimate,
    rawTokenEstimate: context.diff.rawTokenEstimate,
    reduction: context.diff.reduction,
    prompt: review.prompt,
    reviewDebug: {
      ...(review.debug ?? {}),
      suppressionsApplied,
      // #692 PR-C: surface redaction telemetry without leaking the
      // pre-redaction text. `redactionHits` is a small {category, count}
      // tally; raw context never appears here.
      ...(repoContext?.redactionHits?.length || repoContext?.excludedPaths?.length
        ? {
            repoContextSecurity: {
              redactionHits: repoContext?.redactionHits ?? [],
              excludedPaths: repoContext?.excludedPaths ?? [],
            },
          }
        : {}),
      // #689 PR-C: ranking + budget telemetry. Only emitted when the
      // collector actually used these signals so no-op runs stay clean.
      ...(repoContext?.ranking || repoContext?.tokenBudget
        ? {
            repoContextRanking: repoContext?.ranking ?? null,
            repoContextTokenBudget: repoContext?.tokenBudget ?? null,
          }
        : {}),
    },
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
  const {
    repoRoot,
    projectRules,
    defaultBranch,
    mergeBase,
    diff,
    reviewFiles,
    availableContexts: contexts,
    availableDependencies: dependencies,
  } = base;

  const llmEnabled = isLlmEnabled();

  const plan = reviewFiles.length
    ? await buildExecutionPlan({
        phase: normalizePhase(phase),
        changedFiles: reviewFiles,
        diffText: diff.diffText,
        availableContexts: contexts,
        availableDependencies: dependencies,
        preferredModelHint,
        skills,
        llmEnabled,
        repoRoot,
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
