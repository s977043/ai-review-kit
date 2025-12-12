import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutionPlan } from '../src/lib/review-runner.mjs';

function findSkillInPlan(plan, id) {
  const selected = plan.selected.find(s => s.metadata?.id === id);
  if (selected) return { status: 'selected', reasons: [] };
  const skipped = plan.skipped.find(s => s.skill?.metadata?.id === id);
  if (skipped) return { status: 'skipped', reasons: skipped.reasons ?? [] };
  return { status: 'missing', reasons: [] };
}

test('upstream skill is gated by inputContext', async () => {
  const skillId = 'rr-upstream-api-design-001';
  const changedFiles = ['src/api/users.ts'];

  const withoutAdr = await buildExecutionPlan({
    phase: 'upstream',
    changedFiles,
    availableContexts: ['diff'],
  });
  assert.deepEqual(findSkillInPlan(withoutAdr, skillId), {
    status: 'skipped',
    reasons: ['missing required inputContext'],
  });

  const withAdr = await buildExecutionPlan({
    phase: 'upstream',
    changedFiles,
    availableContexts: ['diff', 'adr'],
  });
  assert.equal(findSkillInPlan(withAdr, skillId).status, 'selected');
});

test('downstream skills are gated by declared dependencies when enabled', async () => {
  const skillId = 'rr-downstream-coverage-gap-001';
  const changedFiles = ['src/app.ts'];
  const availableContexts = ['diff', 'tests'];

  const withoutDeps = await buildExecutionPlan({
    phase: 'downstream',
    changedFiles,
    availableContexts,
    availableDependencies: [],
  });
  assert.deepEqual(findSkillInPlan(withoutDeps, skillId), {
    status: 'skipped',
    reasons: ['missing dependencies: test_runner, coverage_report'],
  });

  const withDeps = await buildExecutionPlan({
    phase: 'downstream',
    changedFiles,
    availableContexts,
    availableDependencies: ['test_runner', 'coverage_report'],
  });
  assert.equal(findSkillInPlan(withDeps, skillId).status, 'selected');
});

