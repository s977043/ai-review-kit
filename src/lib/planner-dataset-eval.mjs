import fs from 'node:fs/promises';
import path from 'node:path';
import { parseUnifiedDiff } from './diff.mjs';
import { loadSkills } from './skill-loader.mjs';
import { buildExecutionPlan } from './review-runner.mjs';

function getMeta(skill) {
  return skill?.metadata ?? skill;
}

function hasExcludedTag(skill, excludedTags) {
  if (!excludedTags?.length) return false;
  const tags = getMeta(skill)?.tags ?? [];
  return tags.some(tag => excludedTags.includes(tag));
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function deriveChangedFiles(diffText) {
  const parsed = parseUnifiedDiff(diffText);
  const files = parsed.files?.map(f => f.path).filter(Boolean) ?? [];
  return files.filter(p => p !== '/dev/null');
}

export async function evaluatePlannerDataset({
  datasetDir,
  cases,
  excludedTags = ['sample', 'hello', 'policy', 'process'],
  preferredModelHint = 'balanced',
} = {}) {
  const loadedCases = cases ?? (await readCases({ datasetDir }));
  const skills = (await loadSkills()).filter(skill => !hasExcludedTag(skill, excludedTags));

  const results = await Promise.all(
    loadedCases.map(async c => {
      const diffText = await readDiff({ datasetDir, diffFile: c.diffFile });
      const changedFiles = deriveChangedFiles(diffText);
      const availableContexts = ensureArray(c.availableContexts ?? ['diff']);
      const availableDependencies = c.availableDependencies ?? null;
      const expectedAny = ensureArray(c.expectedAny);
      const expectedTop1 = ensureArray(c.expectedTop1);

      const plan = await buildExecutionPlan({
        phase: c.phase,
        changedFiles,
        diffText,
        availableContexts,
        availableDependencies,
        preferredModelHint,
        skills,
      });

      const selectedIds = plan.selected.map(s => getMeta(s).id);
      const top1 = selectedIds[0] ?? null;
      const hitCount = expectedAny.filter(id => selectedIds.includes(id)).length;
      const coverage = expectedAny.length ? hitCount / expectedAny.length : 1;
      const top1Match = expectedTop1.length ? (expectedTop1.includes(top1) ? 1 : 0) : null;
      const missingExpected = expectedAny.filter(id => !selectedIds.includes(id));

      return {
        name: c.name,
        phase: c.phase,
        changedFiles,
        impactTags: plan.impactTags ?? [],
        availableContexts,
        availableDependencies,
        expectedAny,
        expectedTop1,
        selectedIds,
        top1,
        coverage,
        top1Match,
        missingExpected,
        skipped: plan.skipped.map(s => ({
          id: getMeta(s.skill).id,
          reasons: s.reasons,
        })),
      };
    })
  );

  const definedTop1 = results.map(r => r.top1Match).filter(v => v != null);
  return {
    summary: {
      cases: results.length,
      coverage: average(results.map(r => r.coverage)),
      top1Match: definedTop1.length ? average(definedTop1) : 0,
      top1MatchCases: definedTop1.length,
    },
    cases: results,
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function readCases({ datasetDir }) {
  if (!datasetDir) throw new Error('datasetDir is required when cases are not provided');
  const raw = await fs.readFile(path.join(datasetDir, 'cases.json'), 'utf8');
  return JSON.parse(raw);
}

async function readDiff({ datasetDir, diffFile }) {
  if (!datasetDir) throw new Error('datasetDir is required');
  if (!diffFile) throw new Error('diffFile is required');
  return fs.readFile(path.join(datasetDir, diffFile), 'utf8');
}
