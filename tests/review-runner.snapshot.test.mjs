import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExecutionPlan } from '../runners/core/review-runner.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = path.join(repoRoot, 'tests', 'fixtures', 'execution-plan-midstream.json');
const watchedSkippedIds = new Set([
  'review-policy-standard-midstream',
  'review-policy-standard-upstream',
  'review-policy-standard-downstream',
  'typescript-strict',
  'api-design',
]);

async function loadSnapshot() {
  const raw = await fs.readFile(snapshotPath, 'utf8');
  return JSON.parse(raw);
}

function summarizePlan(plan) {
  return {
    selected: plan.selected.map((s) => ({
      id: s.metadata.id,
      phase: s.metadata.phase,
      modelHint: s.metadata.modelHint ?? null,
      outputKind: s.metadata.outputKind,
      dependencies: s.metadata.dependencies ?? [],
    })),
    skippedWatched: plan.skipped
      .filter((entry) => watchedSkippedIds.has(entry.skill.metadata.id))
      .map((entry) => ({
        id: entry.skill.metadata.id,
        reasons: entry.reasons,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
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
