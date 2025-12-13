import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { createSkillValidator, defaultPaths, loadSchema, loadSkillFile, loadSkills } from '../src/lib/skill-loader.mjs';

async function buildValidator(schemaPath = defaultPaths.schemaPath) {
  const schema = await loadSchema(schemaPath);
  return createSkillValidator(schema);
}

test('loads existing sample skill and applies default outputKind', async () => {
  const validator = await buildValidator();
  const skillPath = path.join(defaultPaths.skillsDir, 'upstream/sample-architecture-review.md');
  const loaded = await loadSkillFile(skillPath, { validator });

  assert.equal(loaded.metadata.id, 'rr-upstream-architecture-sample-001');
  assert.deepEqual(loaded.metadata.outputKind, ['findings', 'summary', 'questions', 'actions']);
  assert.ok(loaded.body.trim().length > 0);
});

test('loads skill with extended metadata fields', async () => {
  const validator = await buildValidator();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-loader-'));
  const skillPath = path.join(tmpDir, 'with-extensions.md');
  const content = `---
id: rr-downstream-newmeta-001
name: 'Extended Metadata Skill'
description: 'Uses new metadata fields for loader'
phase: downstream
applyTo:
  - 'src/**/*.ts'
inputContext:
  - diff
  - commitMessage
outputKind:
  - summary
  - actions
modelHint: high-accuracy
dependencies:
  - code_search
  - custom:embedding
---
Body content
`;
  await writeFile(skillPath, content, 'utf8');

  const loaded = await loadSkillFile(skillPath, { validator });
  assert.deepEqual(loaded.metadata.inputContext, ['diff', 'commitMessage']);
  assert.deepEqual(loaded.metadata.outputKind, ['summary', 'actions']);
  assert.equal(loaded.metadata.modelHint, 'high-accuracy');
  assert.deepEqual(loaded.metadata.dependencies, ['code_search', 'custom:embedding']);
});

test('fails when dependencies contain unsupported values', async () => {
  const validator = await buildValidator();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-loader-'));
  const skillPath = path.join(tmpDir, 'invalid-deps.md');
  const content = `---
id: rr-upstream-invalid-deps-001
name: 'Invalid deps'
description: 'Contains unsupported dependency'
phase: upstream
applyTo:
  - 'src/**/*.ts'
dependencies:
  - unknown_tool
---
`;
  await writeFile(skillPath, content, 'utf8');

  await assert.rejects(
    loadSkillFile(skillPath, { validator }),
    err => {
      assert.match(err.message, /validation failed/i);
      return true;
    }
  );
});

test('fails validation when required fields are missing', async () => {
  const validator = await buildValidator();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-loader-'));
  const skillPath = path.join(tmpDir, 'invalid-skill.md');
  const content = `---
id: rr-upstream-missing-applyto-001
name: 'Invalid Skill'
description: 'Missing applyTo field'
phase: upstream
---
Body
`;
  await writeFile(skillPath, content, 'utf8');

  await assert.rejects(
    loadSkillFile(skillPath, { validator }),
    err => {
      assert.match(err.message, /applyTo/i);
      return true;
    }
  );
});

test('loadSkills loads all skill files under default directory', async () => {
  const validator = await buildValidator();
  const loaded = await loadSkills({ validator });
  assert.ok(loaded.length >= 3);
  for (const skill of loaded) {
    assert.ok(Array.isArray(skill.metadata.outputKind));
    assert.ok(skill.metadata.outputKind.length >= 1);
  }
});
