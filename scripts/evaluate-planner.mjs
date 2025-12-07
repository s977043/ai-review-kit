#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import url from 'url';
import { evaluatePlanner } from '../src/lib/planner-eval.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath =
  process.argv[2] ?? path.join(__dirname, '..', 'tests', 'fixtures', 'planner-eval-cases.json');

async function main() {
  const raw = fs.readFileSync(fixturePath, 'utf-8');
  const data = JSON.parse(raw);
  // revive llmPlan by wrapping provided plan array (offline eval用)
  const cases = data.map(c => ({
    ...c,
    llmPlan: async ({ skills, context }) => c.llmPlan ?? c.plan ?? c.expectedOrder.map(id => ({ id })),
    skills: c.skills,
    context: c.context,
  }));

  const { summary, cases: results } = await evaluatePlanner(cases);
  console.log('Planner evaluation summary:');
  console.log(`- cases: ${summary.cases}`);
  console.log(`- exactMatch: ${(summary.exactMatch * 100).toFixed(1)}%`);
  console.log(`- top1Match: ${(summary.top1Match * 100).toFixed(1)}%`);
  console.log(`- coverage: ${(summary.coverage * 100).toFixed(1)}%`);
  console.log(`- MRR: ${summary.mrr.toFixed(3)}`);
  console.log('\nDetails:');
  for (const r of results) {
    console.log(
      `* ${r.name}: expected=${r.expected.join(',')} planned=${r.plannedIds.join(',')} top1=${r.top1Match} coverage=${r.coverage.toFixed(
        2
      )}`
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
