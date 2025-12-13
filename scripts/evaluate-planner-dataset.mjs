#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { evaluatePlannerDataset } from '../src/lib/planner-dataset-eval.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  if (value.startsWith('-')) {
    throw new Error(`${flag} requires a value (got another flag: ${value})`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    datasetDir: null,
    out: null,
    json: false,
    excludedTags: null,
    preferredModelHint: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--json') {
      args.json = true;
      continue;
    }

    if (arg === '--dataset') {
      args.datasetDir = requireValue(argv, i, '--dataset');
      i++;
      continue;
    }

    if (arg === '--out') {
      args.out = requireValue(argv, i, '--out');
      i++;
      continue;
    }

    if (arg === '--excluded-tags') {
      const raw = requireValue(argv, i, '--excluded-tags');
      args.excludedTags = raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      i++;
      continue;
    }

    if (arg === '--model-hint') {
      args.preferredModelHint = requireValue(argv, i, '--model-hint');
      i++;
      continue;
    }

    if (!arg.startsWith('-') && !args.datasetDir) {
      args.datasetDir = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/evaluate-planner-dataset.mjs [datasetDir]
  node scripts/evaluate-planner-dataset.mjs --dataset <dir>

Options:
  --json                  Print JSON to stdout
  --out <file>            Write JSON output to file (implies --json)
  --excluded-tags <csv>   Override excluded tags (default is in evaluator)
  --model-hint <value>    Override preferred modelHint (default: balanced)
`);
    return;
  }

  const datasetDir =
    args.datasetDir ?? path.join(__dirname, '..', 'tests', 'fixtures', 'planner-dataset');
  const jsonMode = Boolean(args.json || args.out);

  const { summary, cases } = await evaluatePlannerDataset({
    datasetDir,
    ...(args.excludedTags != null && { excludedTags: args.excludedTags }),
    ...(args.preferredModelHint != null && { preferredModelHint: args.preferredModelHint }),
  });

  if (jsonMode) {
    const payload = {
      meta: {
        datasetDir,
      },
      summary,
      cases,
    };
    const text = JSON.stringify(payload, null, 2);
    console.log(text);

    if (args.out) {
      await fs.mkdir(path.dirname(args.out), { recursive: true });
      await fs.writeFile(args.out, text + '\n', 'utf8');
    }
    return;
  }

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
