import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { createSkillValidator, defaultPaths, loadSchema, loadSkillFile } from '../src/lib/skill-loader.mjs';

async function buildValidator(schemaPath = defaultPaths.schemaPath) {
  const schema = await loadSchema(schemaPath);
  return createSkillValidator(schema);
}

test('loads YAML skill with nested metadata and instruction', async () => {
  const validator = await buildValidator();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-loader-v2-'));
  const skillPath = path.join(tmpDir, 'nested.yaml');
  const content = `
metadata:
  id: rr-test-nested-001
  name: Nested Skill
  description: Testing nested structure
  phase: [midstream, downstream]
  files: ['src/**/*.ts']
instruction: "Do the thing"
`;
  await writeFile(skillPath, content, 'utf8');

  const loaded = await loadSkillFile(skillPath, { validator });

  assert.equal(loaded.metadata.id, 'rr-test-nested-001');
  assert.equal(loaded.metadata.name, 'Nested Skill');
  assert.deepEqual(loaded.metadata.phase, ['midstream', 'downstream']);
  // Normalized to applyTo
  assert.deepEqual(loaded.metadata.applyTo, ['src/**/*.ts']);
  assert.equal(loaded.body, 'Do the thing');
});

test('loads YAML skill with flat structure and instruction', async () => {
  const validator = await buildValidator();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-loader-v2-'));
  const skillPath = path.join(tmpDir, 'flat.yaml');
  const content = `
id: rr-test-flat-001
name: Flat Skill
description: Testing flat structure
phase: upstream
files: ['docs/*.md']
instruction: "Check docs"
`;
  await writeFile(skillPath, content, 'utf8');

  const loaded = await loadSkillFile(skillPath, { validator });

  assert.equal(loaded.metadata.id, 'rr-test-flat-001');
  assert.equal(loaded.metadata.phase, 'upstream');
  assert.deepEqual(loaded.metadata.applyTo, ['docs/*.md']);
  assert.equal(loaded.body, 'Check docs');
});
