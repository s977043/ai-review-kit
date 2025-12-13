#!/usr/bin/env node
import path from 'node:path';
import url from 'node:url';
import { evaluatePlannerDataset } from '../src/lib/planner-dataset-eval.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const datasetDir = process.argv[2] ?? path.join(__dirname, '..', 'tests', 'fixtures', 'planner-dataset');

async function main() {
  const { summary, cases } = await evaluatePlannerDataset({ datasetDir });

  console.log('Planner dataset evaluation summary:');
  console.log(`- cases: ${summary.cases}`);
  console.log(`- coverage(avg): ${(summary.coverage * 100).toFixed(1)}%`);
  console.log(`- top1Match(avg): ${(summary.top1Match * 100).toFixed(1)}% (cases: ${summary.top1MatchCases})`);
  console.log('\nDetails:');

  for (const c of cases) {
    const expected = c.expectedAny.join(',');
    const top1Expected = c.expectedTop1.length ? c.expectedTop1.join(',') : '(n/a)';
    const top1Status = c.top1Match == null ? 'n/a' : c.top1Match ? 'ok' : 'ng';
    const top5 = c.selectedIds.slice(0, 5).join(',');
    const missing = c.missingExpected.length ? ` missing=${c.missingExpected.join(',')}` : '';
    console.log(
      `* ${c.name}: top1=${c.top1 ?? '-'} (${top1Status}; expectedTop1=${top1Expected}) coverage=${(
        c.coverage * 100
      ).toFixed(0)}% expectedAny=${expected}`
    );
    console.log(`  selected(top5)=${top5}${missing}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
