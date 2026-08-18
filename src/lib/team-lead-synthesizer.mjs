import { REVIEWER_ROLES } from './reviewer-orchestrator.mjs';
import { normalizeScope, SEVERITY_RANK } from './finding-factory.mjs';

const CONSENSUS_LEVEL_ORDER = { consensus: 3, multi: 2, single: 1 };

/** in-diff を上位に置くための順位。normalizeScope の語彙と 1:1 で対応する。 */
const SCOPE_ORDER = { 'in-diff': 1, 'pre-existing': 0 };

/**
 * consensusLevel → severity → scope の順に findings をソートして返す。
 * 同値の場合は元の順序を維持（stable sort）。
 *
 * scope を第 3 キーに置く理由（#1644 残件5）:
 *
 * - scope を第 1 キーにすると、単一ロールの `in-diff` minor が
 *   3 ロール合意の `pre-existing` critical を追い越して top3 の先頭に来る。
 *   「この差分の外にある」ことは「重要でない」ことではないので、これは誤り。
 * - 一方で第 3 キーは「効果が薄い置き場所」ではない。上位 2 キーの値域は
 *   consensusLevel が 3 種・severity が 4 種しかなく、実運用では大半の
 *   finding が `single` × `major` の 1 バケットに落ちる。top3 の打ち切りは
 *   そのバケットの中で起きるので、そこを従来の入力順ではなく scope で
 *   決めることが in-diff 優先の実効部分になる。
 *   例: `single`/`major` が 4 件（うち in-diff 2 件）なら、従来は入力順で
 *   pre-existing が top3 に入り得たが、この順序では in-diff の 2 件が必ず先に来る。
 * - 加えて、第 3 キーであれば「consensusLevel が severity より優先する」という
 *   既存の契約（schemas/output.schema.json の top3Findings）を変えない。
 *   scope は同順位群の中の並びを決めるだけで、上位 2 キーの判定を覆さない。
 *
 * scope 欠損・語彙外の値は normalizeScope の fail-safe により `in-diff` 扱い、
 * すなわち降格しない側に倒れる（finding-factory.mjs の DEFAULT_FINDING_SCOPE）。
 */
function sortFindingsByPriority(findings) {
  return [...findings].sort((a, b) => {
    const cl =
      (CONSENSUS_LEVEL_ORDER[b.consensusLevel] ?? 0) -
      (CONSENSUS_LEVEL_ORDER[a.consensusLevel] ?? 0);
    if (cl !== 0) return cl;
    const sev = (SEVERITY_RANK[b.severity] ?? -1) - (SEVERITY_RANK[a.severity] ?? -1);
    if (sev !== 0) return sev;
    return SCOPE_ORDER[normalizeScope(b.scope)] - SCOPE_ORDER[normalizeScope(a.scope)];
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
