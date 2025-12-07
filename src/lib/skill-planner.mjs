import { rankByModelHint } from './review-runner.mjs';

/**
 * Summarize a skill's metadata for LLM consumption.
 * @param {import('./review-runner.mjs').SkillDefinition|import('./review-runner.mjs').SkillMetadata} skill
 */
export function summarizeSkill(skill) {
  const meta = skill?.metadata ?? skill;
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    phase: meta.phase,
    applyTo: meta.applyTo ?? [],
    inputContext: meta.inputContext ?? [],
    outputKind: meta.outputKind ?? ['findings'],
    modelHint: meta.modelHint ?? null,
    dependencies: meta.dependencies ?? [],
    tags: meta.tags ?? [],
    severity: meta.severity ?? null,
  };
}

/**
 * Plan skills using an LLM (or provided planner function). Falls back to deterministic ordering on error.
 * @param {Object} options
 * @param {Array} options.skills - candidate skills (already filtered)
 * @param {Object} options.context - review context (e.g., changedFiles/diff summary/prompt)
 * @param {Function} [options.llmPlan] - async function receiving {skills, context}, returning [{id, priority, reason}]
 * @returns {Promise<{planned: Array, reasons: Array, fallback: boolean}>}
 */
export async function planSkills({ skills, context, llmPlan }) {
  const summaries = skills.map(summarizeSkill);

  if (!llmPlan) {
    return {
      planned: rankByModelHint(skills),
      reasons: [],
      fallback: false,
    };
  }

  try {
    const plan = await llmPlan({ skills: summaries, context });
    const order = Array.isArray(plan) ? plan : [];
    const byId = new Map(summaries.map((summary, idx) => [summary.id, skills[idx]]));
    const planned = [];
    const reasons = [];

    for (const entry of order) {
      if (!entry?.id) continue;
      const candidate = byId.get(entry.id);
      if (candidate) {
        planned.push(candidate);
        if (entry.reason) reasons.push({ id: entry.id, reason: entry.reason });
        byId.delete(entry.id);
      }
    }

    // append any not referenced by LLM in deterministic order
    const remaining = rankByModelHint(Array.from(byId.values()));
    planned.push(...remaining);

    return { planned, reasons, fallback: false };
  } catch (err) {
    return {
      planned: rankByModelHint(skills),
      reasons: [{ id: 'fallback', reason: `planner error: ${err.message}` }],
      fallback: true,
    };
  }
}
