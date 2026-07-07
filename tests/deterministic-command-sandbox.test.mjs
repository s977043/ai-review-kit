/**
 * Deterministic command sandbox preparation-layer tests (#1401 §11.8 (a)).
 *
 * Covers env scrubbing (§11.3) and clean-cwd staging (§11.2 / §10.3.2 (A)):
 * SAFE_ENV allowlist only, secret / NODE_OPTIONS scrub, HOME pinned to an empty
 * temp dir, processEnv immutability, symlink non-following (including a symlink
 * aimed at a `~/.aws`-style target and a symlinked parent directory), `.git`
 * exclusion, and no residual symlink after copy.
 *
 * This is a pure preparation layer — no process is ever spawned; the test file
 * asserts that too (no child_process usage in the module under test).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  buildSandboxEnv,
  copyReviewTargetToSandbox,
  makeSandboxTempDir,
  SAFE_ENV_ALLOWLIST,
} from '../src/lib/deterministic-command-sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('buildSandboxEnv — SAFE_ENV allowlist (§11.3)', () => {
  const home = path.join(os.tmpdir(), 'empty-home-xyz');

  test('only SAFE_ENV keys pass through', () => {
    const env = buildSandboxEnv(
      { PATH: '/usr/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', UNLISTED: 'nope' },
      { home }
    );
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.LANG, 'C');
    assert.equal(env.LC_ALL, 'C');
    assert.equal(env.TZ, 'UTC');
    assert.equal(env.UNLISTED, undefined);
  });

  test('GITHUB_TOKEN / AWS_SECRET_ACCESS_KEY / NODE_OPTIONS are NOT inherited', () => {
    const parent = {
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghp_secret',
      GITHUB_ACTIONS: 'true',
      AWS_SECRET_ACCESS_KEY: 'akiasecret',
      AWS_ACCESS_KEY_ID: 'AKIA...',
      NODE_OPTIONS: '--require ./evil.js',
      NODE_PATH: '/evil',
      SOME_TOKEN: 't',
      SOME_SECRET: 's',
    };
    const env = buildSandboxEnv(parent, { home });
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GITHUB_ACTIONS, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.NODE_PATH, undefined);
    assert.equal(env.SOME_TOKEN, undefined);
    assert.equal(env.SOME_SECRET, undefined);
    // Sanity: only allowlisted + HOME/XDG_CONFIG_HOME keys are present.
    const keys = Object.keys(env).sort();
    assert.deepEqual(keys, ['HOME', 'PATH', 'XDG_CONFIG_HOME']);
  });

  test('HOME points at the provided empty temp dir, not the real $HOME', () => {
    const env = buildSandboxEnv({ HOME: '/home/runner', PATH: '/usr/bin' }, { home });
    assert.equal(env.HOME, home);
    assert.notEqual(env.HOME, '/home/runner');
    // XDG_CONFIG_HOME is pinned to the same empty dir (§10.1 (D)).
    assert.equal(env.XDG_CONFIG_HOME, home);
  });

  test('real XDG_CONFIG_HOME from parent is overridden, not inherited', () => {
    const env = buildSandboxEnv({ XDG_CONFIG_HOME: '/home/runner/.config' }, { home });
    assert.equal(env.XDG_CONFIG_HOME, home);
  });

  test('does not mutate processEnv', () => {
    const parent = { PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_secret' };
    const snapshot = { ...parent };
    buildSandboxEnv(parent, { home });
    assert.deepEqual(parent, snapshot);
  });

  test('missing home throws (fail-safe)', () => {
    assert.throws(() => buildSandboxEnv({ PATH: '/usr/bin' }), TypeError);
    assert.throws(() => buildSandboxEnv({ PATH: '/usr/bin' }, { home: '' }), TypeError);
  });

  test('non-string SAFE_ENV values are skipped', () => {
    const env = buildSandboxEnv({ PATH: 12345, LANG: 'C' }, { home });
    assert.equal(env.PATH, undefined);
    assert.equal(env.LANG, 'C');
  });

  test('SAFE_ENV_ALLOWLIST is exactly the four documented keys', () => {
    assert.deepEqual([...SAFE_ENV_ALLOWLIST], ['PATH', 'LANG', 'LC_ALL', 'TZ']);
  });
});

describe('copyReviewTargetToSandbox — clean cwd staging (§11.2)', () => {
  let sourceDir;
  let destDir;
  let secretDir;

  beforeEach(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'river-src-'));
    destDir = await fs.mkdtemp(path.join(os.tmpdir(), 'river-dest-'));
    secretDir = await fs.mkdtemp(path.join(os.tmpdir(), 'river-secret-'));
  });

  afterEach(async () => {
    for (const d of [sourceDir, destDir, secretDir]) {
      await fs.rm(d, { recursive: true, force: true });
    }
  });

  test('copies a normal file', async () => {
    await fs.writeFile(path.join(sourceDir, 'a.txt'), 'hello');
    const res = await copyReviewTargetToSandbox({ sourceDir, destDir, files: ['a.txt'] });
    assert.deepEqual(res.copied, ['a.txt']);
    assert.equal(await fs.readFile(path.join(destDir, 'a.txt'), 'utf8'), 'hello');
  });

  test('copies a nested file, creating parent dirs', async () => {
    await fs.mkdir(path.join(sourceDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'src', 'b.js'), 'code');
    const res = await copyReviewTargetToSandbox({
      sourceDir,
      destDir,
      files: ['src/b.js'],
    });
    assert.deepEqual(res.copied, ['src/b.js']);
    assert.equal(await fs.readFile(path.join(destDir, 'src', 'b.js'), 'utf8'), 'code');
  });

  test('a symlink pointing at a ~/.aws-style secret is skipped, not copied', async () => {
    // Simulate `~/.aws/credentials` exfil: the review target is a symlink to it.
    const secretFile = path.join(secretDir, 'credentials');
    await fs.writeFile(secretFile, 'aws_secret_access_key=akiasecret');
    await fs.symlink(secretFile, path.join(sourceDir, 'creds.txt'));

    const res = await copyReviewTargetToSandbox({
      sourceDir,
      destDir,
      files: ['creds.txt'],
    });

    assert.deepEqual(res.copied, []);
    assert.deepEqual(res.skippedSymlinks, ['creds.txt']);
    // The secret must NOT exist in the clean cwd.
    await assert.rejects(fs.stat(path.join(destDir, 'creds.txt')));
  });

  test('a file reached THROUGH a symlinked parent directory is skipped', async () => {
    // `link -> secretDir`; entry `link/credentials` must not follow the parent.
    await fs.writeFile(path.join(secretDir, 'credentials'), 'secret');
    await fs.symlink(secretDir, path.join(sourceDir, 'link'));

    const res = await copyReviewTargetToSandbox({
      sourceDir,
      destDir,
      files: ['link/credentials'],
    });

    assert.deepEqual(res.copied, []);
    assert.deepEqual(res.skippedSymlinks, ['link/credentials']);
  });

  test('.git/config is excluded (token leak block)', async () => {
    await fs.mkdir(path.join(sourceDir, '.git'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, '.git', 'config'), 'extraheader = token');
    await fs.writeFile(path.join(sourceDir, 'keep.txt'), 'ok');

    const res = await copyReviewTargetToSandbox({
      sourceDir,
      destDir,
      files: ['.git/config', 'keep.txt'],
    });

    assert.deepEqual(res.skippedGit, ['.git/config']);
    assert.deepEqual(res.copied, ['keep.txt']);
    await assert.rejects(fs.stat(path.join(destDir, '.git', 'config')));
  });

  test('no residual symlink remains in destDir after copy', async () => {
    await fs.writeFile(path.join(secretDir, 'x'), 'secret');
    await fs.symlink(secretDir, path.join(sourceDir, 'link'));
    await fs.writeFile(path.join(sourceDir, 'ok.txt'), 'fine');

    await copyReviewTargetToSandbox({
      sourceDir,
      destDir,
      files: ['ok.txt', 'link/x'],
    });

    // Walk destDir and assert nothing is a symlink.
    async function assertNoSymlink(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        assert.equal(e.isSymbolicLink(), false, `unexpected symlink: ${e.name}`);
        if (e.isDirectory()) await assertNoSymlink(path.join(dir, e.name));
      }
    }
    await assertNoSymlink(destDir);
  });

  test('path traversal (..) and absolute paths are skipped', async () => {
    await fs.writeFile(path.join(secretDir, 'passwd'), 'root');
    const res = await copyReviewTargetToSandbox({
      sourceDir,
      destDir,
      files: ['../secret-outside', '/etc/passwd'],
    });
    assert.deepEqual(res.copied, []);
    assert.equal(res.skippedOutside.length, 2);
  });

  test('empty files array yields empty results', async () => {
    const res = await copyReviewTargetToSandbox({ sourceDir, destDir, files: [] });
    assert.deepEqual(res, {
      copied: [],
      skippedSymlinks: [],
      skippedGit: [],
      skippedOutside: [],
      errors: [],
    });
  });

  test('non-array / non-string entries are handled safely', async () => {
    await fs.writeFile(path.join(sourceDir, 'a.txt'), 'x');
    const res = await copyReviewTargetToSandbox({
      sourceDir,
      destDir,
      files: ['a.txt', '', null, 123, undefined],
    });
    assert.deepEqual(res.copied, ['a.txt']);
  });

  test('missing source file is recorded as an error, not thrown', async () => {
    const res = await copyReviewTargetToSandbox({
      sourceDir,
      destDir,
      files: ['does-not-exist.txt'],
    });
    assert.deepEqual(res.copied, []);
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0].file, 'does-not-exist.txt');
  });

  test('missing sourceDir / destDir throw (fail-safe)', async () => {
    await assert.rejects(copyReviewTargetToSandbox({ destDir, files: [] }), TypeError);
    await assert.rejects(copyReviewTargetToSandbox({ sourceDir, files: [] }), TypeError);
  });
});

describe('makeSandboxTempDir', () => {
  test('creates a fresh empty directory under os.tmpdir()', async () => {
    const dir = await makeSandboxTempDir();
    try {
      const stat = await fs.stat(dir);
      assert.ok(stat.isDirectory());
      assert.deepEqual(await fs.readdir(dir), []);
      assert.ok(dir.startsWith(os.tmpdir()));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('accepts an injected mkdtemp impl (testable)', async () => {
    let seenPrefix;
    const fake = async (prefix) => {
      seenPrefix = prefix;
      return '/fake/dir-abc';
    };
    const dir = await makeSandboxTempDir(fake);
    assert.equal(dir, '/fake/dir-abc');
    assert.ok(seenPrefix.includes('river-sandbox-'));
  });

  test('honors a custom prefix', async () => {
    let seenPrefix;
    const fake = async (prefix) => {
      seenPrefix = prefix;
      return prefix + 'xyz';
    };
    await makeSandboxTempDir(fake, '/custom/pre-');
    assert.equal(seenPrefix, '/custom/pre-');
  });
});

describe('no child process usage in the module (constraint)', () => {
  test('source imports no child_process / spawn / execFile / exec', () => {
    const raw = fsSync.readFileSync(
      path.join(HERE, '..', 'src', 'lib', 'deterministic-command-sandbox.mjs'),
      'utf8'
    );
    // Strip block and line comments so doc comments (which name these banned
    // APIs to explain their absence) do not trip the check; only real code —
    // imports and call sites — must be free of them.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /child_process/);
    assert.doesNotMatch(code, /\bspawn\s*\(/);
    assert.doesNotMatch(code, /\bexecFile\s*\(/);
    assert.doesNotMatch(code, /\bexec\s*\(/);
    assert.doesNotMatch(code, /from\s+['"](?:node:)?child_process['"]/);
    assert.doesNotMatch(code, /require\(\s*['"](?:node:)?child_process['"]\s*\)/);
  });
});
