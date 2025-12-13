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
    compare: null,
    report: false,
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

    if (arg === '--report') {
      args.report = true;
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

    if (arg === '--compare') {
      args.compare = requireValue(argv, i, '--compare');
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
  --report                Print aggregated report (text mode only)
  --out <file>            Write JSON output to file (implies --json)
  --compare <file>        Compare with baseline JSON output
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

  const compareBaseline = args.compare ? await readJsonFile(args.compare) : null;
  const comparison = compareBaseline ? compareEvaluations(compareBaseline, { summary, cases }) : null;

  if (jsonMode) {
    const payload = {
      meta: {
        datasetDir,
      },
      summary,
      cases,
      ...(comparison ? { comparison } : {}),
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

  if (comparison) {
    console.log('\nComparison (vs baseline):');
    console.log(`- baseline: ${args.compare}`);
    console.log(
      `- coverage(avg): ${(comparison.baseline.summary.coverage * 100).toFixed(1)}% -> ${(
        comparison.current.summary.coverage * 100
      ).toFixed(1)}% (Δ ${(comparison.delta.summary.coverage * 100).toFixed(1)}pp)`
    );
    console.log(
      `- top1Match(avg): ${(comparison.baseline.summary.top1Match * 100).toFixed(1)}% -> ${(
        comparison.current.summary.top1Match * 100
      ).toFixed(1)}% (Δ ${(comparison.delta.summary.top1Match * 100).toFixed(1)}pp)`
    );
    console.log(
      `- case changes: improved=${comparison.delta.caseCounts.improved} regressed=${comparison.delta.caseCounts.regressed} changed=${comparison.delta.caseCounts.changed} unchanged=${comparison.delta.caseCounts.unchanged}`
    );
    if (comparison.delta.addedCases.length) {
      console.log(`- added cases: ${comparison.delta.addedCases.join(', ')}`);
    }
    if (comparison.delta.removedCases.length) {
      console.log(`- removed cases: ${comparison.delta.removedCases.join(', ')}`);
    }
  }

  if (args.report) {
    console.log('\nReport:');
    printReport({ summary, cases });
  }
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

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function compareEvaluations(baseline, current) {
  const normalize = value => ({
    summary: value?.summary ?? {},
    cases: value?.cases ?? [],
  });

  const base = normalize(baseline);
  const curr = normalize(current);

  const baseByName = new Map(base.cases.map(c => [c.name, c]));
  const currByName = new Map(curr.cases.map(c => [c.name, c]));
  const allNames = new Set([...baseByName.keys(), ...currByName.keys()]);

  const addedCases = [];
  const removedCases = [];
  const changedCases = [];
  let improved = 0;
  let regressed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const name of [...allNames].sort()) {
    const b = baseByName.get(name);
    const c = currByName.get(name);
    if (!b) {
      addedCases.push(name);
      continue;
    }
    if (!c) {
      removedCases.push(name);
      continue;
    }

    const top1Changed = (b.top1 ?? null) !== (c.top1 ?? null);
    const coverageChanged = Math.abs((b.coverage ?? 0) - (c.coverage ?? 0)) > 1e-9;
    const top1MatchChanged = (b.top1Match ?? null) !== (c.top1Match ?? null);
    const missingChanged = (b.missingExpected ?? []).join(',') !== (c.missingExpected ?? []).join(',');
    const anyChanged = top1Changed || coverageChanged || top1MatchChanged || missingChanged;

    if (!anyChanged) {
      unchanged++;
      continue;
    }

    changed++;
    if (b.top1Match === 0 && c.top1Match === 1) improved++;
    if (b.top1Match === 1 && c.top1Match === 0) regressed++;

    changedCases.push({
      name,
      before: pickCaseFields(b),
      after: pickCaseFields(c),
    });
  }

  return {
    baseline: base,
    current: curr,
    delta: {
      summary: {
        coverage: (curr.summary.coverage ?? 0) - (base.summary.coverage ?? 0),
        top1Match: (curr.summary.top1Match ?? 0) - (base.summary.top1Match ?? 0),
      },
      caseCounts: { improved, regressed, changed, unchanged },
      addedCases,
      removedCases,
      changedCases,
    },
  };
}

function pickCaseFields(c) {
  return {
    top1: c.top1 ?? null,
    top1Match: c.top1Match ?? null,
    coverage: c.coverage ?? null,
    missingExpected: c.missingExpected ?? [],
    selectedIds: c.selectedIds ?? [],
    expectedTop1: c.expectedTop1 ?? [],
    expectedAny: c.expectedAny ?? [],
  };
}

function printReport({ summary, cases }) {
  const top1Counts = countBy(cases, c => c.top1 ?? '(none)');
  const casesWithExpectedTop1 = cases.filter(c => (c.expectedTop1 ?? []).length > 0);
  const mismatches = casesWithExpectedTop1.filter(c => c.top1Match === 0);
  const mismatchTop1Counts = countBy(mismatches, c => c.top1 ?? '(none)');

  console.log(`- cases: ${summary.cases}`);
  console.log(`- top1Match cases: ${summary.top1MatchCases}`);
  console.log(`- top1 mismatches: ${mismatches.length}`);

  console.log('\nTop1 distribution (all cases):');
  for (const [key, count] of top1Counts) {
    console.log(`- ${key}: ${count}`);
  }

  if (mismatches.length) {
    console.log('\nTop1 distribution (mismatches only):');
    for (const [key, count] of mismatchTop1Counts) {
      console.log(`- ${key}: ${count}`);
    }

    console.log('\nMismatch details:');
    for (const c of mismatches) {
      console.log(
        `- ${c.name}: top1=${c.top1 ?? '-'} expectedTop1=${(c.expectedTop1 ?? []).join(',') || '(n/a)'} selectedTop3=${(
          c.selectedIds ?? []
        )
          .slice(0, 3)
          .join(',')}`
      );
    }
  }

  const missingExpectedCases = cases.filter(c => (c.missingExpected ?? []).length > 0);
  if (missingExpectedCases.length) {
    console.log('\nCases with missing expectedAny:');
    for (const c of missingExpectedCases) {
      console.log(`- ${c.name}: missing=${(c.missingExpected ?? []).join(',')}`);
    }
  }
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}
