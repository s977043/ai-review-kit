// tests/generate-skill-catalog.test.mjs
//
// Skill catalog generator: multi-phase grouping.
//
// Regression: `groupByPhase` used to index a bucket object with
// `skill.metadata.phase` directly. That value is `string | string[]`, and an
// array used as a property key stringifies — `['upstream','midstream']` becomes
// the key `'upstream,midstream'`, which matches no bucket, so every genuinely
// multi-phase skill was dropped from the published catalog with no error. Ten
// skills were missing, including `river-review`, the entry point of the
// distributed agent-skill bundle.
//
// These tests cross-check against the PRODUCTION selector `matchesPhase`
// (runners/core/review-runner.mjs) rather than re-deriving phase membership
// here, so they cannot become self-consistent with a re-introduced bug.

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadSkills } from '../runners/core/skill-loader.mjs';
import { matchesPhase } from '../runners/core/review-runner.mjs';
import { groupByPhase } from '../scripts/generate-skill-catalog.mjs';

const PHASES = ['upstream', 'midstream', 'downstream'];

function fakeSkill(id, phase) {
  return { metadata: { id, phase } };
}

test('groupByPhase lists a multi-phase skill under every phase it activates in', () => {
  const grouped = groupByPhase([
    fakeSkill('multi', ['upstream', 'midstream']),
    fakeSkill('single', 'downstream'),
  ]);

  assert.deepEqual(
    grouped.upstream.map((s) => s.metadata.id),
    ['multi']
  );
  assert.deepEqual(
    grouped.midstream.map((s) => s.metadata.id),
    ['multi']
  );
  assert.deepEqual(
    grouped.downstream.map((s) => s.metadata.id),
    ['single']
  );
});

test('groupByPhase drops no skill: a three-phase skill appears in all three buckets', () => {
  const grouped = groupByPhase([fakeSkill('all', ['upstream', 'midstream', 'downstream'])]);
  for (const phase of PHASES) {
    assert.deepEqual(
      grouped[phase].map((s) => s.metadata.id),
      ['all'],
      `expected 'all' under ${phase}`
    );
  }
});

test('groupByPhase membership matches the production matchesPhase selector for every bundled skill', async () => {
  const skills = await loadSkills();
  const grouped = groupByPhase(skills);

  for (const phase of PHASES) {
    const listed = new Set(grouped[phase].map((s) => s.metadata.id));
    for (const skill of skills) {
      assert.equal(
        listed.has(skill.metadata.id),
        matchesPhase(skill, phase),
        `${skill.metadata.id} listed under ${phase} disagrees with matchesPhase`
      );
    }
  }
});

test('every bundled skill appears in at least one phase section', async () => {
  const skills = await loadSkills();
  const grouped = groupByPhase(skills);
  const listed = new Set(PHASES.flatMap((phase) => grouped[phase].map((s) => s.metadata.id)));

  const missing = skills.map((s) => s.metadata.id).filter((id) => !listed.has(id));
  assert.deepEqual(missing, [], `skills missing from the catalog: ${missing.join(', ')}`);
});
