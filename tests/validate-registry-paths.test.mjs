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
