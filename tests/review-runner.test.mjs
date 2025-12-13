import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSkills } from '../src/lib/skill-loader.mjs';
import { buildExecutionPlan, rankByModelHint, selectSkills } from '../src/lib/review-runner.mjs';

test('selects skills by phase and applyTo glob', async () => {
  const skills = await loadSkills();
  const { selected } = selectSkills(skills, {
    phase: 'midstream',
    changedFiles: ['src/app.ts'],
    availableContexts: ['diff'],
  });
  const ids = selected.map(s => s.metadata.id);
  assert.ok(ids.includes('rr-midstream-code-quality-sample-001'), 'midstream skill should be selected');
});

test('skips when required inputContext is missing', () => {
  const skills = [
    {
      metadata: {
        id: 'ctx-required',
        name: 'Needs ADR',
        description: 'requires ADR context',
        phase: 'midstream',
        applyTo: ['src/**/*.ts'],
        inputContext: ['adr'],
      },
    },
  ];
  const { selected, skipped } = selectSkills(skills, {
    phase: 'midstream',
    changedFiles: ['src/service.ts'],
    availableContexts: ['diff'],
  });
  assert.equal(selected.length, 0);
  assert.equal(skipped.length, 1);
  assert.ok(skipped[0].reasons.some(r => r.includes('missing')));
});

test('skips when dependencies are not available', () => {
  const skills = [
    {
      metadata: {
        id: 'needs-deps',
        name: 'Needs test runner',
        description: 'requires test runner',
        phase: 'midstream',
        applyTo: ['src/**/*.ts'],
        dependencies: ['test_runner'],
      },
    },
  ];
  const { selected, skipped } = selectSkills(skills, {
    phase: 'midstream',
    changedFiles: ['src/service.ts'],
    availableContexts: ['diff'],
    availableDependencies: [],
  });
  assert.equal(selected.length, 0);
  assert.equal(skipped.length, 1);
  assert.ok(skipped[0].reasons.some(r => r.includes('missing dependencies')));
});

test('selects when dependencies are available', () => {
  const skills = [
    {
      metadata: {
        id: 'needs-deps',
        name: 'Needs test runner',
        description: 'requires test runner',
        phase: 'midstream',
        applyTo: ['src/**/*.ts'],
        dependencies: ['test_runner'],
      },
    },
  ];
  const { selected, skipped } = selectSkills(skills, {
    phase: 'midstream',
    changedFiles: ['src/service.ts'],
    availableContexts: ['diff'],
    availableDependencies: ['test_runner'],
  });
  assert.equal(selected.length, 1);
  assert.equal(skipped.length, 0);
});

test('ranks skills using modelHint proximity', () => {
  const skills = [
    { metadata: { id: 'cheap', phase: 'midstream', applyTo: ['src/**'], modelHint: 'cheap' } },
    { metadata: { id: 'balanced', phase: 'midstream', applyTo: ['src/**'], modelHint: 'balanced' } },
    { metadata: { id: 'accurate', phase: 'midstream', applyTo: ['src/**'], modelHint: 'high-accuracy' } },
  ];
  const ordered = rankByModelHint(skills, 'high-accuracy').map(s => s.metadata.id);
  assert.deepEqual(ordered, ['accurate', 'balanced', 'cheap']);
});

test('buildExecutionPlan returns ordered selection and skipped list', async () => {
  const plan = await buildExecutionPlan({
    phase: 'midstream',
    changedFiles: ['src/app.ts'],
    availableContexts: ['diff'],
    preferredModelHint: 'balanced',
  });
  assert.ok(plan.selected.length >= 1);
  assert.ok(Array.isArray(plan.skipped));
});

test('buildExecutionPlan can use planner when provided', async () => {
  const providedSkills = [
    { metadata: { id: 'a', phase: 'midstream', applyTo: ['src/**'], modelHint: 'cheap' } },
    { metadata: { id: 'b', phase: 'midstream', applyTo: ['src/**'], modelHint: 'high-accuracy' } },
  ];
  const planner = {
    plan: async ({ skills }) => [
      { id: skills[1].id, reason: 'prefer b' },
      { id: skills[0].id, reason: 'then a' },
    ],
  };
  const plan = await buildExecutionPlan({
    phase: 'midstream',
    changedFiles: ['src/app.ts'],
    availableContexts: ['diff'],
    planner,
    skills: providedSkills,
  });
  const ids = plan.selected.map(s => s.metadata.id);
  assert.deepEqual(ids, ['b', 'a']);
  assert.equal(plan.plannerFallback, false);
});

test('buildExecutionPlan supports prune mode (planner-selected subset only)', async () => {
  const providedSkills = [
    { metadata: { id: 'a', phase: 'midstream', applyTo: ['src/**'], modelHint: 'cheap' } },
    { metadata: { id: 'b', phase: 'midstream', applyTo: ['src/**'], modelHint: 'high-accuracy' } },
    { metadata: { id: 'c', phase: 'midstream', applyTo: ['src/**'], modelHint: 'balanced' } },
  ];
  const planner = {
    plan: async () => [{ id: 'b', reason: 'only b' }],
  };
  const plan = await buildExecutionPlan({
    phase: 'midstream',
    changedFiles: ['src/app.ts'],
    availableContexts: ['diff'],
    planner,
    plannerMode: 'prune',
    skills: providedSkills,
  });
  const ids = plan.selected.map(s => s.metadata.id);
  assert.deepEqual(ids, ['b']);
  assert.equal(plan.plannerFallback, false);
  assert.equal(plan.plannerMode, 'prune');
});

test('buildExecutionPlan falls back when planner output is invalid in prune mode', async () => {
  const providedSkills = [
    { metadata: { id: 'a', phase: 'midstream', applyTo: ['src/**'], modelHint: 'cheap' } },
    { metadata: { id: 'b', phase: 'midstream', applyTo: ['src/**'], modelHint: 'high-accuracy' } },
  ];
  const planner = {
    plan: async () => [{ id: 'unknown', reason: 'bad id' }],
  };
  const plan = await buildExecutionPlan({
    phase: 'midstream',
    changedFiles: ['src/app.ts'],
    availableContexts: ['diff'],
    planner,
    plannerMode: 'prune',
    skills: providedSkills,
  });
  const ids = plan.selected.map(s => s.metadata.id);
  assert.deepEqual(ids, ['a', 'b']);
  assert.equal(plan.plannerFallback, true);
});
