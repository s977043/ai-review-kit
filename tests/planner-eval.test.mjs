import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { evaluatePlanner } from '../src/lib/planner-eval.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'planner-eval-cases.json'), 'utf8'));

const revived = cases.map(c => ({
  ...c,
  llmPlan: async () => c.plan,
}));

test('evaluatePlanner aggregates simple metrics', async () => {
  const { summary, cases: results } = await evaluatePlanner(revived);
  assert.strictEqual(summary.cases, 2);
  // case1 exact match、case2 は top1 違いで exact 0
  assert.ok(summary.exactMatch < 1 && summary.exactMatch > 0);
  // coverage はどちらも全要素含む
  assert.strictEqual(summary.coverage, 1);
  // MRR は 1 と 0.5 の平均
  assert.strictEqual(Number(summary.mrr.toFixed(3)), 0.75);
  assert.strictEqual(results[0].plannedIds[0], 'code-quality');
});
