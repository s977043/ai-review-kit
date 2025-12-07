import { planSkills } from './skill-planner.mjs';

/**
 * Evaluate planner outputs against expected orders.
 * Metrics are intentionallyシンプルなオフライン評価用。
 * @param {Array} cases - [{skills, context, llmPlan, expectedOrder}]
 * @returns {{summary: object, cases: Array}}
 */
export async function evaluatePlanner(cases) {
  const results = [];
  for (const c of cases) {
    const planned = await planSkills({
      skills: c.skills,
      context: c.context,
      llmPlan: c.llmPlan,
    });
    const plannedIds = planned.planned.map(s => s.id ?? s.metadata?.id);
    const expected = c.expectedOrder ?? [];
    const top1Match = plannedIds[0] === expected[0] ? 1 : 0;
    const coverage =
      expected.length === 0
        ? 1
        : expected.filter(id => plannedIds.includes(id)).length / expected.length;
    const mrr = (() => {
      if (!expected.length) return 1;
      const idx = plannedIds.indexOf(expected[0]);
      return idx >= 0 ? 1 / (idx + 1) : 0;
    })();
    const exactMatch =
      expected.length === plannedIds.length &&
      expected.every((id, idx) => id === plannedIds[idx])
        ? 1
        : 0;
    results.push({
      name: c.name ?? 'case',
      plannedIds,
      expected,
      exactMatch,
      top1Match,
      coverage,
      mrr,
      reasons: planned.reasons ?? [],
    });
  }

  const summary = {
    cases: cases.length,
    exactMatch: average(results.map(r => r.exactMatch)),
    top1Match: average(results.map(r => r.top1Match)),
    coverage: average(results.map(r => r.coverage)),
    mrr: average(results.map(r => r.mrr)),
  };

  return { summary, cases: results };
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
