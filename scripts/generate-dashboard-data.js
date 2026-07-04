#!/usr/bin/env node
// Generate the docs dashboard data from REAL, offline-derivable sources:
//   - Skill inventory (count + phase distribution) from skills/registry.yaml
//   - Deterministic heuristic detector coverage from src/lib/heuristic-review.mjs
//   - Operational metrics (reviews / comments / cost trend) aggregated from
//     committed run artifacts under docs/data/dogfooding/*.json, if any.
// It intentionally does NOT fabricate operational numbers: when no real run
// artifacts exist, the operational fields stay empty and the dashboard shows
// its built-in "データがまだありません" states. Cost/token metrics require live
// LLM runs (an API key), so they only appear once real runs are committed.
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(REPO_ROOT, 'docs', 'data', 'dogfooding');

const PHASE_ORDER = ['upstream', 'midstream', 'downstream'];

// Human-readable names for the heuristic (LLM-free) skills.
const HEURISTIC_SKILL_NAMES = {
  'security-basic': 'Security basics',
  'logging-observability': 'Logging & observability',
  'typescript-strict': 'TypeScript strictness',
  'test-existence': 'Test existence',
  'coverage-gap': 'Coverage gap',
};

async function readSkillRegistry() {
  const raw = await fs.readFile(path.join(REPO_ROOT, 'skills', 'registry.yaml'), 'utf8');
  const parsed = yaml.load(raw) || {};
  return Array.isArray(parsed.skills) ? parsed.skills : [];
}

// Real skill inventory: total plus a per-phase membership count. A skill may
// declare more than one phase (e.g. "upstream,midstream"), so it is counted in
// each phase it belongs to; the chart is labelled accordingly.
function buildSkillInventory(skills) {
  const perPhase = new Map(PHASE_ORDER.map((p) => [p, 0]));
  for (const skill of skills) {
    const declared = String(skill?.phase ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    for (const phase of declared) {
      if (perPhase.has(phase)) perPhase.set(phase, perPhase.get(phase) + 1);
    }
  }
  return {
    total: skills.length,
    phases: PHASE_ORDER.map((phase) => ({ phase, skills: perPhase.get(phase) })),
  };
}

// Real deterministic detector coverage from the heuristic map (the LLM-free
// checks that run in offline / --rules-only mode).
async function buildDetectorCoverage() {
  const mod = await import(
    pathToFileURL(path.join(REPO_ROOT, 'src', 'lib', 'heuristic-review.mjs')).href
  );
  const map = mod.SKILL_HEURISTIC_MAP ?? {};
  const uniqueDetectors = new Set();
  const skills = Object.entries(map).map(([id, fns]) => {
    fns.forEach((fn) => uniqueDetectors.add(fn));
    return { id, name: HEURISTIC_SKILL_NAMES[id] ?? id, detectors: fns.length };
  });
  skills.sort((a, b) => b.detectors - a.detectors || a.id.localeCompare(b.id));
  return { skills, detectorCount: uniqueDetectors.size, skillCount: skills.length };
}

// Aggregate operational metrics from committed real run artifacts, if present.
// Each artifact is JSON: { phase, filesReviewed, findings: [...], costUsd?, tokens?, date? }.
async function readRunArtifacts() {
  let entries = [];
  try {
    const files = await fs.readdir(RUNS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(RUNS_DIR, file), 'utf8');
        entries.push(JSON.parse(raw));
      } catch {
        // skip unreadable/invalid artifact
      }
    }
  } catch {
    // no dogfooding dir yet — operational metrics stay empty (honest)
  }
  return entries;
}

function buildOperational(runs) {
  if (!runs.length) {
    return { totals: {}, phases: [], costTrend: [] };
  }
  const totalFindings = runs.reduce(
    (s, r) => s + (Array.isArray(r.findings) ? r.findings.length : 0),
    0
  );
  const filesReviewed = runs.reduce((s, r) => s + (Number(r.filesReviewed) || 0), 0);
  const totalCost = runs.reduce((s, r) => s + (Number(r.costUsd) || 0), 0);
  const totalTokens = runs.reduce((s, r) => s + (Number(r.tokens) || 0), 0);
  const perPhase = new Map();
  for (const r of runs) {
    const phase = r.phase ?? 'unknown';
    const cur = perPhase.get(phase) ?? { phase, reviews: 0, comments: 0 };
    cur.reviews += 1;
    cur.comments += Array.isArray(r.findings) ? r.findings.length : 0;
    perPhase.set(phase, cur);
  }
  const costTrend = runs
    .filter((r) => r.date)
    .map((r) => ({
      date: r.date,
      costUsd: Number(r.costUsd) || 0,
      tokens: Number(r.tokens) || 0,
      requests: 1,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    totals: {
      reviews: runs.length,
      filesReviewed,
      comments: totalFindings,
      averageCostUsd: Number((totalCost / Math.max(runs.length, 1)).toFixed(4)),
      tokenEstimate: totalTokens,
    },
    phases: Array.from(perPhase.values()),
    costTrend,
  };
}

async function generateDashboardData() {
  const registrySkills = await readSkillRegistry();
  const inventory = buildSkillInventory(registrySkills);
  const coverage = await buildDetectorCoverage();
  const runs = await readRunArtifacts();
  const operational = buildOperational(runs);

  const data = {
    generatedAt: new Date().toISOString(),
    // Registry + detector coverage are deterministic and always real (offline).
    // Operational metrics (reviews / cost) come only from committed real runs.
    dataSource:
      runs.length > 0
        ? 'skills/registry.yaml + heuristic detectors + committed run artifacts'
        : 'skills/registry.yaml + heuristic detectors (deterministic, offline); operational metrics await live LLM runs',
    registry: {
      totalSkills: inventory.total,
      heuristicSkills: coverage.skillCount,
      heuristicDetectors: coverage.detectorCount,
    },
    // ReviewStatsCard: real registry / detector facts (offline-verifiable).
    totals:
      Object.keys(operational.totals).length > 0
        ? operational.totals
        : {
            skills: inventory.total,
            heuristicSkills: coverage.skillCount,
            heuristicDetectors: coverage.detectorCount,
          },
    // PhaseDistribution: real skill inventory per phase (falls back to run phases).
    phases: operational.phases.length > 0 ? operational.phases : inventory.phases,
    // SkillHeatmap: real deterministic detector coverage per heuristic skill.
    skills: coverage.skills.map((s) => ({ id: s.id, name: s.name, detectors: s.detectors })),
    // CostTrends: only real runs; empty otherwise (honest "no data yet" state).
    costTrend: operational.costTrend,
  };

  const outDir = path.join(REPO_ROOT, 'docs', 'data');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'dashboard-stats.json');
  await fs.writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`);
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
