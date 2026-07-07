/**
 * Deterministic command executor tests (#1401 §11.8 (b)).
 *
 * Exercises the execFile launch + exit-code classification (§11.5.1) against
 * TRUSTED OS binaries only (`/usr/bin/true`, `/usr/bin/false`, `/bin/echo`,
 * `/usr/bin/env`, `/bin/sleep` — detected at runtime; missing ones are skipped).
 * Nothing untrusted is ever executed.
 *
 * Covers: pass (exit 0), fail (STRICT_BLOCK, exit non-zero), spawn-error
 * (ENOENT), invalid-entry (re-validation blocks execution — no process),
 * timeout, no-stdout-in-return-value, env scrubbing proven at runtime (child
 * cannot see GITHUB_TOKEN), and shell-non-invocation (`;` / `$()` args are inert
 * text, not shell metacharacters).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  executeDeterministicCommand,
  DETERMINISTIC_PASS,
  STRICT_BLOCK,
  DETERMINISTIC_UNRUNNABLE,
} from '../src/lib/deterministic-command-executor.mjs';
import { buildSandboxEnv } from '../src/lib/deterministic-command-sandbox.mjs';

/** Return the first existing absolute path from a candidate list, or null. */
function firstExisting(candidates) {
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // not present on this platform; try next
    }
  }
  return null;
}

const BIN = {
  true: firstExisting(['/usr/bin/true', '/bin/true']),
  false: firstExisting(['/usr/bin/false', '/bin/false']),
  echo: firstExisting(['/bin/echo', '/usr/bin/echo']),
  printenv: firstExisting(['/usr/bin/printenv', '/bin/printenv']),
  sleep: firstExisting(['/bin/sleep', '/usr/bin/sleep']),
};

/** A minimal valid entry (absolute command, selfContained). */
function validEntry(command, args = []) {
  return { command, args, selfContained: true };
}

describe('executeDeterministicCommand — exit-code classification (§11.5.1)', () => {
  test('exit 0 → pass (DETERMINISTIC_PASS)', { skip: !BIN.true }, async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'river-exec-test-'));
    try {
      const env = buildSandboxEnv({ PATH: '/usr/bin' }, { home: dir });
      const result = await executeDeterministicCommand({
        entry: validEntry(BIN.true),
        sandboxDir: dir,
        env,
      });
      assert.equal(result.status, 'pass');
      assert.equal(result.reasonCode, DETERMINISTIC_PASS);
      assert.equal(result.exitCode, 0);
      assert.equal(typeof result.durationMs, 'number');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('exit non-zero → fail (STRICT_BLOCK) with exitCode', { skip: !BIN.false }, async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'river-exec-test-'));
    try {
      const env = buildSandboxEnv({ PATH: '/usr/bin' }, { home: dir });
      const result = await executeDeterministicCommand({
        entry: validEntry(BIN.false),
        sandboxDir: dir,
        env,
      });
      assert.equal(result.status, 'fail');
      assert.equal(result.reasonCode, STRICT_BLOCK);
      assert.ok(typeof result.exitCode === 'number' && result.exitCode !== 0);
      assert.equal(result.unrunnableCause, undefined);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('nonexistent absolute path → unrunnable (spawn-error)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'river-exec-test-'));
    try {
      const env = buildSandboxEnv({ PATH: '/usr/bin' }, { home: dir });
      const result = await executeDeterministicCommand({
        entry: validEntry('/nonexistent/river-no-such-binary-xyz'),
        sandboxDir: dir,
        env,
      });
      assert.equal(result.status, 'unrunnable');
      assert.equal(result.reasonCode, DETERMINISTIC_UNRUNNABLE);
      assert.equal(result.unrunnableCause, 'spawn-error');
      assert.equal(result.exitCode, undefined);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('invalid entry (no selfContained) is NOT executed → unrunnable (invalid-entry)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'river-exec-test-'));
    try {
      const env = buildSandboxEnv({ PATH: '/usr/bin' }, { home: dir });
      // Point at a binary that WOULD exit 0, to prove re-validation blocks it
      // before any execution (result must be invalid-entry, not pass).
      const result = await executeDeterministicCommand({
        entry: { command: BIN.true ?? '/usr/bin/true', args: [] }, // selfContained missing
        sandboxDir: dir,
        env,
      });
      assert.equal(result.status, 'unrunnable');
      assert.equal(result.reasonCode, DETERMINISTIC_UNRUNNABLE);
      assert.equal(result.unrunnableCause, 'invalid-entry');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('interpreter entry (node) is NOT executed → unrunnable (invalid-entry)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'river-exec-test-'));
    try {
      const env = buildSandboxEnv({ PATH: '/usr/bin' }, { home: dir });
      const result = await executeDeterministicCommand({
        entry: validEntry('/usr/bin/node', ['-e', 'process.exit(0)']),
        sandboxDir: dir,
        env,
      });
      assert.equal(result.status, 'unrunnable');
      assert.equal(result.unrunnableCause, 'invalid-entry');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('timeout → unrunnable (timeout)', { skip: !BIN.sleep }, async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'river-exec-test-'));
    try {
      const env = buildSandboxEnv({ PATH: '/usr/bin' }, { home: dir });
      const result = await executeDeterministicCommand({
        entry: validEntry(BIN.sleep, ['5']),
        sandboxDir: dir,
        env,
        limits: { timeoutMs: 100 },
      });
      assert.equal(result.status, 'unrunnable');
      assert.equal(result.reasonCode, DETERMINISTIC_UNRUNNABLE);
      assert.equal(result.unrunnableCause, 'timeout');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('executeDeterministicCommand — stdout / env / shell hardening (§10.3, §11.3, §3.4)', () => {
  test('stdout is NOT included in the return value', { skip: !BIN.echo }, async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'river-exec-test-'));
    try {
      const env = buildSandboxEnv({ PATH: '/usr/bin' }, { home: dir });
      const secret = 'SENTINEL_STDOUT_abcdef123456';
      const result = await executeDeterministicCommand({
        entry: validEntry(BIN.echo, [secret]),
        sandboxDir: dir,
        env,
      });
      assert.equal(result.status, 'pass');
      // No field may carry the printed bytes.
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes(secret), 'return value must not contain stdout');
      assert.equal(result.stdout, undefined);
      assert.equal(result.stderr, undefined);
      // Only the byte length may be recorded.
      assert.ok(typeof result.stdoutBytes === 'number');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('env scrub: child cannot see GITHUB_TOKEN at runtime', { skip: !BIN.printenv }, async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'river-exec-test-'));
    try {
      // buildSandboxEnv drops GITHUB_TOKEN by construction (SAFE_ENV allowlist).
      const env = buildSandboxEnv(
        { PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_should_never_reach_child' },
        { home: dir }
      );
      assert.equal(env.GITHUB_TOKEN, undefined, 'precondition: env object is scrubbed');
      // RUNTIME proof: `printenv GITHUB_TOKEN` exits 0 if the child sees the
      // variable, non-zero if it does not. The executor never merges
      // process.env, so the child sees a scrubbed env → non-zero exit → `fail`.
      // (A leak would surface as `pass` / exitCode 0, which we assert against.)
      const result = await executeDeterministicCommand({
        entry: validEntry(BIN.printenv, ['GITHUB_TOKEN']),
        sandboxDir: dir,
        env,
      });
      assert.equal(result.status, 'fail', 'child must NOT see GITHUB_TOKEN (non-zero exit)');
      assert.notEqual(result.exitCode, 0);
      assert.ok(!JSON.stringify(result).includes('ghp_should_never_reach_child'));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test(
    'shell metacharacters in args are inert (no shell) — exit 0',
    { skip: !BIN.echo },
    async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'river-exec-test-'));
      try {
        const env = buildSandboxEnv({ PATH: '/usr/bin' }, { home: dir });
        // A shell would interpret `;` and `$(...)`; execFile passes them as
        // literal argv text, so echo just prints them and exits 0. A canary file
        // proves no side-effect subshell ran.
        const canary = path.join(dir, 'canary-should-not-exist');
        const result = await executeDeterministicCommand({
          entry: validEntry(BIN.echo, [`; touch ${canary}`, '$(touch ' + canary + ')', '&&', '|']),
          sandboxDir: dir,
          env,
        });
        assert.equal(result.status, 'pass');
        assert.equal(result.exitCode, 0);
        assert.equal(fs.existsSync(canary), false, 'no subshell side-effect may occur');
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    }
  );
});
