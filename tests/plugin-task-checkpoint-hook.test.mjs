// scripts/plugin-task-checkpoint-hook.sh (#2054 PR-5): the Claude Code Stop
// adapter for the neutral `task-checkpoint` trigger. It writes a file (the
// Review Artifact under the temp dir), so its failure modes are injected here
// rather than assumed: every prerequisite that is missing must exit 0 without
// writing anything (fail-soft, never blocks the host session), and the happy
// path must produce an artifact pinned to `review-task`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTempGitRepo } from './helpers/temp-repo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'plugin-task-checkpoint-hook.sh');

async function runHook({ cwd, env, stdin = '' }) {
  const child = execFile('bash', [SCRIPT], { cwd, env }, () => {});
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  child.stdin.end(stdin);
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, stdout, stderr };
}

const artifactsIn = (tmp) => {
  const dir = path.join(tmp, 'river-review-task-checkpoint');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
};

describe('plugin-task-checkpoint-hook.sh (#2054 PR-5)', () => {
  test('happy path: emits a Review Artifact pinned to review-task and exits 0', async (t) => {
    const { dir, cleanup } = await createTempGitRepo({
      prefix: 'river-hook-checkpoint-',
      initialFiles: { 'src/app.js': 'export const value = 1;\n' },
      changedFiles: { 'src/app.js': 'export const value = 2;\n' },
    });
    t.after(cleanup);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'river-hook-tmp-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const result = await runHook({
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: REPO_ROOT, TMPDIR: tmp },
      stdin: JSON.stringify({ stop_hook_active: false }),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /pinned to entry review-task: /);
    const files = artifactsIn(tmp);
    assert.equal(files.length, 1, `expected one artifact, got ${files}`);
    const artifact = JSON.parse(
      fs.readFileSync(path.join(tmp, 'river-review-task-checkpoint', files[0]), 'utf8')
    );
    assert.equal(artifact.flow?.entry, 'review-task');
    assert.equal(artifact.flow?.id, 'task-completion-review');
    // The artifact stays out of the consumer's working tree.
    assert.ok(!fs.existsSync(path.join(dir, '.river')), 'hook wrote into the project tree');
  });

  test('stop_hook_active=true: exits 0 immediately and writes nothing', async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'river-hook-tmp-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const result = await runHook({
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: REPO_ROOT,
        CLAUDE_PLUGIN_ROOT: REPO_ROOT,
        TMPDIR: tmp,
      },
      stdin: JSON.stringify({ stop_hook_active: true }),
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.deepEqual(artifactsIn(tmp), []);
  });

  test('CLI unavailable (no plugin node_modules, no npm install): exits 0 with a notice, writes nothing', async (t) => {
    const { dir, cleanup } = await createTempGitRepo({
      prefix: 'river-hook-nocli-',
      initialFiles: { 'src/app.js': 'export const value = 1;\n' },
    });
    t.after(cleanup);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'river-hook-tmp-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    // A plugin root that has src/cli.mjs but no node_modules.
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'river-hook-plugin-'));
    t.after(() => fs.rmSync(pluginRoot, { recursive: true, force: true }));
    fs.mkdirSync(path.join(pluginRoot, 'src'));
    fs.writeFileSync(path.join(pluginRoot, 'src', 'cli.mjs'), '');

    const result = await runHook({
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: pluginRoot, TMPDIR: tmp },
      stdin: '{}',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /CLI not available/);
    assert.deepEqual(artifactsIn(tmp), []);
  });

  test('not a git repository: exits 0 with a notice, writes nothing', async (t) => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'river-hook-nogit-'));
    t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'river-hook-tmp-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const result = await runHook({
      cwd: plain,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: plain,
        CLAUDE_PLUGIN_ROOT: REPO_ROOT,
        TMPDIR: tmp,
      },
      stdin: '{}',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /not a git repository/);
    assert.deepEqual(artifactsIn(tmp), []);
  });

  test('CLI failure is fail-soft: exits 0, reports, keeps the log, never blocks', async (t) => {
    const { dir, cleanup } = await createTempGitRepo({
      prefix: 'river-hook-clifail-',
      initialFiles: { 'src/app.js': 'export const value = 1;\n' },
    });
    t.after(cleanup);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'river-hook-tmp-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    // Injected failure: point the loader at a flows directory that does not
    // exist, so `review plan --entry` exits 1 with `flows directory not found`.
    const result = await runHook({
      cwd: dir,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: dir,
        CLAUDE_PLUGIN_ROOT: REPO_ROOT,
        TMPDIR: tmp,
        RIVER_FLOWS_DIR: path.join(tmp, 'no-such-flows'),
      },
      stdin: '{}',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /did not complete \(see .*\.log\), continuing/);
    assert.deepEqual(artifactsIn(tmp), [], 'a failed run must not leave an artifact');
    const logs = fs
      .readdirSync(path.join(tmp, 'river-review-task-checkpoint'))
      .filter((f) => f.endsWith('.log'));
    assert.equal(logs.length, 1);
    assert.match(
      fs.readFileSync(path.join(tmp, 'river-review-task-checkpoint', logs[0]), 'utf8'),
      /flows directory not found/
    );
  });
});
