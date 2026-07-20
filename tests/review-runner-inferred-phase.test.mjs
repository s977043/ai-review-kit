// #1565 Stage 1 (observe) — inferredPhase snapshot carry-over is additive only.
//
// Guards the invariant that recording `snapshot.inferredPhase` does NOT change
// phase / skill selection. The inferred phase is measurement-only
// (`applied: false`); the actual `phase` argument still drives selection.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { buildExecutionPlan } from '../runners/core/review-runner.mjs';

function fakeSkills() {
  return [
    {
      metadata: {
        id: 'fake-midstream-001',
        name: 'Fake midstream',
        description: 'fixture skill',
        phase: 'midstream',
        applyTo: ['src/**/*.ts'],
        inputContext: ['diff'],
        severity: 'minor',
        outputKind: ['findings'],
      },
    },
    {
      metadata: {
        id: 'fake-upstream-001',
        name: 'Fake upstream',
        description: 'fixture skill',
        phase: 'upstream',
        applyTo: ['src/**/*.ts'],
        inputContext: ['diff'],
        severity: 'minor',
        outputKind: ['findings'],
      },
    },
  ];
}

function idsOf(skills) {
  return skills.map((s) => s.metadata?.id ?? s.id).sort();
}

describe('buildExecutionPlan #1565 — inferredPhase snapshot carry-over', () => {
  test('snapshot exposes inferredPhase with applied:false and a reason', async () => {
    const plan = await buildExecutionPlan({
      phase: 'midstream',
      changedFiles: ['docs/adr/001.md'],
      availableContexts: ['diff'],
      skills: fakeSkills(),
      diffText: '',
      dryRun: false,
      llmEnabled: true,
    });
    assert.ok(plan.snapshot?.inferredPhase, 'snapshot.inferredPhase should exist');
    const { inferredPhase } = plan.snapshot;
    assert.equal(inferredPhase.applied, false, 'observe mode must not apply the inferred phase');
    assert.equal(inferredPhase.phase, 'upstream', 'docs-only diff should infer upstream');
    assert.equal(typeof inferredPhase.reason, 'string');
    assert.ok(inferredPhase.reason.length > 0, 'reason must be recorded for later audit');
  });

  test('selection follows the explicit phase, NOT the inferred phase (behavior unchanged)', async () => {
    // Baseline: identical inputs WITHOUT any inference leak — an app diff infers
    // midstream and phase is midstream, so the midstream skill is selected and
    // the upstream skill is skipped on phase mismatch. Inference is additive and
    // must not change which ids land in selected/skipped.
    const plan = await buildExecutionPlan({
      phase: 'midstream',
      changedFiles: ['src/app.ts'],
      availableContexts: ['diff'],
      skills: fakeSkills(),
      diffText: '',
      dryRun: false,
      llmEnabled: true,
    });
    assert.deepEqual(
      idsOf(plan.selected),
      ['fake-midstream-001'],
      'only the midstream skill should be selected under phase=midstream'
    );
    const skippedIds = plan.skipped.map((entry) => entry.skill.metadata?.id ?? entry.skill.id);
    assert.ok(
      skippedIds.includes('fake-upstream-001'),
      'the upstream skill must be skipped (phase mismatch), not promoted by inference'
    );
  });

  test('inferred upstream (docs-only) does NOT promote the upstream skill', async () => {
    // docs-only diff infers `upstream`, but phase is `midstream`. If inference
    // leaked into selection the upstream skill could be picked. It must not be:
    // selection stays driven by phase=midstream, so the upstream skill is never
    // selected.
    const plan = await buildExecutionPlan({
      phase: 'midstream',
      changedFiles: ['docs/adr/001.md'],
      availableContexts: ['diff'],
      skills: fakeSkills(),
      diffText: '',
      dryRun: false,
      llmEnabled: true,
    });
    assert.equal(plan.snapshot.inferredPhase.phase, 'upstream');
    assert.ok(
      !idsOf(plan.selected).includes('fake-upstream-001'),
      'the upstream skill must not be promoted by inference'
    );
  });

  test('adding inferredPhase does not disturb the other documented snapshot fields', async () => {
    const plan = await buildExecutionPlan({
      phase: 'midstream',
      changedFiles: ['src/app.ts'],
      availableContexts: ['diff'],
      skills: fakeSkills(),
      diffText: '',
      dryRun: false,
      llmEnabled: true,
    });
    for (const key of ['fileTypes', 'relatedADRs', 'reviewMode', 'riskAssessment', 'testImpact']) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(plan.snapshot, key),
        `plan.snapshot.${key} should still be present`
      );
    }
    // app diff -> inferred midstream, still not applied.
    assert.equal(plan.snapshot.inferredPhase.phase, 'midstream');
    assert.equal(plan.snapshot.inferredPhase.applied, false);
  });
});
