/**
 * Tests for validateRecommendedContextAvailability in scripts/validate-skills.mjs
 * (#1598). Guards against `recommended: true` skills whose inputContext is not a
 * subset of the runner-supplied context set — such skills are silently skipped
 * on every run (`missing inputContext: ...`) and never fire.
 *
 * Also pins RUNNER_SUPPLIED_CONTEXTS to the default runner path so the SSoT
 * constant cannot drift away from what src/lib/local-runner.mjs actually
 * declares.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';

import {
  validateRecommendedContextAvailability,
  RUNNER_SUPPLIED_CONTEXTS,
} from '../scripts/validate-skills.mjs';
import { resolveAvailableContexts } from '../src/lib/utils.mjs';
import { createTempDirAsync } from './helpers/temp-dir.mjs';

const TMP_PREFIX = 'validate-recommended-context-';

const SKILL_MD = (id, inputContext) => `---
id: ${id}
name: Skill ${id}
description: test skill
category: midstream
phase: midstream
applyTo:
  - 'src/**/*.ts'
tags: [test, midstream]
severity: minor
inputContext: [${inputContext.join(', ')}]
outputKind: [findings]
---

## Guidance

- test
`;

const registryEntry = (id, skillPath, recommended) => `  - id: ${id}
    version: '0.1.0'
    name: 'Skill ${id}'
    path: ${skillPath}
    category: midstream
    phase: midstream
    tags: [test, midstream]
    severity: minor
    recommended: ${recommended}
    description: 'test skill'
`;

/**
 * @param {Array<{id: string, inputContext: string[], recommended: boolean}>} skills
 */
async function buildSkillsDir(skills) {
  const dir = await createTempDirAsync({ prefix: TMP_PREFIX });
  let registryYaml = 'skills:\n';
  for (const { id, inputContext, recommended } of skills) {
    const relPath = `midstream/${id}/SKILL.md`;
    const skillDir = path.join(dir, 'midstream', id);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), SKILL_MD(id, inputContext), 'utf8');
    registryYaml += registryEntry(id, relPath, recommended);
  }
  await fs.writeFile(path.join(dir, 'registry.yaml'), registryYaml, 'utf8');
  return dir;
}

async function runQuiet(dir) {
  const errors = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = () => {};
  let ok;
  try {
    ok = await validateRecommendedContextAvailability({ skillsDir: dir, repoRoot: dir });
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  return { ok, errors };
}

test('passes when a recommended skill inputContext is within the supplied set', async () => {
  const dir = await buildSkillsDir([{ id: 'skill-a', inputContext: ['diff'], recommended: true }]);
  const { ok } = await runQuiet(dir);
  assert.equal(ok, true);
});

test('passes for prDescription (a supplied context)', async () => {
  const dir = await buildSkillsDir([
    { id: 'skill-a', inputContext: ['diff', 'prDescription'], recommended: true },
  ]);
  const { ok } = await runQuiet(dir);
  assert.equal(ok, true);
});

test('fails when a recommended skill requires an unsupplied context', async () => {
  const dir = await buildSkillsDir([
    { id: 'skill-a', inputContext: ['diff', 'fullFile'], recommended: true },
  ]);
  const { ok, errors } = await runQuiet(dir);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('skill-a') && e.includes('fullFile')));
});

test('ignores non-recommended skills with unsupplied contexts', async () => {
  const dir = await buildSkillsDir([
    { id: 'skill-a', inputContext: ['diff', 'adr', 'tests'], recommended: false },
  ]);
  const { ok } = await runQuiet(dir);
  assert.equal(ok, true);
});

test('the real repo registry passes the gate (grandfather list stays complete)', async () => {
  // No skillsDir/repoRoot override → validates the actual skills/registry.yaml.
  // This fails if a new recommended skill lands with an unsupplied inputContext
  // and is not grandfathered, or if a grandfathered skill was made compliant
  // but left in the list without shrinking it (the latter still passes — the set
  // is a superset allowance — so this only catches the forward regression).
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(String(msg));
  let ok;
  try {
    ok = await validateRecommendedContextAvailability();
  } finally {
    console.log = originalLog;
  }
  assert.equal(ok, true);
});

test('RUNNER_SUPPLIED_CONTEXTS mirrors the default runner path (SSoT sync)', () => {
  // src/lib/local-runner.mjs collectLocalContext resolves availableContexts via
  // resolveAvailableContexts(null, { alwaysInclude: prBody ? ['prDescription'] : [] }).
  // With no RIVER_AVAILABLE_CONTEXTS env, the base default is ['diff']; the
  // conditional PR-body branch adds 'prDescription'. RUNNER_SUPPLIED_CONTEXTS
  // must equal that union so the validator gate matches runtime reality.
  const previous = process.env.RIVER_AVAILABLE_CONTEXTS;
  delete process.env.RIVER_AVAILABLE_CONTEXTS;
  try {
    assert.deepEqual(resolveAvailableContexts(null), ['diff']);
    const withPrBody = resolveAvailableContexts(null, { alwaysInclude: ['prDescription'] });
    assert.deepEqual([...withPrBody].sort(), [...RUNNER_SUPPLIED_CONTEXTS].sort());
  } finally {
    if (previous == null) delete process.env.RIVER_AVAILABLE_CONTEXTS;
    else process.env.RIVER_AVAILABLE_CONTEXTS = previous;
  }
});
