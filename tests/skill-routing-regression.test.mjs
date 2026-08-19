import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutionPlan } from '../runners/core/review-runner.mjs';
import { resolveAvailableDependencies } from '../src/lib/utils.mjs';

/** Run `fn` with RIVER_DEPENDENCY_STUBS set to `stubs` and no explicit list. */
function withDependencyEnv({ stubs }, fn) {
  const previousStubs = process.env.RIVER_DEPENDENCY_STUBS;
  const previousList = process.env.RIVER_AVAILABLE_DEPENDENCIES;
  try {
    if (stubs === undefined) delete process.env.RIVER_DEPENDENCY_STUBS;
    else process.env.RIVER_DEPENDENCY_STUBS = stubs;
    delete process.env.RIVER_AVAILABLE_DEPENDENCIES;
    return fn();
  } finally {
    if (previousStubs === undefined) delete process.env.RIVER_DEPENDENCY_STUBS;
    else process.env.RIVER_DEPENDENCY_STUBS = previousStubs;
    if (previousList === undefined) delete process.env.RIVER_AVAILABLE_DEPENDENCIES;
    else process.env.RIVER_AVAILABLE_DEPENDENCIES = previousList;
  }
}

function findSkillInPlan(plan, id) {
  const selected = plan.selected.find((s) => s.metadata?.id === id);
  if (selected) return { status: 'selected', reasons: [] };
  const skipped = plan.skipped.find((s) => s.skill?.metadata?.id === id);
  if (skipped) return { status: 'skipped', reasons: skipped.reasons ?? [] };
  return { status: 'missing', reasons: [] };
}

test('upstream skill is gated by inputContext', async () => {
  const skillId = 'dr-multiregion';
  const changedFiles = ['docs/adr/0001-example.adr'];

  const withoutAdr = await buildExecutionPlan({
    phase: 'upstream',
    changedFiles,
    availableContexts: ['diff'],
  });
  assert.deepEqual(findSkillInPlan(withoutAdr, skillId), {
    status: 'skipped',
    reasons: ['missing inputContext: adr'],
  });

  const withAdr = await buildExecutionPlan({
    phase: 'upstream',
    changedFiles,
    availableContexts: ['diff', 'adr'],
  });
  assert.equal(findSkillInPlan(withAdr, skillId).status, 'selected');
});

test('downstream skills are gated by declared dependencies when enabled', async () => {
  const skillId = 'coverage-gap';
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

// #1921: `RIVER_DEPENDENCY_STUBS=1` used to be the only code path that could ADD
// a skip. The stub list mirrored only the closed enum branch of
// schemas/skill.schema.json $defs.dependency and ignored its `^custom:.+`
// branch, so a skill declaring `custom:github` was SKIPPED with stubs ON while
// being selected with dependency gating off.
//
// The expected values below are hand-written from the skill's own frontmatter
// (skills/midstream/gh-address-comments/SKILL.md declares
// `dependencies: [custom:github]`), not derived from the implementation.
//
// The assertion deliberately goes through buildExecutionPlan: checking only
// resolveAvailableDependencies() stays green even if the review-runner half of
// the fix (expanding the `custom:*` sentinel in missingDependencies) is lost.
test('RIVER_DEPENDENCY_STUBS=1 satisfies custom: dependencies through the plan', async () => {
  const skillId = 'gh-address-comments';
  const planOptions = {
    phase: 'midstream',
    changedFiles: ['src/foo.mjs'],
    availableContexts: ['diff'],
  };

  // Both paths are resolved through the real env-reading entry point rather
  // than from literal arrays, so a change to resolveAvailableDependencies that
  // leaks the stub set into the stub-OFF path also fails here.
  const stubOff = withDependencyEnv({ stubs: undefined }, () => resolveAvailableDependencies(null));
  const stubOn = withDependencyEnv({ stubs: '1' }, () => resolveAvailableDependencies(null));
  assert.equal(stubOff, null, 'with stubs off, dependency gating must stay disabled (null)');

  // Baseline: dependency gating disabled — the skill is selected.
  const ungated = await buildExecutionPlan({ ...planOptions, availableDependencies: stubOff });
  assert.equal(findSkillInPlan(ungated, skillId).status, 'selected');

  // Exact dependency supplied — selected.
  const explicit = await buildExecutionPlan({
    ...planOptions,
    availableDependencies: ['custom:github'],
  });
  assert.equal(findSkillInPlan(explicit, skillId).status, 'selected');

  const stubbed = await buildExecutionPlan({
    ...planOptions,
    availableDependencies: stubOn,
  });
  assert.deepEqual(findSkillInPlan(stubbed, skillId), { status: 'selected', reasons: [] });

  // The gate itself still bites: an empty dependency list still skips, with the
  // exact reason string the skill's declaration produces.
  const gated = await buildExecutionPlan({ ...planOptions, availableDependencies: [] });
  assert.deepEqual(findSkillInPlan(gated, skillId), {
    status: 'skipped',
    reasons: ['missing dependencies: custom:github'],
  });

  // Reverse pin: turning stubs ON must not change the plan relative to the
  // stub-off path. Before the fix these differed (13 with stubs vs 14 without);
  // 14 is the hand-written expected count for THIS input, measured on the
  // stub-off path, which the stub path must now match exactly.
  assert.equal(ungated.selected.length, 14, 'stub-off baseline count changed — re-measure');
  assert.equal(
    stubbed.selected.length,
    ungated.selected.length,
    'RIVER_DEPENDENCY_STUBS must never remove a skill the ungated plan selects'
  );
});
