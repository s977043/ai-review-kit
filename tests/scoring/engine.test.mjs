import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAxis,
  computeAxisScores,
  computeOverallScore,
  countBySeverity,
  deriveVerdict,
  resolveVerdict,
  scoreReview,
} from '../../src/lib/scoring/engine.mjs';

describe('classifyAxis', () => {
  it('classifies security findings by ruleId keyword', () => {
    assert.equal(classifyAxis({ ruleId: 'rr-mid-security-sql-injection' }), 'security');
    assert.equal(classifyAxis({ ruleId: 'rr-up-auth-bypass' }), 'security');
    assert.equal(classifyAxis({ ruleId: 'rr-mid-xss-check' }), 'security');
  });

  it('classifies performance findings', () => {
    assert.equal(classifyAxis({ ruleId: 'rr-mid-perf-n1' }), 'performance');
    assert.equal(classifyAxis({ ruleId: 'rr-mid-n-plus-one' }), 'performance');
  });

  it('classifies architecture into extensibility', () => {
    assert.equal(classifyAxis({ ruleId: 'rr-up-arch-layer-violation' }), 'extensibility');
    assert.equal(classifyAxis({ ruleId: 'rr-up-dependency-cycle' }), 'extensibility');
  });

  it('classifies readability findings', () => {
    assert.equal(classifyAxis({ ruleId: 'rr-mid-readability-naming' }), 'readability');
    assert.equal(classifyAxis({ ruleId: 'rr-mid-complexity-cyclomatic' }), 'readability');
  });

  it('classifies testing into maintainability', () => {
    assert.equal(classifyAxis({ ruleId: 'rr-down-test-coverage' }), 'maintainability');
  });

  it('honors explicit category field', () => {
    assert.equal(classifyAxis({ ruleId: 'anything', category: 'security' }), 'security');
  });

  it('falls back to maintainability on unknown ruleId', () => {
    assert.equal(classifyAxis({ ruleId: 'rr-unknown-skill' }), 'maintainability');
    assert.equal(classifyAxis({}), 'maintainability');
  });
});

describe('computeAxisScores', () => {
  it('returns 100 for all axes when no findings', () => {
    const scores = computeAxisScores([]);
    for (const axis of [
      'readability',
      'extensibility',
      'performance',
      'security',
      'maintainability',
    ]) {
      assert.equal(scores[axis], 100);
    }
  });

  it('applies heavier deduction for security critical', () => {
    const scores = computeAxisScores([
      { severity: 'critical', ruleId: 'rr-mid-security-injection' },
    ]);
    assert.equal(scores.security, 50);
    assert.equal(scores.readability, 100);
  });

  it('stacks multiple deductions on same axis', () => {
    const scores = computeAxisScores([
      { severity: 'major', ruleId: 'rr-mid-perf-n1' },
      { severity: 'minor', ruleId: 'rr-mid-perf-query' },
    ]);
    assert.equal(scores.performance, 100 - 20 - 10);
  });

  it('clamps score at 0', () => {
    const scores = computeAxisScores([
      { severity: 'critical', ruleId: 'sec' },
      { severity: 'critical', ruleId: 'sec' },
      { severity: 'critical', ruleId: 'sec' },
    ]);
    assert.equal(scores.security, 0);
  });

  it('deducts unknown severity as major, not info (canonical fail-safe, #1585)', () => {
    // Before #1585 the local normalizer defaulted unknown → info (deduction 3);
    // the canonical normalizer fail-safes to major (deduction 20).
    const scores = computeAxisScores([{ severity: 'bogus', ruleId: 'rr-mid-perf-n1' }]);
    assert.equal(scores.performance, 80);
  });
});

describe('computeOverallScore', () => {
  it('averages axis scores', () => {
    const axes = {
      readability: 100,
      extensibility: 100,
      performance: 70,
      security: 100,
      maintainability: 80,
    };
    assert.equal(computeOverallScore(axes), 90);
  });
});

describe('countBySeverity', () => {
  it('counts findings by normalized severity', () => {
    const findings = [
      { severity: 'critical' },
      { severity: 'blocker' },
      { severity: 'major' },
      { severity: 'warning' },
      { severity: 'minor' },
      { severity: 'info' },
    ];
    assert.deepEqual(countBySeverity(findings), {
      critical: 2,
      major: 2,
      minor: 1,
      info: 1,
    });
  });

  it('fail-safes unknown/empty severity to major (canonical, #1585)', () => {
    // Unknown values fall through the canonical normalizeSeverity default,
    // which is `major` per .claude/rules/review-core.md — not `info`.
    const findings = [
      { severity: 'bogus' },
      { severity: '' },
      { severity: undefined },
      { severity: 'major' },
    ];
    assert.deepEqual(countBySeverity(findings), {
      critical: 0,
      major: 4,
      minor: 0,
      info: 0,
    });
  });
});

describe('deriveVerdict', () => {
  it('returns auto-approve for perfect review', () => {
    const axes = Object.fromEntries(
      ['readability', 'extensibility', 'performance', 'security', 'maintainability'].map((a) => [
        a,
        100,
      ])
    );
    const verdict = deriveVerdict({
      overall: 100,
      axes,
      counts: { critical: 0, major: 0, minor: 0, info: 0 },
    });
    assert.equal(verdict, 'auto-approve');
  });

  it('returns human-review-required when critical exists', () => {
    const axes = {
      security: 100,
      readability: 100,
      extensibility: 100,
      performance: 100,
      maintainability: 100,
    };
    const verdict = deriveVerdict({
      overall: 90,
      axes,
      counts: { critical: 1, major: 0, minor: 0, info: 0 },
    });
    assert.equal(verdict, 'human-review-required');
  });

  it('returns human-review-required when overall < 70', () => {
    const axes = {
      security: 60,
      readability: 60,
      extensibility: 60,
      performance: 60,
      maintainability: 60,
    };
    const verdict = deriveVerdict({
      overall: 60,
      axes,
      counts: { critical: 0, major: 1, minor: 0, info: 0 },
    });
    assert.equal(verdict, 'human-review-required');
  });

  it('returns human-review-recommended for moderate findings', () => {
    const axes = {
      security: 100,
      readability: 80,
      extensibility: 80,
      performance: 80,
      maintainability: 80,
    };
    const verdict = deriveVerdict({
      overall: 84,
      axes,
      counts: { critical: 0, major: 1, minor: 0, info: 0 },
    });
    assert.equal(verdict, 'human-review-recommended');
  });

  it('blocks auto-approve when security below threshold', () => {
    const axes = {
      security: 90,
      readability: 100,
      extensibility: 100,
      performance: 100,
      maintainability: 100,
    };
    const verdict = deriveVerdict({
      overall: 98,
      axes,
      counts: { critical: 0, major: 0, minor: 1, info: 0 },
    });
    assert.equal(verdict, 'human-review-recommended');
  });
});

describe('scoreReview integration', () => {
  it('produces full score object with derived flag', () => {
    const result = scoreReview([
      { severity: 'major', ruleId: 'rr-mid-perf-n1' },
      { severity: 'minor', ruleId: 'rr-mid-readability-naming' },
    ]);
    assert.equal(result.derived, true);
    assert.ok(typeof result.overall === 'number');
    assert.equal(result.axes.performance, 80);
    assert.equal(result.axes.readability, 90);
    assert.equal(result.axes.security, 100);
    assert.equal(result.counts.major, 1);
    assert.equal(result.counts.minor, 1);
  });

  it('handles empty findings', () => {
    const result = scoreReview([]);
    assert.equal(result.overall, 100);
    assert.equal(result.verdict, 'auto-approve');
    assert.deepEqual(result.counts, { critical: 0, major: 0, minor: 0, info: 0 });
  });
});

describe('deriveVerdict — humanApprovalRequired flag', () => {
  const perfectAxes = Object.fromEntries(
    ['readability', 'extensibility', 'performance', 'security', 'maintainability'].map((a) => [
      a,
      100,
    ])
  );

  it('returns human-review-required immediately when humanApprovalRequired=true (even perfect scores)', () => {
    const verdict = deriveVerdict({
      overall: 100,
      axes: perfectAxes,
      counts: { critical: 0, major: 0, minor: 0, info: 0 },
      humanApprovalRequired: true,
    });
    assert.equal(verdict, 'human-review-required');
  });

  it('backward compat: omitting humanApprovalRequired defaults to false (auto-approve unchanged)', () => {
    const verdict = deriveVerdict({
      overall: 100,
      axes: perfectAxes,
      counts: { critical: 0, major: 0, minor: 0, info: 0 },
    });
    assert.equal(verdict, 'auto-approve');
  });

  it('backward compat: humanApprovalRequired=false behaves identically to omitting it', () => {
    const args = {
      overall: 100,
      axes: perfectAxes,
      counts: { critical: 0, major: 0, minor: 0, info: 0 },
    };
    assert.equal(deriveVerdict({ ...args, humanApprovalRequired: false }), deriveVerdict(args));
  });
});

describe('resolveVerdict — canonical decision precedence (#1170 F3)', () => {
  it('prefers a non-empty canonical decision over the recomputed verdict', () => {
    assert.equal(resolveVerdict('human-review-required', 'auto-approve'), 'human-review-required');
  });

  it('falls back to the recomputed verdict when no canonical decision is present', () => {
    assert.equal(resolveVerdict(undefined, 'auto-approve'), 'auto-approve');
    assert.equal(resolveVerdict(null, 'auto-approve'), 'auto-approve');
    assert.equal(resolveVerdict('', 'auto-approve'), 'auto-approve');
  });

  it('ignores a non-string canonical decision', () => {
    assert.equal(resolveVerdict(0, 'auto-approve'), 'auto-approve');
    assert.equal(resolveVerdict({ verdict: 'x' }, 'auto-approve'), 'auto-approve');
  });
});

describe('scoreReview — humanApprovalRequired option', () => {
  it('passes humanApprovalRequired through to verdict', () => {
    const result = scoreReview([], { humanApprovalRequired: true });
    assert.equal(result.verdict, 'human-review-required');
    assert.equal(result.overall, 100, 'axis scores unaffected');
    assert.equal(result.derived, true);
  });

  it('backward compat: no second arg → existing verdict behaviour', () => {
    const result = scoreReview([]);
    assert.equal(result.verdict, 'auto-approve');
  });

  it('backward compat: empty options object → existing verdict behaviour', () => {
    const result = scoreReview([], {});
    assert.equal(result.verdict, 'auto-approve');
  });
});
