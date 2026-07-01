import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// check-skill-id-references.mjs のガード挙動を、一時 fixture を cwd にして実プロセス実行で検証する。
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'check-skill-id-references.mjs'
);

function runIn(dir) {
  try {
    execFileSync('node', [SCRIPT], { cwd: dir, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

function fixture(content) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-refs-'));
  mkdirSync(join(dir, 'skills', 'upstream', 'x'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'upstream', 'x', 'SKILL.md'), content);
  return dir;
}

test('dangling な旧形式 skill ID を検出して exit 1', () => {
  const dir = fixture('ref: rr-upstream-api-design-001\n');
  try {
    assert.equal(runIn(dir), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('allowlist 済みの旧 ID のみなら pass（exit 0）', () => {
  const dir = fixture('ref: rr-midstream-example-001\n');
  try {
    assert.equal(runIn(dir), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('簡素名（現行 ID）のみなら pass（exit 0）', () => {
  const dir = fixture('ref: api-design\n');
  try {
    assert.equal(runIn(dir), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
