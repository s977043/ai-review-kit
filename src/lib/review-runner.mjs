import { minimatch } from 'minimatch';
import { loadSkills } from './skill-loader.mjs';
import { planSkills, summarizeSkill } from './skill-planner.mjs';
import { inferImpactTags } from './impact-scope.mjs';
import { normalizePlannerMode } from './planner-utils.mjs';

const MODEL_PRIORITY = {
  cheap: 1,
  balanced: 2,
  'high-accuracy': 3,
};

function getMeta(skill) {
  return skill?.metadata ?? skill;
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function matchesPhase(skill, phase) {
  const meta = getMeta(skill);
  if (Array.isArray(meta.phase)) {
    return meta.phase.includes(phase);
  }
  return meta.phase === phase;
}

function matchesApplyTo(skill, changedFiles) {
  const meta = getMeta(skill);
  const globs = ensureArray(meta.applyTo);
  if (!globs.length) return false;
  return changedFiles.some(file => globs.some(pattern => minimatch(file, pattern, { dot: true })));
}

function missingInputContexts(skill, availableContexts) {
  const meta = getMeta(skill);
  if (!meta.inputContext || meta.inputContext.length === 0) return [];
  const available = new Set(availableContexts);
  return meta.inputContext.filter(ctx => !available.has(ctx));
}

function missingDependencies(skill, availableDependencies) {
  const meta = getMeta(skill);
  const deps = ensureArray(meta.dependencies);
  if (!deps.length) return [];
  if (availableDependencies == null) return [];
  const available = new Set(ensureArray(availableDependencies));
  return deps.filter(dep => !available.has(dep));
}

function evaluateSkill(skill, options) {
  const reasons = [];
  const meta = getMeta(skill);
  if (!matchesPhase(meta, options.phase)) {
    reasons.push(`phase mismatch: ${meta.phase} !== ${options.phase}`);
  }
  if (!matchesApplyTo(meta, options.changedFiles)) {
    reasons.push('applyTo did not match any changed file');
  }
  const missingContexts = missingInputContexts(meta, options.availableContexts);
  if (missingContexts.length) {
    reasons.push(`missing inputContext: ${missingContexts.join(', ')}`);
  }
  const depsMissing = missingDependencies(meta, options.availableDependencies);
  if (depsMissing.length) {
    reasons.push(`missing dependencies: ${depsMissing.join(', ')}`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
  };
}

export function selectSkills(skills, options) {
  const changedFiles = ensureArray(options.changedFiles);
  const availableContexts = ensureArray(options.availableContexts);
  const availableDependencies = options.availableDependencies ?? null;
  const selected = [];
  const skipped = [];

  for (const skill of skills) {
    const result = evaluateSkill(skill.metadata ?? skill, {
      phase: options.phase,
      changedFiles,
      availableContexts,
      availableDependencies,
    });
    if (result.ok) {
      selected.push(skill);
    } else {
      skipped.push({ skill, reasons: result.reasons });
    }
  }
  return { selected, skipped };
}

export function rankByModelHint(skills, preferredModelHint = 'balanced') {
  const preferredWeight = MODEL_PRIORITY[preferredModelHint] ?? MODEL_PRIORITY.balanced;
  const weight = hint => MODEL_PRIORITY[hint] ?? MODEL_PRIORITY.balanced;
  return [...skills].sort((a, b) => {
    const wa = Math.abs(weight(getMeta(a).modelHint) - preferredWeight);
    const wb = Math.abs(weight(getMeta(b).modelHint) - preferredWeight);
    if (wa !== wb) return wa - wb;
    return getMeta(a).id.localeCompare(getMeta(b).id);
  });
}

function computeTagScore(skill, impactTags) {
  if (!impactTags?.length) return 0;
  const tags = new Set(getMeta(skill).tags ?? []);
  let score = 0;
  for (const tag of impactTags) {
    if (tags.has(tag)) score += 1;
  }
  return score;
}

function rankByImpactTags(skills, impactTags, preferredModelHint = 'balanced') {
  const scores = new Map(skills.map(s => [getMeta(s).id, computeTagScore(s, impactTags)]));
  const anyMatched = Array.from(scores.values()).some(v => v > 0);
  if (!anyMatched) {
    return rankByModelHint(skills, preferredModelHint);
  }

  const preferredWeight = MODEL_PRIORITY[preferredModelHint] ?? MODEL_PRIORITY.balanced;
  const weight = hint => MODEL_PRIORITY[hint] ?? MODEL_PRIORITY.balanced;

  return [...skills].sort((a, b) => {
    const idA = getMeta(a).id;
    const idB = getMeta(b).id;
    const scoreA = scores.get(idA) ?? 0;
    const scoreB = scores.get(idB) ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;

    const wa = Math.abs(weight(getMeta(a).modelHint) - preferredWeight);
    const wb = Math.abs(weight(getMeta(b).modelHint) - preferredWeight);
    if (wa !== wb) return wa - wb;
    return idA.localeCompare(idB);
  });
}

/**
 * Build an execution plan from skills and review context.
 * - planner 未指定: メタデと modelHint に基づく決定論的な並び替え
 * - planner 指定: LLM 等で優先度決定し、エラー時は決定論的順序にフォールバック
 *   - plannerMode=order: 優先度づけ（未参照スキルは後ろに決定論で追加）
 *   - plannerMode=prune: 絞り込み（LLM が選んだスキルのみを実行）
 */
export async function buildExecutionPlan(options) {
  const {
    phase,
    changedFiles = [],
    availableContexts = [],
    availableDependencies = null,
    preferredModelHint = 'balanced',
    skills: providedSkills,
    planner,
    plannerMode,
    diffText,
  } = options;

  const skills = providedSkills ?? (await loadSkills());
  const selection = selectSkills(skills, {
    phase,
    changedFiles,
    availableContexts,
    availableDependencies,
  });
  if (selection.selected.length === 0) {
    return { selected: [], skipped: selection.skipped };
  }

  const impactTags = inferImpactTags(changedFiles, { diffText });

  // If planner is provided, try LLM-based planning, fallback to deterministic rank
  const effectivePlannerMode = planner ? normalizePlannerMode(plannerMode, { defaultMode: 'order' }) : 'off';
  if (planner && effectivePlannerMode !== 'off') {
    const context = {
      phase,
      changedFiles,
      availableContexts,
      impactTags,
    };
    const { planned, reasons, fallback } = await planSkills({
      skills: selection.selected,
      context,
      llmPlan: planner.plan ?? planner,
      appendRemaining: effectivePlannerMode !== 'prune',
    });
    const ranked = fallback ? rankByImpactTags(selection.selected, impactTags, preferredModelHint) : planned;
    return {
      selected: ranked,
      skipped: selection.skipped,
      plannerMode: effectivePlannerMode,
      plannerReasons: reasons,
      plannerFallback: fallback,
      ...(fallback ? { plannerError: reasons?.[0]?.reason ?? 'planner fallback' } : {}),
      impactTags,
    };
  }

  // planner が無い場合（LLM未設定）は決定論的順位付けで実行
  const ordered = rankByImpactTags(selection.selected, impactTags, preferredModelHint);

  return {
    selected: ordered,
    skipped: selection.skipped,
    impactTags,
  };
}

// Re-export summarizeSkill for consumers that want the same view used by planner
export { summarizeSkill };
