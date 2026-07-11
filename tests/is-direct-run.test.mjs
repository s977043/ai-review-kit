/**
 * Regression tests for scripts/lib/is-direct-run.mjs (F-1).
 *
 * Root cause: three different inline "is this module the CLI entry point?"
 * implementations coexisted across scripts/*.mjs. The canonical form
 * (`import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href`,
 * with no error handling) throws ENOENT *at import time* whenever
 * `process.argv[1]` does not resolve to a real file — e.g. `node
 * --input-type=module -` (stdin-piped ESM), which leaves `process.argv[1]`
 * set to the literal string `'-'`. This is not hypothetical: it crashes any
 * script using that inline form the moment it is `import`-ed rather than
 * run directly, and was independently reproduced by Codex.
 *
 * These tests assert:
 *   (a) a module run directly is detected as a direct run;
 *   (b) a missing / non-existent process.argv[1] returns false and never
 *       throws;
 *   (c) piping `import '<script>'` via stdin (`node --input-type=module -`)
 *       does not crash any of the migrated scripts (they exit 0 without
 *       running their CLI entry point body).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isDirectRun } from '../scripts/lib/is-direct-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const HELPER_PATH = join(REPO_ROOT, 'scripts', 'lib', 'is-direct-run.mjs');

describe('isDirectRun (in-process)', () => {
  test('falsy process.argv[1] returns false without throwing', () => {
    const original = process.argv[1];
    try {
      process.argv[1] = undefined;
      assert.equal(isDirectRun('file:///anything'), false);
      process.argv[1] = '';
      assert.equal(isDirectRun('file:///anything'), false);
    } finally {
      process.argv[1] = original;
    }
  });

  test('non-existent / synthetic argv[1] path returns false without throwing (stdin-import repro)', () => {
    const original = process.argv[1];
    try {
      // '-' is what node sets process.argv[1] to under `node --input-type=module -`.
      process.argv[1] = '-';
      assert.doesNotThrow(() => isDirectRun('file:///whatever/module.mjs'));
      assert.equal(isDirectRun('file:///whatever/module.mjs'), false);

      process.argv[1] = '/definitely/does/not/exist/on/disk-xyz.mjs';
      assert.doesNotThrow(() => isDirectRun('file:///whatever/module.mjs'));
      assert.equal(isDirectRun('/whatever/module.mjs'), false);
    } finally {
      process.argv[1] = original;
    }
  });
});

describe('isDirectRun (subprocess: real direct execution)', () => {
  test('a module run directly via `node <file>` is detected as a direct run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rr-is-direct-run-'));
    try {
      const scratch = join(dir, 'scratch.mjs');
      writeFileSync(
        scratch,
        `import { isDirectRun } from ${JSON.stringify(pathToFileURL(HELPER_PATH).href)};\n` +
          `process.stdout.write(String(isDirectRun(import.meta.url)));\n`
      );
      const out = execFileSync(process.execPath, [scratch], { encoding: 'utf8' });
      assert.equal(out, 'true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the same module merely imported (not the entry point) is not a direct run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rr-is-direct-run-'));
    try {
      const scratch = join(dir, 'scratch.mjs');
      writeFileSync(
        scratch,
        `import { isDirectRun } from ${JSON.stringify(pathToFileURL(HELPER_PATH).href)};\n` +
          `process.stdout.write(String(isDirectRun(import.meta.url)));\n`
      );
      // Import scratch.mjs from stdin: process.argv[1] becomes '-', which
      // never matches scratch.mjs's own import.meta.url.
      const out = execFileSync(process.execPath, ['--input-type=module', '-'], {
        input: `import ${JSON.stringify(pathToFileURL(scratch).href)};\n`,
        encoding: 'utf8',
      });
      assert.equal(out, 'false');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('migrated scripts survive stdin-import (would have crashed pre-fix)', () => {
  // A representative sample of scripts migrated off the crash-prone inline
  // form (pathToFileURL(realpathSync(process.argv[1]))) and the endsWith
  // form, onto the shared isDirectRun() helper.
  const MIGRATED_SCRIPTS = [
    'check-code-hygiene.mjs',
    'check-skill-id-references.mjs',
    'generate-skill-manifest.mjs',
    'validate-skills.mjs',
    'skill-changelog.mjs',
    'evaluate-convergence-efficiency.mjs',
  ];

  for (const name of MIGRATED_SCRIPTS) {
    test(`\`import '${name}'\` via \`node --input-type=module -\` exits 0 (no ENOENT crash)`, () => {
      const scriptPath = join(REPO_ROOT, 'scripts', name);
      const importSrc = `import ${JSON.stringify(pathToFileURL(scriptPath).href)};\n`;
      // Should not throw: a non-zero/crash exit would make execFileSync throw.
      assert.doesNotThrow(() => {
        execFileSync(process.execPath, ['--input-type=module', '-'], {
          input: importSrc,
          cwd: REPO_ROOT,
          stdio: 'pipe',
        });
      });
    });
  }
});
