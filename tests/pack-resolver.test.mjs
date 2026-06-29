import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';

import { loadPacks, resolveSkillSet, SkillLoaderError } from '../runners/core/skill-loader.mjs';
import { createTempDirAsync } from './helpers/temp-dir.mjs';

const TMP_PREFIX = 'pack-resolver-';

async function writeRegistry(content) {
  const dir = await createTempDirAsync({ prefix: TMP_PREFIX });
  await fs.writeFile(path.join(dir, 'registry.yaml'), content, 'utf8');
  return dir;
}

const REGISTRY = `
packs:
  - id: typescript
    version: '0.1.0'
    name: 'TS'
    description: 'ts pack'
    axis: technology
    tier: community
    sources:
      - name: 'TypeScript Handbook'
        reviewed_at: '2026-06-10'
    skills:
      - skill-a
      - skill-b
  - id: security
    version: '0.1.0'
    name: 'Sec'
    description: 'sec pack'
    axis: concern
    tier: community
    sources:
      - name: 'internal'
        reviewed_at: '2026-06-10'
    skills:
      - skill-b
      - skill-c
recommendations:
  typescript:
    description: 'legacy'
    skills:
      - skill-a
      - legacy-only
  basic:
    description: 'basic'
    skills:
      - skill-d
`;

test('loadPacks returns pack entries with ids', async () => {
  const dir = await writeRegistry(REGISTRY);
  const packs = await loadPacks({ skillsDir: dir });
  assert.deepEqual(
    packs.map((p) => p.id),
    ['typescript', 'security']
  );
});

test('loadPacks returns empty array when packs section is absent', async () => {
  const dir = await writeRegistry('recommendations: {}\n');
  assert.deepEqual(await loadPacks({ skillsDir: dir }), []);
});

test('resolveSkillSet prefers pack over same-name recommendation and warns', async () => {
  const dir = await writeRegistry(REGISTRY);
  const warnings = [];
  const ids = await resolveSkillSet('typescript', {
    skillsDir: dir,
    warn: (m) => warnings.push(m),
  });
  assert.deepEqual(ids, ['skill-a', 'skill-b']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /both a pack and a recommendation set/);
});

test('resolveSkillSet falls back to recommendations for non-pack names', async () => {
  const dir = await writeRegistry(REGISTRY);
  const ids = await resolveSkillSet('basic', { skillsDir: dir, warn: () => {} });
  assert.deepEqual(ids, ['skill-d']);
});

test('resolveSkillSet set-unions multiple names and dedupes shared skills', async () => {
  const dir = await writeRegistry(REGISTRY);
  const ids = await resolveSkillSet('typescript, security, basic', {
    skillsDir: dir,
    warn: () => {},
  });
  assert.deepEqual(ids, ['skill-a', 'skill-b', 'skill-c', 'skill-d']);
});

test('resolveSkillSet throws SkillLoaderError listing packs and sets for unknown names', async () => {
  const dir = await writeRegistry(REGISTRY);
  await assert.rejects(resolveSkillSet('nope', { skillsDir: dir, warn: () => {} }), (err) => {
    assert.ok(err instanceof SkillLoaderError);
    assert.match(err.message, /Unknown skill set "nope"/);
    assert.match(err.message, /typescript/);
    assert.match(err.message, /basic/);
    return true;
  });
});

test('resolveSkillSet returns empty array for empty input', async () => {
  const dir = await writeRegistry(REGISTRY);
  assert.deepEqual(await resolveSkillSet('', { skillsDir: dir }), []);
  assert.deepEqual(await resolveSkillSet(null, { skillsDir: dir }), []);
});

test('real registry: typescript pack resolves via packs and stays consistent', async () => {
  const warnings = [];
  const ids = await resolveSkillSet('typescript', { warn: (m) => warnings.push(m) });
  assert.deepEqual(ids, ['typescript-strict', 'typescript-nullcheck', 'type-driven-design']);
  assert.equal(warnings.length, 1, 'coexistence period: deprecated recommendation still present');
});
