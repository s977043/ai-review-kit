import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatYamlOutput } from '../../src/lib/output-formatters/yaml.mjs';

describe('formatYamlOutput', () => {
  it('emits YAML block and human summary for empty findings', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [],
    });
    assert.match(output, /```yaml/);
    assert.match(output, /phase: midstream/);
    assert.match(output, /verdict: auto-approve/);
    assert.match(output, /overall: 100/);
    assert.match(output, /derived: true/);
    assert.match(output, /findings: \[\]/);
    assert.match(output, /## レビュー結果/);
    assert.match(output, /指摘事項なし/);
  });

  it('honors a canonical decision over the recomputed verdict (#1170 F3)', () => {
    // Empty findings recompute to auto-approve, but the artifact carries a
    // canonical human-review-required decision (e.g. a plan-review-gate trigger).
    const output = formatYamlOutput({
      phase: 'upstream',
      findings: [],
      decision: 'human-review-required',
    });
    assert.match(output, /verdict: human-review-required/);
    assert.doesNotMatch(output, /verdict: auto-approve/);
    assert.match(output, /判定: \*\*human-review-required\*\*/);
  });

  it('includes all 5 axes in scores block', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [],
    });
    for (const axis of [
      'readability',
      'extensibility',
      'performance',
      'security',
      'maintainability',
    ]) {
      assert.match(output, new RegExp(`${axis}: \\d+`));
    }
  });

  it('includes findings with category derivation', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [
        {
          severity: 'critical',
          ruleId: 'rr-mid-security-sql-injection',
          title: 'SQL Injection',
          message: 'Unsanitized input to raw SQL',
          file: 'src/Controller/UserController.php',
          line: 42,
          suggestion: 'Use parameterized query',
        },
      ],
    });
    assert.match(output, /severity: critical/);
    assert.match(output, /category: security/);
    assert.match(output, /file: "src\/Controller\/UserController\.php"/);
    assert.match(output, /line: 42/);
    assert.match(output, /title: "SQL Injection"/);
    assert.match(output, /suggestion: "Use parameterized query"/);
  });

  it('produces human summary with Japanese labels', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [{ severity: 'major', ruleId: 'rr-mid-perf-n1', file: 'x', message: 'N+1' }],
    });
    assert.match(output, /可読性: \d+\/100/);
    assert.match(output, /パフォーマンス: \d+\/100/);
    assert.match(output, /セキュリティ: \d+\/100/);
  });

  it('emits high_risk_reasons from plan impactTags', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [],
      plan: { impactTags: ['security', 'auth', 'random'] },
    });
    assert.match(output, /high_risk_reasons:/);
    assert.match(output, /- security/);
    assert.match(output, /- auth/);
    assert.doesNotMatch(output, /- random/);
  });

  it('flags critical-finding as high_risk_reasons', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [
        { severity: 'critical', ruleId: 'rr-mid-security-xss', file: 'x', message: '...' },
      ],
    });
    assert.match(output, /- critical-finding/);
  });

  it('escapes quotes in messages', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [
        {
          severity: 'minor',
          ruleId: 'rr-mid-readability-naming',
          file: 'a.js',
          title: 'Name "foo" is ambiguous',
          message: 'consider renaming',
        },
      ],
    });
    assert.match(output, /title: "Name \\"foo\\" is ambiguous"/);
  });

  it('ends YAML block cleanly before human summary', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [],
    });
    const yamlEnd = output.indexOf('```\n');
    const summaryStart = output.indexOf('## レビュー結果');
    assert.ok(yamlEnd > 0);
    assert.ok(summaryStart > yamlEnd);
  });
});
