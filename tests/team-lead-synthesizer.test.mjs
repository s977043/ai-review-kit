/**
 * Tests for synthesizeTeamLeadReport (team-lead-synthesizer.mjs).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { synthesizeTeamLeadReport } from '../src/lib/team-lead-synthesizer.mjs';

describe('synthesizeTeamLeadReport', () => {
  // TC-01: top3Findings が consensus → severity 順で上位3件を返す
  test('top3Findings returns top 3 sorted by consensusLevel then severity', () => {
    const findings = [
      { id: 'rr-1', severity: 'minor', consensusLevel: 'single' },
      { id: 'rr-2', severity: 'critical', consensusLevel: 'single' },
      { id: 'rr-3', severity: 'major', consensusLevel: 'multi' },
      { id: 'rr-4', severity: 'critical', consensusLevel: 'consensus' },
      { id: 'rr-5', severity: 'major', consensusLevel: 'consensus' },
    ];
    const { top3Findings } = synthesizeTeamLeadReport({ findings, reviewerResults: [] });

    assert.equal(top3Findings.length, 3);
    // consensus > multi > single
    assert.equal(top3Findings[0].id, 'rr-4'); // consensus + critical
    assert.equal(top3Findings[1].id, 'rr-5'); // consensus + major
    assert.equal(top3Findings[2].id, 'rr-3'); // multi + major
  });

  // TC-02: findings が3件未満の場合は全件返す
  test('top3Findings returns all findings when fewer than 3', () => {
    const findings = [
      { id: 'rr-1', severity: 'critical', consensusLevel: 'consensus' },
      { id: 'rr-2', severity: 'major', consensusLevel: 'single' },
    ];
    const { top3Findings } = synthesizeTeamLeadReport({ findings, reviewerResults: [] });
    assert.equal(top3Findings.length, 2);
  });

  // TC-03: blindSpots が実行されなかったロールを正しく返す
  test('blindSpots returns roles not in reviewerResults', () => {
    const reviewerResults = [{ role: 'bug-hunter' }, { role: 'security-scanner' }];
    const { blindSpots } = synthesizeTeamLeadReport({ findings: [], reviewerResults });

    const blindRoles = blindSpots.map((b) => b.role);
    assert.ok(!blindRoles.includes('bug-hunter'));
    assert.ok(!blindRoles.includes('security-scanner'));
    assert.ok(blindRoles.includes('test-gap'));
    assert.ok(blindRoles.includes('dependency-reviewer'));
    assert.ok(blindRoles.includes('frontend-reviewer'));
    assert.ok(blindRoles.includes('ci-cd-reviewer'));

    // each entry has role and label
    for (const spot of blindSpots) {
      assert.ok(typeof spot.role === 'string');
      assert.ok(typeof spot.label === 'string');
    }
  });

  // TC-04: blindSpots が全ロール実行時に空配列を返す
  test('blindSpots returns empty array when all roles executed', () => {
    const reviewerResults = [
      { role: 'bug-hunter' },
      { role: 'security-scanner' },
      { role: 'test-gap' },
      { role: 'dependency-reviewer' },
      { role: 'frontend-reviewer' },
      { role: 'ci-cd-reviewer' },
    ];
    const { blindSpots } = synthesizeTeamLeadReport({ findings: [], reviewerResults });
    assert.deepEqual(blindSpots, []);
  });

  // #1689 review W5: 打ち切られた / 失敗したロールを「実行済み」に数えると
  // blindSpots から消え、「死角なし」という二つ目の誤報になる。
  test('timedOut / rejected なロールは blindSpots に残る', () => {
    const reviewerResults = [
      { role: 'bug-hunter', status: 'rejected', timedOut: true },
      { role: 'security-scanner', status: 'rejected', timedOut: false },
      { role: 'test-gap', status: 'fulfilled', timedOut: false },
    ];
    const { blindSpots } = synthesizeTeamLeadReport({ findings: [], reviewerResults });
    const roles = blindSpots.map((b) => b.role);
    assert.ok(roles.includes('bug-hunter'), '打ち切られたロールは死角として残る');
    assert.ok(roles.includes('security-scanner'), '失敗したロールも死角として残る');
    assert.ok(!roles.includes('test-gap'), '成功したロールは死角に含めない');
  });

  test('chunk 一部だけ打ち切られた fulfilled ロールも blindSpots に残る', () => {
    // 生存 chunk の findings は残るが、その観点は完全にはカバーされていない。
    const reviewerResults = [{ role: 'bug-hunter', status: 'fulfilled', timedOut: true }];
    const { blindSpots } = synthesizeTeamLeadReport({ findings: [], reviewerResults });
    assert.ok(blindSpots.some((b) => b.role === 'bug-hunter'));
  });

  // TC-05: consensusSummary が consensus/multi/single の件数を正確に集計する
  test('consensusSummary aggregates counts correctly', () => {
    const findings = [
      { severity: 'critical', consensusLevel: 'consensus' },
      { severity: 'major', consensusLevel: 'consensus' },
      { severity: 'minor', consensusLevel: 'multi' },
      { severity: 'info', consensusLevel: 'single' },
      { severity: 'major', consensusLevel: 'single' },
    ];
    const { consensusSummary } = synthesizeTeamLeadReport({ findings, reviewerResults: [] });

    assert.equal(consensusSummary.consensus, 2);
    assert.equal(consensusSummary.multi, 1);
    assert.equal(consensusSummary.single, 2);
    assert.equal(consensusSummary.total, 5);
  });

  // TC-06: findings が空配列でも正常に動作する
  test('handles empty findings gracefully', () => {
    const result = synthesizeTeamLeadReport({ findings: [], reviewerResults: [] });

    assert.deepEqual(result.top3Findings, []);
    assert.equal(result.consensusSummary.total, 0);
    assert.equal(result.consensusSummary.consensus, 0);
    assert.equal(result.consensusSummary.multi, 0);
    assert.equal(result.consensusSummary.single, 0);
  });
});

/**
 * #1644 残件5: scope is the THIRD sort key (consensusLevel → severity → scope).
 *
 * These cases pin the chosen placement from both sides: what scope must decide
 * (ties on the first two keys) and what it must NOT decide (anything the first
 * two keys already settled). Reading only one side would leave "scope first"
 * and "scope never" both passing.
 */
describe('sortFindingsByPriority — scope as the third key (#1644)', () => {
  const top3 = (findings) =>
    synthesizeTeamLeadReport({ findings, reviewerResults: [] }).top3Findings.map((f) => f.id);

  test('within one consensusLevel/severity bucket, in-diff outranks pre-existing', () => {
    // The realistic shape: reviewers rarely agree and severity is coarse, so
    // the top3 cut happens inside a single single/major bucket. Input order
    // deliberately puts the pre-existing findings first, so a passing result
    // cannot come from the previous stable-sort-by-input-order behaviour.
    const findings = [
      { id: 'pre-1', severity: 'major', consensusLevel: 'single', scope: 'pre-existing' },
      { id: 'pre-2', severity: 'major', consensusLevel: 'single', scope: 'pre-existing' },
      { id: 'in-1', severity: 'major', consensusLevel: 'single', scope: 'in-diff' },
      { id: 'in-2', severity: 'major', consensusLevel: 'single', scope: 'in-diff' },
    ];
    assert.deepEqual(top3(findings), ['in-1', 'in-2', 'pre-1']);
  });

  test('scope does NOT outrank severity', () => {
    // Rejects "scope first": an in-diff nit must not displace a pre-existing
    // critical. Being outside the added lines is not the same as unimportant.
    const findings = [
      { id: 'in-nit', severity: 'minor', consensusLevel: 'single', scope: 'in-diff' },
      { id: 'pre-crit', severity: 'critical', consensusLevel: 'single', scope: 'pre-existing' },
    ];
    assert.deepEqual(top3(findings), ['pre-crit', 'in-nit']);
  });

  test('scope does NOT outrank consensusLevel', () => {
    // The existing contract (schemas/output.schema.json top3Findings) ranks
    // consensusLevel above severity; adding scope must not re-litigate it.
    const findings = [
      { id: 'in-single', severity: 'major', consensusLevel: 'single', scope: 'in-diff' },
      {
        id: 'pre-consensus',
        severity: 'major',
        consensusLevel: 'consensus',
        scope: 'pre-existing',
      },
    ];
    assert.deepEqual(top3(findings), ['pre-consensus', 'in-single']);
  });

  test('a finding with no scope ranks with in-diff, not below pre-existing', () => {
    // finding-factory.mjs DEFAULT_FINDING_SCOPE: absent/unknown must not demote.
    const findings = [
      { id: 'pre', severity: 'major', consensusLevel: 'single', scope: 'pre-existing' },
      { id: 'absent', severity: 'major', consensusLevel: 'single' },
      { id: 'bogus', severity: 'major', consensusLevel: 'single', scope: 'whole-repo' },
    ];
    assert.deepEqual(top3(findings), ['absent', 'bogus', 'pre']);
  });

  test('findings equal on all three keys keep their input order', () => {
    const findings = [
      { id: 'b', severity: 'major', consensusLevel: 'single', scope: 'in-diff' },
      { id: 'a', severity: 'major', consensusLevel: 'single', scope: 'in-diff' },
      { id: 'c', severity: 'major', consensusLevel: 'single', scope: 'in-diff' },
    ];
    assert.deepEqual(top3(findings), ['b', 'a', 'c']);
  });
});
