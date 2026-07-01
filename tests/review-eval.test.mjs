import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { parseUnifiedDiff } from '../src/lib/diff-processor.mjs';
import { generateReview } from '../src/lib/review-engine.mjs';
import { evaluateReviewFixtures } from '../src/lib/review-fixtures-eval.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

test('review eval fixtures keep must-include signals (heuristic path)', async () => {
  const casesPath = path.join(__dirname, 'fixtures', 'review-eval', 'cases.json');
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const fixturesDir = path.dirname(casesPath);

  for (const c of cases) {
    const diffPath = path.resolve(fixturesDir, c.diffFile);
    const diffText = fs.readFileSync(diffPath, 'utf8');
    const parsed = parseUnifiedDiff(diffText);
    const plan = {
      selected: (c.planSkills ?? []).map((id) => ({ metadata: { id } })),
      skipped: [],
    };
    const diff = {
      diffText,
      files: parsed.files,
      changedFiles: parsed.files.map((f) => f.path).filter(Boolean),
    };

    const result = await generateReview({
      diff,
      plan,
      phase: c.phase ?? 'midstream',
      dryRun: true,
      includeFallback: false,
    });

    assert.ok(result.debug.findingFormat.ok, `[${c.name}] invalid finding format`);

    const expectNoFindings = Boolean(c.expectNoFindings);
    const minFindings = Number.isFinite(c.minFindings) ? c.minFindings : expectNoFindings ? 0 : 1;
    const maxFindings = Number.isFinite(c.maxFindings) ? c.maxFindings : null;

    assert.ok(
      result.comments.length >= minFindings,
      `[${c.name}] expected at least ${minFindings} finding(s)`
    );
    if (typeof maxFindings === 'number') {
      assert.ok(
        result.comments.length <= maxFindings,
        `[${c.name}] too many findings: ${result.comments.length}`
      );
    }

    const merged = result.comments.map((x) => x.message).join('\n');
    for (const token of c.mustInclude ?? []) {
      assert.ok(merged.includes(token), `[${c.name}] missing token: ${token}`);
    }
  }
});

test('evaluateReviewFixtures returns structured result with exitCode, cases, and summary', async () => {
  const casesPath = path.join(__dirname, 'fixtures', 'review-eval', 'cases.json');
  const result = await evaluateReviewFixtures({ casesPath, verbose: false });

  // Top-level shape
  assert.equal(typeof result, 'object', 'result should be an object');
  assert.equal(typeof result.exitCode, 'number', 'exitCode should be a number');
  assert.ok(Array.isArray(result.cases), 'cases should be an array');
  assert.equal(typeof result.summary, 'object', 'summary should be an object');

  // Backward compatibility: exitCode is 0 or 1
  assert.ok(result.exitCode === 0 || result.exitCode === 1, 'exitCode should be 0 or 1');

  // Summary fields
  assert.equal(typeof result.summary.total, 'number');
  assert.equal(typeof result.summary.passed, 'number');
  assert.equal(typeof result.summary.failed, 'number');
  assert.equal(typeof result.summary.passRate, 'number');
  assert.equal(typeof result.summary.falsePositiveRate, 'number');
  assert.equal(typeof result.summary.evidenceRate, 'number');

  // passRate is between 0 and 1
  assert.ok(result.summary.passRate >= 0 && result.summary.passRate <= 1, 'passRate should be 0-1');
  assert.ok(
    result.summary.falsePositiveRate >= 0 && result.summary.falsePositiveRate <= 1,
    'falsePositiveRate should be 0-1'
  );
  assert.ok(
    result.summary.evidenceRate >= 0 && result.summary.evidenceRate <= 1,
    'evidenceRate should be 0-1'
  );

  // total = passed + failed
  assert.equal(result.summary.total, result.summary.passed + result.summary.failed);

  // cases array matches total
  assert.equal(
    result.cases.length,
    result.summary.total,
    'cases length should match summary total'
  );
});

test('evaluateReviewFixtures case results have correct shape', async () => {
  const casesPath = path.join(__dirname, 'fixtures', 'review-eval', 'cases.json');
  const result = await evaluateReviewFixtures({ casesPath, verbose: false });

  for (const c of result.cases) {
    assert.equal(typeof c.name, 'string', 'case name should be a string');
    assert.equal(typeof c.pass, 'boolean', 'case pass should be a boolean');
    assert.equal(typeof c.findingCount, 'number', 'findingCount should be a number');
    assert.ok(Array.isArray(c.mustIncludeHits), 'mustIncludeHits should be an array');
    assert.ok(Array.isArray(c.mustIncludeMisses), 'mustIncludeMisses should be an array');
    assert.equal(typeof c.isGuardCase, 'boolean', 'isGuardCase should be a boolean');
    assert.equal(typeof c.guardViolated, 'boolean', 'guardViolated should be a boolean');
  }

  // Guard cases should exist (we know the fixture data has some)
  const guardCases = result.cases.filter((c) => c.isGuardCase);
  assert.ok(guardCases.length > 0, 'should have at least one guard case');

  // Non-guard cases should exist too
  const nonGuardCases = result.cases.filter((c) => !c.isGuardCase);
  assert.ok(nonGuardCases.length > 0, 'should have at least one non-guard case');
});
