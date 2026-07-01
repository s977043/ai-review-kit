import fs from 'node:fs';
import path from 'node:path';

import { parseUnifiedDiff } from './diff-processor.mjs';
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
 * Categorize a fixture failure based on the check context.
 * @param {{ token?: string, isGuardCase?: boolean, findingCount?: number, minFindings?: number, maxFindings?: number | null }} ctx
 * @returns {{ category: string, description: string }}
 */
function categorizeFailure(ctx) {
  // Guard case produced findings → false positive
  if (ctx.isGuardCase && ctx.findingCount > 0) {
    return { category: 'false_positive', description: 'guard case produced findings' };
  }

  // No findings when some were expected → routing miss
  if (ctx.findingCount === 0 && ctx.minFindings > 0) {
    return {
      category: 'routing_miss',
      description: `expected at least ${ctx.minFindings} findings, got 0`,
    };
  }

  // Too many findings → weak explanation
  if (ctx.maxFindings != null && ctx.findingCount > ctx.maxFindings) {
    return { category: 'weak_explanation', description: `too many findings: ${ctx.findingCount}` };
  }

  // Missing mustInclude token categorization
  if (ctx.token != null) {
    if (ctx.token === 'Evidence:') {
      return { category: 'missing_evidence', description: `missing token: ${ctx.token}` };
    }
    if (ctx.token.includes('Severity:')) {
      return { category: 'severity_mismatch', description: `missing token: ${ctx.token}` };
    }
    return { category: 'missing_context', description: `missing token: ${ctx.token}` };
  }

  // Fallback
  return { category: 'missing_context', description: 'unclassified failure' };
}

/**
 * Evaluate review fixtures (must_include checks).
 * @param {{
 *   casesPath: string
 *   phase?: string | null
 *   verbose?: boolean
 * }} options
 * @returns {Promise<{
 *   exitCode: number,
 *   cases: Array<{
 *     name: string,
 *     pass: boolean,
 *     findingCount: number,
 *     mustIncludeHits: string[],
 *     mustIncludeMisses: string[],
 *     isGuardCase: boolean,
 *     guardViolated: boolean,
 *     failures: Array<{ category: string, description: string }>,
 *   }>,
 *   summary: {
 *     total: number,
 *     passed: number,
 *     failed: number,
 *     passRate: number,
 *     falsePositiveRate: number,
 *     evidenceRate: number,
 *     failuresByCategory: Record<string, number>,
 *   }
 * }>}
 */
export async function evaluateReviewFixtures({ casesPath, phase = null, verbose = false }) {
  const resolvedCasesPath = path.resolve(casesPath);
  const fixturesDir = path.dirname(resolvedCasesPath);
  const cases = JSON.parse(fs.readFileSync(resolvedCasesPath, 'utf8'));

  const failures = [];
  const caseResults = [];
  let guardCaseCount = 0;
  let falsePositiveCount = 0;
  let totalFindingCount = 0;
  let evidenceHitCount = 0;

  for (const c of cases) {
    const name = c.name ?? '(unnamed case)';
    const diffPath = path.resolve(fixturesDir, c.diffFile);
    const diffText = fs.readFileSync(diffPath, 'utf8');
    const parsedDiff = parseUnifiedDiff(diffText);
    const plan = {
      selected: (c.planSkills ?? []).map((id) => ({ metadata: { id } })),
      skipped: [],
    };
    const diff = {
      diffText,
      files: parsedDiff.files,
      changedFiles: parsedDiff.files.map((f) => f.path).filter(Boolean),
    };

    const result = await generateReview({
      diff,
      plan,
      phase: phase ?? c.phase ?? 'midstream',
      dryRun: true,
      includeFallback: false,
    });

    const merged = result.comments.map((x) => x.message).join('\n');
    const expectNoFindings = Boolean(c.expectNoFindings);
    const isGuardCase = expectNoFindings;
    const minFindings = Number.isFinite(c.minFindings) ? c.minFindings : expectNoFindings ? 0 : 1;
    const maxFindings = Number.isFinite(c.maxFindings) ? c.maxFindings : null;

    // Track guard case metrics
    if (isGuardCase) {
      guardCaseCount++;
      if (result.comments.length > 0) {
        falsePositiveCount++;
      }
    }

    // Track evidence metrics across all findings
    totalFindingCount += result.comments.length;
    for (const comment of result.comments) {
      if (comment.message.includes('Evidence:')) {
        evidenceHitCount++;
      }
    }

    // Track mustInclude hits and misses
    const mustIncludeTokens = c.mustInclude ?? [];
    const mustIncludeHits = mustIncludeTokens.filter((token) => merged.includes(token));
    const mustIncludeMisses = mustIncludeTokens.filter((token) => !merged.includes(token));

    const checks = [
      expect(
        result.debug?.findingFormat?.ok !== false,
        name,
        'skill output format is invalid (missing labels or invalid Severity/Confidence)'
      ),
      expect(
        result.comments.length >= minFindings,
        name,
        `expected at least ${minFindings} findings, got ${result.comments.length}`
      ),
      maxFindings == null
        ? null
        : expect(
            result.comments.length <= maxFindings,
            name,
            `too many findings: ${result.comments.length}`
          ),
    ].filter(Boolean);

    for (const token of mustIncludeTokens) {
      checks.push(expect(merged.includes(token), name, `missing token: ${token}`));
    }

    const caseFailures = checks.filter(Boolean);
    const casePassed = caseFailures.length === 0;
    failures.push(...caseFailures);

    // Categorize failures for this case
    const categorizedFailures = [];
    if (!casePassed) {
      // Guard case false positive
      if (isGuardCase && result.comments.length > 0) {
        categorizedFailures.push(
          categorizeFailure({ isGuardCase: true, findingCount: result.comments.length })
        );
      }
      // No findings when expected
      if (result.comments.length === 0 && minFindings > 0) {
        categorizedFailures.push(categorizeFailure({ findingCount: 0, minFindings }));
      }
      // Too many findings
      if (maxFindings != null && result.comments.length > maxFindings && !isGuardCase) {
        categorizedFailures.push(
          categorizeFailure({ findingCount: result.comments.length, maxFindings })
        );
      }
      // Missing mustInclude tokens
      for (const token of mustIncludeMisses) {
        categorizedFailures.push(categorizeFailure({ token }));
      }
    }

    caseResults.push({
      name,
      pass: casePassed,
      findingCount: result.comments.length,
      mustIncludeHits,
      mustIncludeMisses,
      isGuardCase,
      guardViolated: isGuardCase && result.comments.length > 0,
      failures: categorizedFailures,
    });

    if (verbose) {
      console.log(
        caseFailures.length
          ? formatFailure(name, `${caseFailures.length} checks failed`)
          : formatSuccess(name)
      );
      if (caseFailures.length) {
        caseFailures.forEach((line) => console.log(`  ${line}`));
      }
    } else {
      console.error(
        caseFailures.length ? formatFailure(name, caseFailures[0]) : formatSuccess(name)
      );
    }
  }

  const failedCaseCount = caseResults.filter((r) => !r.pass).length;

  // Aggregate failure categories
  const failuresByCategory = {};
  for (const cr of caseResults) {
    for (const f of cr.failures) {
      failuresByCategory[f.category] = (failuresByCategory[f.category] ?? 0) + 1;
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} fixture checks failed.`);
  } else {
    console.error('\nAll review fixtures passed.');
  }

  return {
    exitCode: failures.length ? 1 : 0,
    cases: caseResults,
    summary: {
      total: cases.length,
      passed: cases.length - failedCaseCount,
      failed: failedCaseCount,
      passRate: cases.length > 0 ? (cases.length - failedCaseCount) / cases.length : 0,
      falsePositiveRate: guardCaseCount > 0 ? falsePositiveCount / guardCaseCount : 0,
      evidenceRate: totalFindingCount > 0 ? evidenceHitCount / totalFindingCount : 0,
      failuresByCategory,
    },
  };
}

export { categorizeFailure };
