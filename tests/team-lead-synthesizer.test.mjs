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
