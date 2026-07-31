import { REVIEWER_ROLES } from './reviewer-orchestrator.mjs';
import { SEVERITY_RANK } from './finding-factory.mjs';

const CONSENSUS_LEVEL_ORDER = { consensus: 3, multi: 2, single: 1 };

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
    return (SEVERITY_RANK[b.severity] ?? -1) - (SEVERITY_RANK[a.severity] ?? -1);
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
 * 観点がカバーされたと言えるロールだけを「実行済み」とみなす（#1689 review W5）。
 *
 * 打ち切られた（`timedOut`）ロールと失敗した（`status: 'rejected'`）ロールを
 * 実行済みに数えると、そのロールが blindSpots から消え「GO かつ死角なし」という
 * 二重の誤報になる。判定は除外条件で書く: `status` を持たない呼び出し元
 * （既存テストや旧 reviewerResults）は従来どおり実行済みとして扱う。
 */
function isRoleCovered(entry) {
  if (entry == null) return false;
  if (entry.timedOut === true) return false;
  return entry.status !== 'rejected';
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
  const executedRoles = reviewerResults.filter(isRoleCovered).map((r) => r.role);
  const sorted = sortFindingsByPriority(findings);
  return {
    top3Findings: sorted.slice(0, 3),
    blindSpots: detectBlindSpots(executedRoles),
    consensusSummary: buildConsensusSummary(findings),
  };
}
