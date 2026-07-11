#!/usr/bin/env node
/**
 * Unified evaluation runner for River Review.
 *
 * Bundles planner:eval, eval:fixtures, severity gate, and meta-consistency
 * into a single invocation. Outputs a JSON envelope and optionally appends
 * to the experiment ledger at artifacts/evals/results.jsonl.
 *
 * Usage:
 *   node scripts/evaluate-all.mjs [options]
 *
 * Options:
 *   --gate-input <path>    Path to River Review JSON output for gate eval
 *   --append-ledger        Append result to artifacts/evals/results.jsonl
 *   --description <text>   Optional description for ledger entry
 *   --json                 Print result as JSON instead of human-readable
 *   --skip <name>          Skip a sub-eval (planner|fixtures|gate|meta|repo-context). Repeatable
 *   --persist-memory       Write eval result as Riverbed Memory entry
 *   -h, --help             Show help
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

import { isDirectRun } from './lib/is-direct-run.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** Minimum planner coverage to pass. Conservative initial baseline. */
const PLANNER_COVERAGE_THRESHOLD = 0.5;

/** Metric keys that represent 0-1 ratios (displayed as percentages). */
const RATIO_METRICS = new Set([
  'exactMatch',
  'top1Match',
  'coverage',
  'mrr',
  'passRate',
  'falsePositiveRate',
  'evidenceRate',
  'verifierRejectRate',
  'policyPassRate',
  'memoryRecallRate',
  'escalationAccuracy',
  'suppressionAccuracy',
  'resurfaceAccuracy',
  // #688 PR-4: repo-context eval ratio metrics
  'detectionRateWith',
  'detectionRateWithout',
  'contextLiftRate',
  'falsePositiveRateWith',
  'falsePositiveRateWithout',
]);

// --- arg parsing -----------------------------------------------------------

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    gateInput: null,
    appendLedger: false,
    description: '',
    json: false,
    skip: new Set(),
    persistMemory: false,
    help: false,
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === '--gate-input') {
      parsed.gateInput = args.shift() ?? null;
    } else if (arg === '--append-ledger') {
      parsed.appendLedger = true;
    } else if (arg === '--description') {
      parsed.description = args.shift() ?? '';
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--skip') {
      const name = args.shift();
      if (name) parsed.skip.add(name);
    } else if (arg === '--persist-memory') {
      parsed.persistMemory = true;
    } else if (arg === '-h' || arg === '--help') {
      parsed.help = true;
    }
  }

  return parsed;
}

// --- git helpers ------------------------------------------------------------

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function gitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// --- result helpers ---------------------------------------------------------

function errorResult(name, message) {
  return { name, pass: false, skipped: false, metrics: {}, errors: [message] };
}

function skipResult(name) {
  return { name, pass: true, skipped: true, metrics: {}, errors: [] };
}

// --- sub-eval runners -------------------------------------------------------

async function runPlannerEval() {
  const { evaluatePlanner } = await import('../src/lib/planner-eval.mjs');
  const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'planner-eval-cases.json');
  const data = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const cases = data.map((c) => ({
    ...c,
    llmPlan: async ({ skills, context }) =>
      c.llmPlan ?? c.plan ?? c.expectedOrder.map((id) => ({ id })),
    skills: c.skills,
    context: c.context,
  }));

  const { summary } = await evaluatePlanner(cases);

  return {
    name: 'planner',
    pass: summary.coverage >= PLANNER_COVERAGE_THRESHOLD,
    skipped: false,
    metrics: {
      exactMatch: summary.exactMatch,
      top1Match: summary.top1Match,
      coverage: summary.coverage,
      mrr: summary.mrr,
    },
    errors: [],
  };
}

// Symbol-keyed slot used to hand the full fixture-eval result + parsed
// cases.json from runFixturesEval() to the snapshot phase further down
// in main(). This avoids re-running evaluateReviewFixtures() purely to
// derive per-skill FP rates (see Issue #793).
const FIXTURES_RAW = Symbol('fixturesRaw');

async function runFixturesEval() {
  const { evaluateReviewFixtures } = await import('../src/lib/review-fixtures-eval.mjs');
  const casesPath = path.join(ROOT, 'tests', 'fixtures', 'review-eval', 'cases.json');

  let cases = null;
  try {
    cases = JSON.parse(fs.readFileSync(casesPath, 'utf-8'));
  } catch {
    // Leave cases as null; the snapshot phase will fall back to its
    // legacy disk-reading path if this happens (e.g. missing fixtures).
  }

  const result = await evaluateReviewFixtures({ casesPath, verbose: false });

  // Flatten top failure categories into metrics (preserves normalized result shape)
  const failureCats = result.summary.failuresByCategory ?? {};
  const topFailureMetrics = {};
  for (const [cat, count] of Object.entries(failureCats)) {
    topFailureMetrics[`fail_${cat}`] = count;
  }

  const sub = {
    name: 'fixtures',
    pass: result.exitCode === 0,
    skipped: false,
    metrics: {
      passRate: result.summary.passRate,
      falsePositiveRate: result.summary.falsePositiveRate,
      evidenceRate: result.summary.evidenceRate,
      ...topFailureMetrics,
    },
    errors: result.exitCode === 0 ? [] : ['One or more fixture checks failed'],
  };
  // Stash raw data on a Symbol property; consumers in main() unpack it
  // for getPerSkillFpRate, while existing scores/metrics iteration
  // (Object.entries) is unaffected.
  sub[FIXTURES_RAW] = cases ? { result, cases } : null;
  return sub;
}

export { FIXTURES_RAW };

async function runRepoContextEval() {
  // #688 PR-4: integrate the repo-wide eval harness landed in PR-1..3.
  // The eval harness is API-key-free (dryRun: true) so it is safe to
  // run as part of evaluate-all.mjs without secrets. Surfaces detection
  // / context-lift / false-positive rates as ratio metrics consumed by
  // the ledger downstream.
  const { evaluateRepoWideFixtures } = await import('../src/lib/repo-wide-fixtures-eval.mjs');
  const casesPath = path.join(ROOT, 'tests', 'fixtures', 'repo-wide-eval', 'cases.json');
  if (!fs.existsSync(casesPath)) {
    return skipResult('repo-context');
  }
  const result = await evaluateRepoWideFixtures({ casesPath });
  return {
    name: 'repo-context',
    // No hard pass/fail gate yet — the suite is for drift detection.
    // Failures from upstream regressions surface in the ledger Δ check
    // (see scripts/evaluate-all.mjs ledger append).
    pass: true,
    skipped: false,
    metrics: {
      detectionRateWith: result.summary.detectionRateWith,
      detectionRateWithout: result.summary.detectionRateWithout,
      contextLiftRate: result.summary.contextLiftRate,
      falsePositiveRateWith: result.summary.falsePositiveRateWith,
      falsePositiveRateWithout: result.summary.falsePositiveRateWithout,
      categoriesCovered: result.summary.categoriesCovered.length,
    },
    errors: [],
  };
}

async function runGateEval(inputPath) {
  const { evaluateGate } = await import('./evaluate-review-gate.mjs');
  const result = await evaluateGate({ input: inputPath });

  return {
    name: 'gate',
    pass: result.pass,
    skipped: false,
    metrics: {},
    errors: result.pass ? [] : [result.summary],
  };
}

async function runMetaValidation() {
  const { validateMeta } = await import('./validate-meta-consistency.mjs');
  const errors = await validateMeta();

  return {
    name: 'meta',
    pass: errors.length === 0,
    skipped: false,
    metrics: { errorCount: errors.length },
    errors,
  };
}

async function runRegressionEval() {
  const { evaluateRegression } = await import('../src/lib/regression-eval.mjs');
  const casesPath = path.join(ROOT, 'tests', 'fixtures', 'regression-eval', 'cases.json');
  const result = await evaluateRegression({ casesPath, verbose: false });
  return {
    name: 'regression',
    pass: result.exitCode === 0,
    skipped: false,
    metrics: {
      policyPassRate: result.summary.policyPassRate,
      memoryRecallRate: result.summary.memoryRecallRate,
      escalationAccuracy: result.summary.escalationAccuracy,
      suppressionAccuracy: result.summary.suppressionAccuracy,
      resurfaceAccuracy: result.summary.resurfaceAccuracy,
    },
    errors: result.exitCode === 0 ? [] : ['One or more regression checks failed'],
  };
}

// --- ledger -----------------------------------------------------------------

function appendLedger(entry) {
  const ledgerPath = path.join(ROOT, 'artifacts', 'evals', 'results.jsonl');
  const dir = path.dirname(ledgerPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
}

// --- main -------------------------------------------------------------------

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    console.log(`Usage: node scripts/evaluate-all.mjs [options]

Options:
  --gate-input <path>    Path to River Review JSON output for gate eval
  --append-ledger        Append result to artifacts/evals/results.jsonl
  --description <text>   Optional description for ledger entry
  --json                 Print result as JSON
  --skip <name>          Skip a sub-eval (planner|fixtures|gate|meta). Repeatable
  --persist-memory       Write eval result as Riverbed Memory entry
  -h, --help             Show help
`);
    return 0;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

  // Run independent evals in parallel; gate depends on --gate-input flag
  const parallel = [];
  if (!parsed.skip.has('planner')) {
    parallel.push(
      runPlannerEval().catch((err) => errorResult('planner', `Planner eval error: ${err.message}`))
    );
  }
  if (!parsed.skip.has('fixtures')) {
    parallel.push(
      runFixturesEval().catch((err) =>
        errorResult('fixtures', `Fixtures eval error: ${err.message}`)
      )
    );
  }
  if (!parsed.skip.has('regression')) {
    parallel.push(
      runRegressionEval().catch((err) =>
        errorResult('regression', `Regression eval error: ${err.message}`)
      )
    );
  }
  if (!parsed.skip.has('meta')) {
    parallel.push(
      runMetaValidation().catch((err) =>
        errorResult('meta', `Meta validation error: ${err.message}`)
      )
    );
  }
  if (!parsed.skip.has('repo-context')) {
    parallel.push(
      runRepoContextEval().catch((err) =>
        errorResult('repo-context', `Repo-context eval error: ${err.message}`)
      )
    );
  }

  const subResults = await Promise.all(parallel);

  // Gate requires --gate-input; handle separately
  if (!parsed.skip.has('gate') && parsed.gateInput) {
    const resolvedGateInput = path.resolve(parsed.gateInput);
    if (!fs.existsSync(resolvedGateInput)) {
      subResults.push(errorResult('gate', `Gate input file not found: ${parsed.gateInput}`));
    } else {
      try {
        subResults.push(await runGateEval(resolvedGateInput));
      } catch (err) {
        subResults.push(errorResult('gate', `Gate eval error: ${err.message}`));
      }
    }
  } else if (!parsed.skip.has('gate') && !parsed.gateInput) {
    subResults.push(skipResult('gate'));
  }

  // Build envelope
  const scores = {};
  for (const r of subResults) {
    for (const [k, v] of Object.entries(r.metrics)) {
      scores[`${r.name}_${k}`] = v;
    }
  }

  // Descriptive snapshots that travel with the ledger entry but do NOT
  // affect pass/fail. See src/lib/eval-snapshots.mjs.
  let snapshots;
  try {
    const { getSeverityDistribution, getTop1PerCase, getPerSkillFpRate } =
      await import('../src/lib/eval-snapshots.mjs');

    // Reuse the fixture-eval result captured by runFixturesEval() when
    // available, so getPerSkillFpRate() does not re-invoke
    // evaluateReviewFixtures(). Falls back to the legacy disk-loading
    // path when fixtures eval was skipped or the raw slot is empty.
    const fixturesSub = subResults.find((r) => r?.name === 'fixtures');
    const fixturesRaw = fixturesSub?.[FIXTURES_RAW] ?? null;

    const [severity, top1PerCase, perSkillFp] = await Promise.all([
      getSeverityDistribution(),
      getTop1PerCase(),
      fixturesRaw ? getPerSkillFpRate(fixturesRaw.result, fixturesRaw.cases) : getPerSkillFpRate(),
    ]);
    snapshots = { severity, top1PerCase, perSkillFp };
  } catch (err) {
    snapshots = { error: `snapshot collection failed: ${err.message}` };
  }

  const envelope = {
    version: pkg.version,
    timestamp: new Date().toISOString(),
    commit: gitCommit(),
    branch: gitBranch(),
    scores,
    snapshots,
    results: subResults
      .filter((r) => !r.skipped)
      .map((r) => ({
        name: r.name,
        pass: r.pass,
        errors: r.errors,
      })),
    status: subResults.every((r) => r.pass) ? 'pass' : 'fail',
    description: parsed.description || undefined,
  };

  if (parsed.json) {
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    console.log(`\n=== River Review Unified Evaluation ===`);
    console.log(`Commit: ${envelope.commit} (${envelope.branch})`);
    console.log(`Time:   ${envelope.timestamp}`);
    console.log(`Status: ${envelope.status.toUpperCase()}\n`);

    for (const r of subResults) {
      const icon = r.skipped ? 'SKIP' : r.pass ? 'PASS' : 'FAIL';
      console.log(`[${icon}] ${r.name}`);
      if (Object.keys(r.metrics).length) {
        for (const [k, v] of Object.entries(r.metrics)) {
          const display =
            typeof v === 'number' && RATIO_METRICS.has(k) ? `${(v * 100).toFixed(1)}%` : v;
          console.log(`       ${k}: ${display}`);
        }
      }
      if (r.errors.length) {
        for (const e of r.errors) {
          console.log(`       ! ${e}`);
        }
      }
    }

    console.log('');
  }

  if (parsed.appendLedger) {
    appendLedger(envelope);
    if (!parsed.json) {
      console.log(`Ledger entry appended to artifacts/evals/results.jsonl`);
    }
  }

  if (parsed.persistMemory) {
    try {
      const { appendEntry } = await import('../src/lib/riverbed-memory.mjs');
      const memoryPath = path.join(ROOT, '.river', 'memory', 'index.json');
      const entryId = `eval-${envelope.commit}-${Date.now()}`;
      appendEntry(memoryPath, {
        id: entryId,
        type: 'eval_result',
        title: `Eval run ${envelope.commit}`,
        content: JSON.stringify(envelope),
        metadata: {
          createdAt: envelope.timestamp,
          author: 'evaluate-all',
          tags: ['eval', envelope.status],
          summary: `${envelope.status}: ${Object.keys(envelope.scores).length} metrics`,
        },
      });
      if (!parsed.json) {
        console.log(`Memory entry ${entryId} persisted to .river/memory/index.json`);
      }
    } catch (err) {
      // Memory persistence is optional; don't fail the eval
      if (!parsed.json) {
        console.log(`Warning: failed to persist memory entry: ${err.message}`);
      }
    }
  }

  return envelope.status === 'pass' ? 0 : 1;
}

export { main as evaluateAll, parseArgs, appendLedger };

if (isDirectRun(import.meta.url)) {
  main()
    .then((code) => {
      if (typeof code === 'number' && code !== 0) {
        process.exitCode = code;
      }
    })
    .catch((err) => {
      console.error(`Unified eval error: ${err.message}`);
      process.exitCode = 1;
    });
}
