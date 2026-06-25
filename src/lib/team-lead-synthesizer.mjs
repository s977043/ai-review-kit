import { REVIEWER_ROLES } from './reviewer-orchestrator.mjs';

const CONSENSUS_LEVEL_ORDER = { consensus: 3, multi: 2, single: 1 };
const SEVERITY_ORDER = { critical: 4, major: 3, minor: 2, info: 1 };

/**
 * consensusLevel → severity の順に findings をソートして返す。
 * 同値の場合は元の順序を維持（stable sort）。
 */
function sortFindingsByPriority(findings) {
  return [...findings].sort((a, b) => {
    const cl =
      (CONSENSUS_LEVEL_ORDER[b.consensusLevel] ?? 0) -
      (CONSENSUS_LEVEL_ORDER[a.consensusLevel] ?? 0);
    if (cl !== 0) return cl;
    return (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0);
  });
}

/**
 * 実行されなかったレビュアーロールを blindSpots として返す。
 * 各 blindSpot には role キーと label (REVIEWER_ROLES[role].label) を含める。
 */
function detectBlindSpots(executedRoles) {
  const executedSet = new Set(executedRoles);
  return Object.entries(REVIEWER_ROLES)
    .filter(([role]) => !executedSet.has(role))
    .map(([role, def]) => ({ role, label: def.label }));
}

/**
 * consensusLevel の件数を集計して返す。
 * @returns {{ consensus: number, multi: number, single: number, total: number }}
 */
function buildConsensusSummary(findings) {
  const summary = { consensus: 0, multi: 0, single: 0, total: findings.length };
  for (const f of findings) {
    const level = f.consensusLevel ?? 'single';
    if (level in summary) summary[level]++;
  }
  return summary;
}

/**
 * Tech Lead 統合レポートを生成する。
 * LLM 呼び出しなし。全て deterministic な計算。
 *
 * @param {{ findings: object[], reviewerResults: object[] }} params
 * @returns {{ top3Findings: object[], blindSpots: object[], consensusSummary: object }}
 */
export function synthesizeTeamLeadReport({ findings = [], reviewerResults = [] }) {
  const executedRoles = reviewerResults.map((r) => r.role);
  const sorted = sortFindingsByPriority(findings);
  return {
    top3Findings: sorted.slice(0, 3),
    blindSpots: detectBlindSpots(executedRoles),
    consensusSummary: buildConsensusSummary(findings),
  };
}
