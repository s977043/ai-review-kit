import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { loadProjectRules } from '../src/lib/rules.mjs';

function createTempRepoDir() {
  return mkdtempSync(path.join(tmpdir(), 'river-rules-'));
}

test('loadProjectRules returns null when rules file is absent', async () => {
  const dir = createTempRepoDir();
  try {
    const { rulesText } = await loadProjectRules(dir);
    assert.equal(rulesText, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadProjectRules loads content when rules file exists', async () => {
  const dir = createTempRepoDir();
  const rulesDir = path.join(dir, '.river');
  await rm(rulesDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(rulesDir, { recursive: true });
  const rulesPath = path.join(rulesDir, 'rules.md');
  writeFileSync(rulesPath, '- Follow project guide');

  try {
    const { rulesText, path: resolvedPath } = await loadProjectRules(dir);
    assert.equal(rulesText, '- Follow project guide');
    assert.equal(resolvedPath, rulesPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadProjectRules returns null when rules file is empty or whitespace', async () => {
  const dir = createTempRepoDir();
  const rulesDir = path.join(dir, '.river');
  await mkdir(rulesDir, { recursive: true });
  const rulesPath = path.join(rulesDir, 'rules.md');
  writeFileSync(rulesPath, '   \n  ');

  try {
    const { rulesText } = await loadProjectRules(dir);
    assert.equal(rulesText, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
