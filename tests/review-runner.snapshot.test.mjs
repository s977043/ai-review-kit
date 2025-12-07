import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildExecutionPlan } from '../src/lib/review-runner.mjs';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const snapshotPath = path.join(repoRoot, 'tests', 'fixtures', 'execution-plan-midstream.json');

async function loadSnapshot() {
  const raw = await fs.readFile(snapshotPath, 'utf8');
  return JSON.parse(raw);
}

function summarizePlan(plan) {
  return {
    selected: plan.selected.map(s => ({
      id: s.metadata.id,
      phase: s.metadata.phase,
      modelHint: s.metadata.modelHint ?? null,
      outputKind: s.metadata.outputKind,
      dependencies: s.metadata.dependencies ?? [],
    })),
    skipped: plan.skipped.map(entry => ({
      id: entry.skill.metadata.id,
      reasons: entry.reasons,
    })),
  };
}

test('execution plan for midstream diff matches snapshot', async () => {
  const plan = await buildExecutionPlan({
    phase: 'midstream',
    changedFiles: ['src/app.ts'],
    availableContexts: ['diff'],
    preferredModelHint: 'balanced',
  });
  const summarized = summarizePlan(plan);
  const snapshot = await loadSnapshot();
  assert.deepEqual(summarized, snapshot);
});
