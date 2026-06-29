import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createSkillValidator,
  defaultPaths,
  loadSchema,
  loadSkillFile,
} from '../runners/core/skill-loader.mjs';

async function buildValidator(schemaPath = defaultPaths.schemaPath) {
  const schema = await loadSchema(schemaPath);
  return createSkillValidator(schema);
}

async function withTempDir(fn) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-loader-v2-'));
  try {
    return await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

test('loads YAML skill with nested metadata and instruction', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const skillPath = path.join(tmpDir, 'nested.yaml');
    const content = `
metadata:
  id: nested
  name: Nested Skill
  description: Testing nested structure
  category: core
  phase: [midstream, downstream]
  files: ['src/**/*.ts']
instruction: "Do the thing"
`;
    await writeFile(skillPath, content, 'utf8');

    const loaded = await loadSkillFile(skillPath, { validator });

    assert.equal(loaded.metadata.id, 'nested');
    assert.equal(loaded.metadata.name, 'Nested Skill');
    assert.deepEqual(loaded.metadata.category, 'core');
    assert.deepEqual(loaded.metadata.phase, ['upstream', 'midstream', 'downstream']);
    // Normalized to applyTo
    assert.deepEqual(loaded.metadata.applyTo, ['src/**/*.ts']);
    assert.equal(loaded.body, 'Do the thing');
  });
});

test('loads YAML skill with flat structure and instruction', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const skillPath = path.join(tmpDir, 'flat.yaml');
    const content = `
id: flat
name: Flat Skill
description: Testing flat structure
category: upstream
phase: upstream
files: ['docs/*.md']
instruction: "Check docs"
`;
    await writeFile(skillPath, content, 'utf8');

    const loaded = await loadSkillFile(skillPath, { validator });

    assert.equal(loaded.metadata.id, 'flat');
    assert.equal(loaded.metadata.category, 'upstream');
    assert.equal(loaded.metadata.phase, 'upstream');
    assert.deepEqual(loaded.metadata.applyTo, ['docs/*.md']);
    assert.equal(loaded.body, 'Check docs');
  });
});

test('loads YAML skill with trigger container', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const skillPath = path.join(tmpDir, 'trigger.yaml');
    const content = `
id: trigger
name: Trigger YAML Skill
description: Trigger container in YAML
category: downstream
trigger:
  phase: downstream
  applyTo: ['tests/**/*.js']
instruction: "Check tests"
`;
    await writeFile(skillPath, content, 'utf8');

    const loaded = await loadSkillFile(skillPath, { validator });

    assert.equal(loaded.metadata.category, 'downstream');
    assert.equal(loaded.metadata.phase, 'downstream');
    assert.deepEqual(loaded.metadata.applyTo, ['tests/**/*.js']);
    assert.equal(loaded.body, 'Check tests');
  });
});

test('trigger does not override top-level phase/applyTo in YAML', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const skillPath = path.join(tmpDir, 'trigger-precedence.yaml');
    const content = `
id: trigger
name: Trigger Precedence YAML Skill
description: Precedence favors top-level values
category: midstream
phase: midstream
applyTo: ['docs/*.md']
trigger:
  phase: downstream
  applyTo: ['should-not-win/**']
instruction: "Do not override top-level"
`;
    await writeFile(skillPath, content, 'utf8');

    const loaded = await loadSkillFile(skillPath, { validator });

    assert.equal(loaded.metadata.category, 'midstream');
    assert.equal(loaded.metadata.phase, 'midstream');
    assert.deepEqual(loaded.metadata.applyTo, ['docs/*.md']);
    assert.strictEqual(loaded.metadata.trigger, undefined);
    assert.equal(loaded.body, 'Do not override top-level');
  });
});

test('loads YAML skill with instruction nested inside metadata', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const skillPath = path.join(tmpDir, 'nested-instruction.yaml');
    const content = `
metadata:
  id: nested
  name: Nested Instruction Skill
  description: Instruction lives under metadata
  category: midstream
  phase: midstream
  applyTo: ['src/**/*.js']
  instruction: "Use the nested instruction"
`;
    await writeFile(skillPath, content, 'utf8');

    const loaded = await loadSkillFile(skillPath, { validator });

    assert.equal(loaded.metadata.id, 'nested');
    assert.equal(loaded.body, 'Use the nested instruction');
  });
});
