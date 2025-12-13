import assert from 'node:assert';
import path from 'node:path';
import url from 'node:url';
import { test } from 'node:test';
import { evaluatePlannerDataset } from '../src/lib/planner-dataset-eval.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

test('evaluatePlannerDataset loads fixture cases', async () => {
  const datasetDir = path.join(__dirname, 'fixtures', 'planner-dataset');
  const { summary, cases } = await evaluatePlannerDataset({ datasetDir });
  assert.ok(summary.cases >= 10);
  assert.strictEqual(cases.length, summary.cases);
  assert.ok(cases.every(c => typeof c.name === 'string' && c.name.length > 0));
});

