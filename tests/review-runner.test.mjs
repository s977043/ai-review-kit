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
