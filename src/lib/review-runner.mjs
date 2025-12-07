import { minimatch } from 'minimatch';
import { loadSkills } from './skill-loader.mjs';

const MODEL_PRIORITY = {
  cheap: 1,
  balanced: 2,
  'high-accuracy': 3,
};

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function matchesPhase(skill, phase) {
  return skill.phase === phase;
}

function matchesApplyTo(skill, changedFiles) {
  const globs = ensureArray(skill.applyTo);
  if (!globs.length) return false;
  return changedFiles.some(file => globs.some(pattern => minimatch(file, pattern, { dot: true })));
}

function hasRequiredContext(skill, availableContexts) {
  if (!skill.inputContext || skill.inputContext.length === 0) return true;
  const available = new Set(availableContexts);
  return skill.inputContext.every(ctx => available.has(ctx));
}

function evaluateSkill(skill, options) {
  const reasons = [];
  if (!matchesPhase(skill, options.phase)) {
    reasons.push(`phase mismatch: ${skill.phase} !== ${options.phase}`);
  }
  if (!matchesApplyTo(skill, options.changedFiles)) {
    reasons.push('applyTo did not match any changed file');
  }
  if (!hasRequiredContext(skill, options.availableContexts)) {
    reasons.push('missing required inputContext');
  }
  return {
    ok: reasons.length === 0,
    reasons,
  };
}

export function selectSkills(skills, options) {
  const changedFiles = ensureArray(options.changedFiles);
  const availableContexts = ensureArray(options.availableContexts);
  const selected = [];
  const skipped = [];

  for (const skill of skills) {
    const result = evaluateSkill(skill.metadata ?? skill, {
      phase: options.phase,
      changedFiles,
      availableContexts,
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
    const wa = Math.abs(weight(a.metadata?.modelHint ?? a.modelHint) - preferredWeight);
    const wb = Math.abs(weight(b.metadata?.modelHint ?? b.modelHint) - preferredWeight);
    if (wa !== wb) return wa - wb;
    return (a.metadata?.id ?? a.id).localeCompare(b.metadata?.id ?? b.id);
  });
}

export async function buildExecutionPlan(options) {
  const {
    phase,
    changedFiles = [],
    availableContexts = [],
    preferredModelHint = 'balanced',
    skills: providedSkills,
  } = options;

  const skills = providedSkills ?? (await loadSkills());
  const selection = selectSkills(skills, { phase, changedFiles, availableContexts });
  const ordered = rankByModelHint(selection.selected, preferredModelHint);

  return {
    selected: ordered,
    skipped: selection.skipped,
  };
}
