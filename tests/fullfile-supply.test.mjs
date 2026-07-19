/**
 * Tests for src/lib/fullfile-supply.mjs (#1606).
 *
 * The resolver delegates to repo-context.collectFullFileSections — the same
 * computation collectRepoContext uses for prompt injection — so these tests
 * cover both the ledger semantics AND the declaration↔injection PARITY
 * property (available ⇔ collectRepoContext produces a non-empty fullFile
 * section) for the two false-parity cases the review flagged: security
 * deny-globs and a tight token budget.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { resolveFullFileSupply, isFullFileSupplyEnabled } from '../src/lib/fullfile-supply.mjs';
import { collectRepoContext, SECTION_CAPS, FULLFILE_MAX_FILES } from '../src/lib/repo-context.mjs';
import { createTempDir, cleanupTempDir } from './helpers/temp-dir.mjs';

const PER_FILE = SECTION_CAPS.fullFile; // 3000

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return rel;
}

/** Count the "Full file:" sections collectRepoContext would inject. */
async function injectedFullFileCount(dir, changedFiles, opts = {}) {
  const ctx = await collectRepoContext({ changedFiles, repoRoot: dir, ...opts });
  return ctx.sections.filter((s) => s.label.startsWith('Full file:')).length;
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

describe('resolveFullFileSupply ledger', () => {
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
      const big = write(dir, 'src/big.ts', 'x'.repeat(PER_FILE + 500));
      const res = resolveFullFileSupply({ changedFiles: [big], repoRoot: dir, env: {} });
      assert.equal(res.available, true);
      assert.equal(res.supplied[0].truncated, true);
      assert.ok(res.supplied[0].chars <= PER_FILE + 32); // + truncation marker
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('total budget: overflow file is TRUNCATED and still supplied (no under-count)', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      // Three files at the per-file cap. Total char budget is 8000, so the
      // first two (3000 each) fit and the third is truncated to the remaining
      // ~2000 chars — supplied, not silently skipped whole (gemini fix).
      const f1 = write(dir, 'src/f1.ts', 'a'.repeat(PER_FILE));
      const f2 = write(dir, 'src/f2.ts', 'b'.repeat(PER_FILE));
      const f3 = write(dir, 'src/f3.ts', 'c'.repeat(PER_FILE));
      const res = resolveFullFileSupply({ changedFiles: [f1, f2, f3], repoRoot: dir, env: {} });
      assert.equal(res.supplied.length, 3);
      const third = res.supplied.find((s) => s.path === 'src/f3.ts');
      assert.ok(third && third.truncated, 'third file should be truncated to remaining budget');
      assert.ok(res.totalChars <= 8000 + 64);
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

  test('fail-safe: missing files are skipped, never throw', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const res = resolveFullFileSupply({
        changedFiles: ['src/does-not-exist.ts'],
        repoRoot: dir,
        env: {},
      });
      assert.equal(res.available, false);
      assert.ok(
        res.skipped.some((s) => s.path === 'src/does-not-exist.ts' && s.reason === 'missing')
      );
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('files beyond FULLFILE_MAX_FILES are recorded as beyond-file-limit', () => {
    const dir = createTempDir({ prefix: 'fullfile-supply-' });
    try {
      const files = [];
      for (let i = 0; i < FULLFILE_MAX_FILES + 2; i += 1) {
        files.push(write(dir, `src/f${i}.ts`, `export const v${i} = ${i};\n`));
      }
      const res = resolveFullFileSupply({ changedFiles: files, repoRoot: dir, env: {} });
      assert.equal(res.supplied.length, FULLFILE_MAX_FILES);
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

describe('declaration ↔ injection parity (#1606 warning-1)', () => {
  test('security deny-glob: secrets.* declared unavailable AND not injected', async () => {
    const dir = createTempDir({ prefix: 'fullfile-parity-' });
    try {
      // A source-extension file matching DEFAULT_DENY_GLOBS (**/secrets.*).
      const secret = write(
        dir,
        'src/secrets.js',
        'export const API_KEY = "AKIAEXAMPLE1234567890";\n'
      );
      const res = resolveFullFileSupply({ changedFiles: [secret], repoRoot: dir, env: {} });
      const injected = await injectedFullFileCount(dir, [secret]);
      // Parity: declaration false ⇔ zero injected sections. (Old code declared
      // available:true here while collectRepoContext injected nothing.)
      assert.equal(res.available, false);
      assert.equal(injected, 0);
      assert.ok(res.skipped.some((s) => s.path === 'src/secrets.js' && s.reason === 'excluded'));
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('tight token budget: nothing declared AND nothing injected', async () => {
    const dir = createTempDir({ prefix: 'fullfile-parity-' });
    try {
      const a = write(dir, 'src/a.ts', 'export const a = 1;\n');
      const context = { budget: { maxTokens: 0 } };
      const res = resolveFullFileSupply({ changedFiles: [a], repoRoot: dir, context, env: {} });
      const injected = await injectedFullFileCount(dir, [a], { context });
      assert.equal(res.available, false);
      assert.equal(injected, 0);
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('normal source file: declared available AND injected (positive parity)', async () => {
    const dir = createTempDir({ prefix: 'fullfile-parity-' });
    try {
      const a = write(dir, 'src/a.ts', 'export const a = 1;\n');
      const res = resolveFullFileSupply({ changedFiles: [a], repoRoot: dir, env: {} });
      const injected = await injectedFullFileCount(dir, [a]);
      assert.equal(res.available, true);
      assert.ok(injected >= 1);
    } finally {
      cleanupTempDir(dir);
    }
  });

  test('parity holds across a mixed change set', async () => {
    const dir = createTempDir({ prefix: 'fullfile-parity-' });
    try {
      const files = [
        write(dir, 'src/ok.ts', 'export const ok = 1;\n'),
        write(dir, 'src/secrets.ts', 'export const S = "x";\n'), // deny-glob
        write(dir, 'docs/n.md', '# n\n'), // non-source
      ];
      const res = resolveFullFileSupply({ changedFiles: files, repoRoot: dir, env: {} });
      const injected = await injectedFullFileCount(dir, files);
      // available ⇔ injected>0, and supplied count equals injected section count.
      assert.equal(res.available, injected > 0);
      assert.equal(res.supplied.length, injected);
    } finally {
      cleanupTempDir(dir);
    }
  });
});
