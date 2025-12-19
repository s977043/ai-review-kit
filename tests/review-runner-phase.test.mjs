import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesPhase } from '../src/lib/review-runner.mjs';

const skillWithPhase = phase => ({
  metadata: { phase },
});

test('matchesPhase accepts single phase', () => {
  const skill = skillWithPhase('midstream');
  assert.equal(matchesPhase(skill, 'midstream'), true);
  assert.equal(matchesPhase(skill, 'downstream'), false);
});

test('matchesPhase accepts array phases', () => {
  const skill = skillWithPhase(['midstream', 'downstream']);
  assert.equal(matchesPhase(skill, 'midstream'), true);
  assert.equal(matchesPhase(skill, 'downstream'), true);
  assert.equal(matchesPhase(skill, 'upstream'), false);
});
