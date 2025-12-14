import fs from 'node:fs';
import path from 'node:path';

import { parseUnifiedDiff } from './diff.mjs';
import { generateReview } from './review-engine.mjs';

function formatFailure(name, message) {
  return `[FAIL] ${name}: ${message}`;
}

function formatSuccess(name) {
  return `[PASS] ${name}`;
}

function expect(condition, name, message) {
  if (condition) return null;
  return formatFailure(name, message);
}

/**
 * Evaluate review fixtures (must_include checks).
 * @param {{
 *   casesPath: string
 *   phase?: string | null
 *   verbose?: boolean
 * }} options
 */
export async function evaluateReviewFixtures({ casesPath, phase = null, verbose = false }) {
  const resolvedCasesPath = path.resolve(casesPath);
  const fixturesDir = path.dirname(resolvedCasesPath);
  const cases = JSON.parse(fs.readFileSync(resolvedCasesPath, 'utf8'));

  const failures = [];
  for (const c of cases) {
    const name = c.name ?? '(unnamed case)';
    const diffPath = path.resolve(fixturesDir, c.diffFile);
    const diffText = fs.readFileSync(diffPath, 'utf8');
    const parsedDiff = parseUnifiedDiff(diffText);
    const plan = {
      selected: (c.planSkills ?? []).map(id => ({ metadata: { id } })),
      skipped: [],
    };
    const diff = {
      diffText,
      files: parsedDiff.files,
      changedFiles: parsedDiff.files.map(f => f.path).filter(Boolean),
    };

    const result = await generateReview({
      diff,
      plan,
      phase: phase ?? c.phase ?? 'midstream',
      dryRun: true,
      includeFallback: false,
    });

    const merged = result.comments.map(x => x.message).join('\n');
    const expectNoFindings = Boolean(c.expectNoFindings);
    const minFindings = Number.isFinite(c.minFindings) ? c.minFindings : expectNoFindings ? 0 : 1;
    const maxFindings = Number.isFinite(c.maxFindings) ? c.maxFindings : null;

    const checks = [
      expect(
        result.debug?.findingFormat?.ok !== false,
        name,
        'skill output format is invalid (missing labels or invalid Severity/Confidence)',
      ),
      expect(
        result.comments.length >= minFindings,
        name,
        `expected at least ${minFindings} findings, got ${result.comments.length}`,
      ),
      maxFindings == null
        ? null
        : expect(result.comments.length <= maxFindings, name, `too many findings: ${result.comments.length}`),
    ].filter(Boolean);

    for (const token of c.mustInclude ?? []) {
      checks.push(expect(merged.includes(token), name, `missing token: ${token}`));
    }

    const caseFailures = checks.filter(Boolean);
    failures.push(...caseFailures);

    if (verbose) {
      console.log(caseFailures.length ? formatFailure(name, `${caseFailures.length} checks failed`) : formatSuccess(name));
      if (caseFailures.length) {
        caseFailures.forEach(line => console.log(`  ${line}`));
      }
    } else {
      console.log(caseFailures.length ? formatFailure(name, caseFailures[0]) : formatSuccess(name));
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} fixture checks failed.`);
    return 1;
  }

  console.log('\nAll review fixtures passed.');
  return 0;
}
