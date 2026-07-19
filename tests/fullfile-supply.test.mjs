/**
 * Tests for src/lib/fullfile-supply.mjs (#1606).
 *
 * Covers: basic supply, per-file + total budget guards, binary exclusion,
 * generated (dist/) + config exclusion, non-source skip, env kill-switch, and
 * the fail-safe (unreadable / missing files never throw).
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import {
  resolveFullFileSupply,
  isFullFileSupplyEnabled,
  PER_FILE_CHAR_CAP,
  TOTAL_CHAR_CAP,
  MAX_FILES,
} from '../src/lib/fullfile-supply.mjs';
import { createTempDir, cleanupTempDir } from './helpers/temp-dir.mjs';

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return rel;
}

describe('isFullFileSupplyEnabled', () => {
  test('defaults to enabled', () => {
    assert.equal(isFullFileSupplyEnabled({}), true);
  });
  test('disabled via off / 0 / false / no', () => {
    for (const v of ['off', '0', 'false', 'no', 'OFF', 'False']) {
      assert.equal(isFullFileSupplyEnabled({ RIVER_FULLFILE_SUPPLY: v }), false);
    }
  });
  test('any other value stays enabled', () => {
    assert.equal(isFullFileSupplyEnabled({ RIVER_FULLFILE_SUPPLY: 'on' }), true);
  });
});

describe('resolveFullFileSupply', () => {
  test('supplies changed source files and reports available', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const a = write(dir, 'src/a.ts', 'export const a = 1;\n');
      const b = write(dir, 'src/b.js', 'module.exports = 2;\n');
      const res = resolveFullFileSupply({ changedFiles: [a, b], repoRoot: dir, env: {} });
      assert.equal(res.available, true);
      assert.equal(res.enabled, true);
      assert.deepEqual(res.supplied.map((s) => s.path).sort(), ['src/a.ts', 'src/b.js']);
      assert.equal(res.skipped.length, 0);
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('per-file cap marks the entry truncated but still supplied', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const big = write(dir, 'src/big.ts', 'x'.repeat(PER_FILE_CHAR_CAP + 500));
      const res = resolveFullFileSupply({ changedFiles: [big], repoRoot: dir, env: {} });
      assert.equal(res.available, true);
      assert.equal(res.supplied[0].chars, PER_FILE_CHAR_CAP);
      assert.equal(res.supplied[0].truncated, true);
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('total budget cap skips overflow files as budget-exceeded', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      // Three files each at the per-file cap: 2 fit under TOTAL_CHAR_CAP (8000),
      // the third overflows and is skipped.
      const f1 = write(dir, 'src/f1.ts', 'a'.repeat(PER_FILE_CHAR_CAP));
      const f2 = write(dir, 'src/f2.ts', 'b'.repeat(PER_FILE_CHAR_CAP));
      const f3 = write(dir, 'src/f3.ts', 'c'.repeat(PER_FILE_CHAR_CAP));
      const res = resolveFullFileSupply({
        changedFiles: [f1, f2, f3],
        repoRoot: dir,
        env: {},
      });
      assert.ok(res.totalChars <= TOTAL_CHAR_CAP);
      assert.equal(res.supplied.length, 2);
      assert.ok(res.skipped.some((s) => s.path === 'src/f3.ts' && s.reason === 'budget-exceeded'));
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('excludes binary files (NUL byte)', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const bin = write(dir, 'src/bin.ts', Buffer.from([0x41, 0x00, 0x42]));
      const res = resolveFullFileSupply({ changedFiles: [bin], repoRoot: dir, env: {} });
      assert.equal(res.available, false);
      assert.ok(res.skipped.some((s) => s.path === 'src/bin.ts' && s.reason === 'binary'));
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('excludes generated dist/ artifacts', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const gen = write(dir, 'runners/github-action/dist/index.mjs', 'export const x = 1;\n');
      const res = resolveFullFileSupply({ changedFiles: [gen], repoRoot: dir, env: {} });
      assert.equal(res.available, false);
      assert.ok(res.skipped.some((s) => s.reason === 'excluded'));
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('excludes files matching config exclude patterns', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const gen = write(dir, 'src/generated/api.ts', 'export const x = 1;\n');
      const res = resolveFullFileSupply({
        changedFiles: [gen],
        repoRoot: dir,
        excludePatterns: ['**/generated/**'],
        env: {},
      });
      assert.equal(res.available, false);
      assert.ok(res.skipped.some((s) => s.reason === 'excluded'));
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('skips non-source files (docs / data)', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const md = write(dir, 'docs/readme.md', '# hi\n');
      const json = write(dir, 'data.json', '{}\n');
      const res = resolveFullFileSupply({ changedFiles: [md, json], repoRoot: dir, env: {} });
      assert.equal(res.available, false);
      assert.equal(res.skipped.filter((s) => s.reason === 'non-source').length, 2);
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('env kill-switch disables supply entirely', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const a = write(dir, 'src/a.ts', 'export const a = 1;\n');
      const res = resolveFullFileSupply({
        changedFiles: [a],
        repoRoot: dir,
        env: { RIVER_FULLFILE_SUPPLY: 'off' },
      });
      assert.equal(res.available, false);
      assert.equal(res.enabled, false);
      assert.equal(res.supplied.length, 0);
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('fail-safe: missing / unreadable files are skipped, never throw', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const res = resolveFullFileSupply({
        changedFiles: ['src/does-not-exist.ts'],
        repoRoot: dir,
        env: {},
      });
      assert.equal(res.available, false);
      assert.ok(
        res.skipped.some(
          (s) => s.path === 'src/does-not-exist.ts' && ['missing', 'unreadable'].includes(s.reason)
        )
      );
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('files beyond MAX_FILES are recorded as beyond-file-limit', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const files = [];
      for (let i = 0; i < MAX_FILES + 2; i += 1) {
        files.push(write(dir, `src/f${i}.ts`, `export const v${i} = ${i};\n`));
      }
      const res = resolveFullFileSupply({ changedFiles: files, repoRoot: dir, env: {} });
      assert.equal(res.supplied.length, MAX_FILES);
      assert.equal(res.skipped.filter((s) => s.reason === 'beyond-file-limit').length, 2);
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('empty / whitespace-only files are skipped', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const empty = write(dir, 'src/empty.ts', '   \n\t\n');
      const res = resolveFullFileSupply({ changedFiles: [empty], repoRoot: dir, env: {} });
      assert.equal(res.available, false);
      assert.ok(res.skipped.some((s) => s.reason === 'empty'));
    } finally {
      cleanupTempDir(dir);
    }
  });
});
