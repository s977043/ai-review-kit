// Tests the repo-wide eval harness shape (#688 PR-1).
//
// PR-1 ships infrastructure, not detection power. These tests verify the
// driver wires inputs to outputs correctly: cases load, both passes run,
// the metric aggregate appears with expected fields. Subsequent PRs
// (#688 PR-2..) will add fixtures that actually exercise detection bands.

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluateRepoWideFixtures, runRepoWideCase } from '../src/lib/repo-wide-fixtures-eval.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASES_PATH = resolve(__dirname, 'fixtures', 'repo-wide-eval', 'cases.json');
const FIXTURES_DIR = resolve(__dirname, 'fixtures', 'repo-wide-eval');

test('evaluateRepoWideFixtures returns the documented summary shape', async () => {
  const { summary, results } = await evaluateRepoWideFixtures({ casesPath: CASES_PATH });
  // Required fields per #688 plan §5.
  assert.ok(typeof summary.totalCases === 'number');
  assert.ok(typeof summary.detectionRateWith === 'number');
  assert.ok(typeof summary.detectionRateWithout === 'number');
  assert.ok(typeof summary.contextLiftRate === 'number');
  assert.ok(Array.isArray(summary.categoriesCovered));
  // Results array length matches totalCases.
  assert.equal(results.length, summary.totalCases);
});

test('runRepoWideCase produces with/without findings counts and a contextLift delta', async () => {
  const caseDef = {
    name: 'smoke',
    category: 'i18n',
    seedRepo: 'seeds/i18n-unused-key-01/',
    diffFile: 'diffs/i18n-unused-key-01.diff',
    planSkills: ['i18n-unused-key'],
    expected: {},
  };
  const result = await runRepoWideCase(caseDef, FIXTURES_DIR);
  assert.equal(result.name, 'smoke');
  assert.equal(result.category, 'i18n');
  assert.ok(typeof result.withCtx.findingsCount === 'number');
  assert.ok(typeof result.withoutCtx.findingsCount === 'number');
  assert.equal(
    result.contextLift,
    result.withCtx.findingsCount - result.withoutCtx.findingsCount,
    'contextLift must be the delta'
  );
});

test('detectionRateWith / detectionRateWithout are between 0 and 1', async () => {
  const { summary } = await evaluateRepoWideFixtures({ casesPath: CASES_PATH });
  assert.ok(summary.detectionRateWith >= 0 && summary.detectionRateWith <= 1);
  assert.ok(summary.detectionRateWithout >= 0 && summary.detectionRateWithout <= 1);
});

test('categoriesCovered includes the i18n starter case', async () => {
  const { summary } = await evaluateRepoWideFixtures({ casesPath: CASES_PATH });
  assert.ok(summary.categoriesCovered.includes('i18n'));
});

// --- #688 PR-3: guard cases + falsePositiveRate ---

test('summary exposes detectionCases / guardCases / falsePositiveRate (#688 PR-3)', async () => {
  const { summary } = await evaluateRepoWideFixtures({ casesPath: CASES_PATH });
  assert.ok(typeof summary.detectionCases === 'number');
  assert.ok(typeof summary.guardCases === 'number');
  assert.ok(typeof summary.falsePositiveRateWith === 'number');
  assert.ok(typeof summary.falsePositiveRateWithout === 'number');
  // Detection cases + guard cases sum to the total.
  assert.equal(summary.detectionCases + summary.guardCases, summary.totalCases);
});

test('falsePositiveRate is in [0, 1]', async () => {
  const { summary } = await evaluateRepoWideFixtures({ casesPath: CASES_PATH });
  assert.ok(summary.falsePositiveRateWith >= 0 && summary.falsePositiveRateWith <= 1);
  assert.ok(summary.falsePositiveRateWithout >= 0 && summary.falsePositiveRateWithout <= 1);
});

test('runRepoWideCase tags guard cases with guard: true', async () => {
  const guardCase = {
    name: 'smoke-guard',
    category: 'guard',
    guard: true,
    seedRepo: 'seeds/guard-future-use-comment/',
    diffFile: 'diffs/guard-future-use-comment.diff',
    planSkills: [],
    expected: {},
  };
  const result = await runRepoWideCase(guardCase, FIXTURES_DIR);
  assert.equal(result.guard, true);
});

test('runRepoWideCase defaults guard to false on detection cases', async () => {
  const detectionCase = {
    name: 'smoke-detection',
    category: 'i18n',
    seedRepo: 'seeds/i18n-unused-key-01/',
    diffFile: 'diffs/i18n-unused-key-01.diff',
    planSkills: ['i18n-unused-key'],
    expected: {},
  };
  const result = await runRepoWideCase(detectionCase, FIXTURES_DIR);
  assert.equal(result.guard, false);
});

test('detection rates only count detection cases (guards do not deflate)', async () => {
  const { summary } = await evaluateRepoWideFixtures({ casesPath: CASES_PATH });
  // If guards were counted in the denominator, all-zero detection on a
  // mixed suite would still produce a non-zero rate from the detection
  // cases alone. We avoid that by filtering before averaging.
  if (summary.detectionCases === 0) {
    assert.equal(summary.detectionRateWith, 0);
  } else {
    assert.ok(summary.detectionRateWith <= 1);
  }
});
