import { minimatch } from 'minimatch';
import { loadSkills } from './skill-loader.mjs';

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
  return meta.phase === phase;
}

function matchesApplyTo(skill, changedFiles) {
  const meta = getMeta(skill);
  const globs = ensureArray(meta.applyTo);
  if (!globs.length) return false;
  return changedFiles.some(file => globs.some(pattern => minimatch(file, pattern, { dot: true })));
}

function hasRequiredContext(skill, availableContexts) {
  const meta = getMeta(skill);
  if (!meta.inputContext || meta.inputContext.length === 0) return true;
  const available = new Set(availableContexts);
  return meta.inputContext.every(ctx => available.has(ctx));
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
  if (!hasRequiredContext(meta, options.availableContexts)) {
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
    const wa = Math.abs(weight(getMeta(a).modelHint) - preferredWeight);
    const wb = Math.abs(weight(getMeta(b).modelHint) - preferredWeight);
    if (wa !== wb) return wa - wb;
    return getMeta(a).id.localeCompare(getMeta(b).id);
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
