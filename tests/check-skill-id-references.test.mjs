import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from '../scripts/check-skill-id-references.mjs';

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
    if (typeof e.status === 'number') return e.status;
    throw e;
  }
}

function fixture(content) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-refs-'));
  try {
    mkdirSync(join(dir, 'skills', 'upstream', 'x'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'upstream', 'x', 'SKILL.md'), content);
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
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

// --- in-process 単体テスト（export した純関数を直接呼ぶ。#1473 Step 5） ---
// 上の subprocess テストは canary として維持し、検出ロジックの中核関数を
// プロセス起動なしで直接検証する。

test('scanText: 現行 ID のみのテキストは違反なし（in-process happy）', () => {
  const found = scanText('skills/upstream/x/SKILL.md', 'ref: api-design\n');
  assert.deepEqual(found.violations, []);
  assert.deepEqual(found.pathViolations, []);
});

test('scanText: 旧形式 ID を違反として検出（in-process violation）', () => {
  const found = scanText('skills/upstream/x/SKILL.md', 'ref: rr-upstream-api-design-001\n');
  assert.equal(found.violations.length, 1);
  assert.equal(found.violations[0].id, 'rr-upstream-api-design-001');
});
