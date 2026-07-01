// Eval harness for repo-wide review regression fixtures (#688 PR-1).
//
// Mirrors src/lib/review-fixtures-eval.mjs but adds a 2-pass execution:
//   pass A: with collectRepoContext({ repoRoot: seedAbs }) -> repoContext
//   pass B: with repoContext: null
// The delta between the two surfaces "context lift" — how many additional
// findings (or guards) the repo-wide context pulls in. PR-1 ships the
// harness skeleton + one fixture so the metric pipeline is exercised end
// to end. Subsequent PRs (per the #688 plan §6) layer in more fixtures.
//
// PR-1 scope: 1 fixture, 1 driver, 1 npm script. No CI integration — that
// lands in PR-4.

import fs from 'node:fs';
import path from 'node:path';

import { collectRepoContext } from './repo-context.mjs';
import { parseUnifiedDiff } from './diff-processor.mjs';
import { generateReview } from './review-engine.mjs';

/**
 * Run a single fixture through both passes (with / without repo context).
 *
 * @param {object} caseDef - one entry from cases.json
 * @param {string} fixturesDir - directory containing diffs/ and seeds/
 * @returns {Promise<object>} per-case result with {name, withCtx, withoutCtx, contextLift}
 */
export async function runRepoWideCase(caseDef, fixturesDir) {
  const diffPath = path.resolve(fixturesDir, caseDef.diffFile);
  const diffText = fs.readFileSync(diffPath, 'utf8');
  const parsedDiff = parseUnifiedDiff(diffText);
  const seedRoot = path.resolve(fixturesDir, caseDef.seedRepo);

  const plan = {
    selected: (caseDef.planSkills ?? []).map((id) => ({ metadata: { id } })),
    skipped: [],
  };
  const diff = {
    diffText,
    files: parsedDiff.files,
    changedFiles: parsedDiff.files.map((f) => f.path).filter(Boolean),
  };

  // Pass A: with repo context collected from seedRoot.
  // Swallowing collectRepoContext errors here would mask environment
  // problems (missing seedRepo, broken rg, etc.) as "no findings" — which
  // is a wrong conclusion for an eval harness. Re-throw with context so
  // the failing case is obvious.
  let repoContext;
  try {
    repoContext = await collectRepoContext({
      changedFiles: diff.changedFiles,
      repoRoot: seedRoot,
    });
  } catch (err) {
    throw new Error(
      `collectRepoContext failed for case "${caseDef.name ?? '(unnamed)'}" ` +
        `(seedRoot=${seedRoot}): ${err?.message ?? err}`
    );
  }

  const reviewArgs = {
    diff,
    plan,
    phase: caseDef.phase ?? 'midstream',
    dryRun: true,
    includeFallback: false,
  };
  const withCtx = await generateReview({ ...reviewArgs, repoContext });
  const withoutCtx = await generateReview({ ...reviewArgs, repoContext: null });

  return {
    name: caseDef.name ?? '(unnamed)',
    category: caseDef.category ?? 'unknown',
    // PR-3 (#688): explicit guard flag promotes "no finding" from
    // "below detection threshold" to "expected outcome". Used by the
    // aggregate falsePositiveRate metric below. Backward-compatible:
    // omitted on should-detect cases.
    guard: caseDef.guard === true,
    withCtx: {
      findingsCount: withCtx.comments.length,
      mergedMessages: withCtx.comments.map((c) => c.message).join('\n'),
    },
    withoutCtx: {
      findingsCount: withoutCtx.comments.length,
      mergedMessages: withoutCtx.comments.map((c) => c.message).join('\n'),
    },
    contextLift: withCtx.comments.length - withoutCtx.comments.length,
    expected: caseDef.expected ?? {},
  };
}

/**
 * Run every case in cases.json and aggregate metrics.
 *
 * @param {{ casesPath: string }} opts
 * @returns {Promise<{ summary, results }>}
 */
export async function evaluateRepoWideFixtures({ casesPath }) {
  const resolvedCasesPath = path.resolve(casesPath);
  const fixturesDir = path.dirname(resolvedCasesPath);
  const cases = JSON.parse(fs.readFileSync(resolvedCasesPath, 'utf8'));

  const results = [];
  for (const c of cases) {
    results.push(await runRepoWideCase(c, fixturesDir));
  }

  // Metric aggregates per #688 plan §5.
  const totalCases = results.length;
  const detectionCases = results.filter((r) => !r.guard);
  const guardCases = results.filter((r) => r.guard);
  const detectedWith = detectionCases.filter((r) => r.withCtx.findingsCount > 0).length;
  const detectedWithout = detectionCases.filter((r) => r.withoutCtx.findingsCount > 0).length;
  const totalLift = detectionCases.reduce((sum, r) => sum + Math.max(0, r.contextLift), 0);
  // PR-3: false positives are guard cases that produced any finding.
  // We track separately for "with context" (the configuration that
  // matters in production) and "without context" so a regression that
  // only fires in one mode is visible.
  const fpWith = guardCases.filter((r) => r.withCtx.findingsCount > 0).length;
  const fpWithout = guardCases.filter((r) => r.withoutCtx.findingsCount > 0).length;
  // categories present (coverage check is binary across canonical categories)
  const categories = [...new Set(results.map((r) => r.category))];

  return {
    summary: {
      totalCases,
      detectionCases: detectionCases.length,
      guardCases: guardCases.length,
      // Detection rates only count should-detect cases so guard cases
      // do not artificially deflate the rate.
      detectionRateWith: detectionCases.length ? detectedWith / detectionCases.length : 0,
      detectionRateWithout: detectionCases.length ? detectedWithout / detectionCases.length : 0,
      // Positive when context helped detect more.
      contextLiftRate: detectionCases.length ? totalLift / detectionCases.length : 0,
      // False positive rates count guard cases that produced any finding.
      // 0 is the only acceptable steady-state value; any positive number
      // is a regression worth investigating.
      falsePositiveRateWith: guardCases.length ? fpWith / guardCases.length : 0,
      falsePositiveRateWithout: guardCases.length ? fpWithout / guardCases.length : 0,
      categoriesCovered: categories,
    },
    results,
  };
}
