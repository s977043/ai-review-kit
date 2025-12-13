import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSkills } from '../src/lib/skill-loader.mjs';
import { planSkills, summarizeSkill } from '../src/lib/skill-planner.mjs';

const mockContext = {
  phase: 'midstream',
  changedFiles: ['src/app.ts'],
  availableContexts: ['diff'],
};

test('summarizeSkill returns stable metadata shape', async () => {
  const [sample] = await loadSkills();
  const summary = summarizeSkill(sample);
  assert.equal(summary.id, sample.metadata.id);
  assert.ok(Array.isArray(summary.applyTo));
  assert.ok(Array.isArray(summary.outputKind));
  assert.ok(Array.isArray(summary.dependencies));
});

test('planSkills uses llmPlan ordering and reasons', async () => {
  const skills = await loadSkills();
  const llmPlan = async ({ skills: summaries }) => {
    return summaries.map((s, idx) => ({
      id: s.id,
      priority: idx,
      reason: `mock reason for ${s.id}`,
    }));
  };

  const { planned, reasons, fallback } = await planSkills({ skills, context: mockContext, llmPlan });
  assert.equal(planned.length, skills.length);
  assert.equal(reasons.length, skills.length);
  assert.equal(fallback, false);
  // first item should match first llmPlan entry
  assert.equal(planned[0].metadata.id, skills[0].metadata.id);
});

test('planSkills falls back on error', async () => {
  const skills = await loadSkills();
  const llmPlan = async () => {
    throw new Error('llm unavailable');
  };
  const { planned, fallback } = await planSkills({ skills, context: mockContext, llmPlan });
  assert.equal(planned.length, skills.length);
  assert.equal(fallback, true);
});

test('planSkills can prune when appendRemaining is false', async () => {
  const skills = await loadSkills();
  const target = skills[0].metadata.id;
  const llmPlan = async () => [{ id: target, priority: 0, reason: 'only this' }];
  const { planned, fallback } = await planSkills({
    skills,
    context: mockContext,
    llmPlan,
    appendRemaining: false,
  });
  assert.equal(fallback, false);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].metadata.id, target);
});
