#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const { subDays, formatISO } = require('date-fns');

function createFallbackTrend(days = 7) {
  const today = new Date('2025-12-01T00:00:00Z');
  return Array.from({ length: days }).map((_, idx) => {
    const date = subDays(today, days - idx - 1);
    return {
      date: formatISO(date, { representation: 'date' }),
      costUsd: Number((0.04 + idx * 0.01).toFixed(4)),
      tokens: 2500 + idx * 300,
      requests: 2 + (idx % 3),
    };
  });
}

function buildTotals(trend) {
  const totalCost = trend.reduce((sum, item) => sum + item.costUsd, 0);
  const totalRequests = trend.reduce((sum, item) => sum + item.requests, 0);
  const totalTokens = trend.reduce((sum, item) => sum + item.tokens, 0);
  return {
    reviews: totalRequests,
    filesReviewed: totalRequests * 3,
    comments: totalRequests * 4,
    averageCostUsd: Number((totalCost / Math.max(totalRequests, 1)).toFixed(4)),
    tokenEstimate: totalTokens,
  };
}

async function generateDashboardData() {
  const trend = createFallbackTrend(10);
  const data = {
    generatedAt: new Date().toISOString(),
    totals: buildTotals(trend),
    phases: [
      { phase: 'upstream', reviews: 4, comments: 10 },
      { phase: 'midstream', reviews: 8, comments: 26 },
      { phase: 'downstream', reviews: 6, comments: 14 },
    ],
    skills: [
      { id: 'rr-midstream-security-basic-001', name: 'Security basic', findings: 5 },
      { id: 'rr-midstream-typescript-strict-001', name: 'TypeScript strictness', findings: 4 },
      { id: 'rr-downstream-test-naming-001', name: 'Test naming', findings: 3 },
      { id: 'rr-upstream-api-design-001', name: 'API design', findings: 2 },
    ],
    costTrend: trend,
  };

  const outDir = path.join(process.cwd(), 'docs', 'data');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'dashboard-stats.json');
  await fs.writeFile(outPath, JSON.stringify(data, null, 2));
  return outPath;
}

async function main() {
  const outPath = await generateDashboardData();
  console.log(`Dashboard data written to ${outPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to generate dashboard data:', error);
    process.exit(1);
  });
}

module.exports = { generateDashboardData };
