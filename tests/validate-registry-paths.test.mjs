/**
 * Tests for validateRegistryPaths in scripts/validate-skills.mjs.
 * Guards against registry.yaml `path:` entries that point to files that no
 * longer exist (e.g. rename leftovers from #1320).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';

import { validateRegistryPaths } from '../scripts/validate-skills.mjs';
import { createTempDirAsync } from './helpers/temp-dir.mjs';

const TMP_PREFIX = 'validate-registry-paths-';

const SKILL_MD = (id) => `---
id: ${id}
name: Skill ${id}
description: test skill
category: midstream
phase: midstream
applyTo:
  - 'src/**/*.ts'
tags: [test, midstream]
severity: minor
inputContext: [diff]
outputKind: [findings]
---

## Guidance

- test
`;

const registryEntry = (id, skillPath) => `  - id: ${id}
    version: '0.1.0'
    name: 'Skill ${id}'
    path: ${skillPath}
    category: midstream
    phase: midstream
    tags: [test, midstream]
    severity: minor
    recommended: false
    description: 'test skill'
`;

async function buildSkillsDir({ registryYaml, skills = ['skill-a'] }) {
  const dir = await createTempDirAsync({ prefix: TMP_PREFIX });
  for (const id of skills) {
    const skillDir = path.join(dir, 'midstream', id);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), SKILL_MD(id), 'utf8');
  }
  await fs.writeFile(path.join(dir, 'registry.yaml'), registryYaml, 'utf8');
  return dir;
}

test('validateRegistryPaths passes when every registry path exists', async () => {
  const dir = await buildSkillsDir({
    registryYaml: `skills:\n${registryEntry('skill-a', 'midstream/skill-a/SKILL.md')}`,
  });
  const ok = await validateRegistryPaths({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, true);
});

test('validateRegistryPaths fails when a registry path is dangling', async () => {
  const dir = await buildSkillsDir({
    registryYaml: `skills:\n${registryEntry('skill-a', 'midstream/renamed-away/SKILL.md')}`,
  });
  const ok = await validateRegistryPaths({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, false);
});

test('validateRegistryPaths fails on a malformed entry (non-string path)', async () => {
  const dir = await buildSkillsDir({
    registryYaml: `skills:\n  - id: skill-a\n    name: 'Skill A'\n`,
  });
  const ok = await validateRegistryPaths({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, false);
});

test('validateRegistryPaths only warns (still passes) for an unregistered SKILL.md', async () => {
  const dir = await buildSkillsDir({
    registryYaml: `skills:\n${registryEntry('skill-a', 'midstream/skill-a/SKILL.md')}`,
    skills: ['skill-a', 'skill-b'],
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  let ok;
  try {
    ok = await validateRegistryPaths({ skillsDir: dir, repoRoot: dir });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(ok, true);
  assert.ok(warnings.some((w) => w.includes('skill-b') && w.includes('not listed')));
});

test('validateRegistryPaths skips agent-skills/ segment but not substring matches', async () => {
  const dir = await buildSkillsDir({
    registryYaml: `skills:\n${registryEntry('skill-a', 'midstream/skill-a/SKILL.md')}`,
    skills: ['skill-a', 'my-agent-skills-bridge'],
  });
  // A SKILL.md under an actual agent-skills/ directory segment must be skipped.
  const agentSkillDir = path.join(dir, 'agent-skills', 'router');
  await fs.mkdir(agentSkillDir, { recursive: true });
  await fs.writeFile(path.join(agentSkillDir, 'SKILL.md'), SKILL_MD('router'), 'utf8');

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  let ok;
  try {
    ok = await validateRegistryPaths({ skillsDir: dir, repoRoot: dir });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(ok, true);
  // A directory merely containing the substring must still warn (not be skipped).
  assert.ok(warnings.some((w) => w.includes('my-agent-skills-bridge') && w.includes('not listed')));
  // A true agent-skills/ segment must not warn.
  assert.ok(!warnings.some((w) => w.includes(`agent-skills${path.sep}router`)));
});

test('validateRegistryPaths is independent of process.cwd()', async () => {
  const dir = await buildSkillsDir({
    registryYaml: `skills:\n${registryEntry('skill-a', 'midstream/skill-a/SKILL.md')}`,
  });
  const otherCwd = await createTempDirAsync({ prefix: `${TMP_PREFIX}cwd-` });
  const warnings = [];
  const originalWarn = console.warn;
  const originalCwd = process.cwd();
  console.warn = (msg) => warnings.push(String(msg));
  let ok;
  try {
    process.chdir(otherCwd);
    ok = await validateRegistryPaths({ skillsDir: dir, repoRoot: dir });
  } finally {
    process.chdir(originalCwd);
    console.warn = originalWarn;
  }
  assert.equal(ok, true);
  // No spurious "not listed" warning when cwd differs from repoRoot.
  assert.deepEqual(
    warnings.filter((w) => w.includes('not listed')),
    []
  );
});

// loadSkillRegistry error paths — the shared read/parse helper is a single point
// consumed by validateRegistryPaths / validateRecommendedEvalCoverage /
// validateNamingCollisions. Pin that both failure phases surface as a false
// return plus the phase-specific "Failed to read"/"Failed to parse" message.

test('validateRegistryPaths fails with "Failed to read" when registry.yaml is missing', async () => {
  // Empty skills dir → no registry.yaml → readFile ENOENT → phase "read".
  const dir = await createTempDirAsync({ prefix: `${TMP_PREFIX}no-registry-` });
  const errors = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(String(msg));
  let ok;
  try {
    ok = await validateRegistryPaths({ skillsDir: dir, repoRoot: dir });
  } finally {
    console.error = originalError;
  }
  assert.equal(ok, false);
  assert.ok(
    errors.some((e) => e.includes('Failed to read') && e.includes('registry')),
    'expected a "Failed to read skill registry" error'
  );
});

test('validateRegistryPaths fails with "Failed to parse" on malformed registry YAML', async () => {
  const dir = await createTempDirAsync({ prefix: `${TMP_PREFIX}bad-yaml-` });
  // Unclosed flow sequence → js-yaml throws → phase "parse".
  await fs.writeFile(path.join(dir, 'registry.yaml'), 'skills: [\n', 'utf8');
  const errors = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(String(msg));
  let ok;
  try {
    ok = await validateRegistryPaths({ skillsDir: dir, repoRoot: dir });
  } finally {
    console.error = originalError;
  }
  assert.equal(ok, false);
  assert.ok(
    errors.some((e) => e.includes('Failed to parse') && e.includes('registry')),
    'expected a "Failed to parse skill registry" error'
  );
});
