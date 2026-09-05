import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncGuarded } from './helpers/spawn-guard.mjs';

// scripts/worker-cleanup.sh を実プロセス実行で固定する。
// 使い捨ての bare origin + clone を fixture にし、worker-bootstrap.sh と同じ場所
// （<main>/.claude/worktrees/<slug>、slug は `tr '/' '-'`）に worktree を置いて、
// exit code 契約（0 = 完了 / 1 = 拒否・失敗 / 64 = usage・保護ブランチ）を検査する。
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'worker-cleanup.sh');

const BRANCH = 'tmp/cleanup-test';
const SLUG = 'tmp-cleanup-test';

function git(cwd, ...args) {
  const res = spawnSyncGuarded('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

// bare origin + main checkout（.claude/ 付き）+ 作業 worktree + 基準線 manifest。
function makeFixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rr-cleanup-test-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const origin = join(base, 'origin.git');
  const main = join(base, 'main');
  const stateDir = join(base, 'state');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(base, 'clone', '-q', origin, main);
  git(main, 'config', 'user.email', 'test@example.com');
  git(main, 'config', 'user.name', 'test');
  writeFileSync(join(main, 'tracked.md'), 'x\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  git(main, 'push', '-q', '-u', 'origin', 'main');
  mkdirSync(join(main, '.claude', 'worktrees'), { recursive: true });
  const worktree = join(main, '.claude', 'worktrees', SLUG);
  git(main, 'worktree', 'add', '-q', worktree, '-b', BRANCH, 'origin/main');
  mkdirSync(stateDir, { recursive: true });
  const manifest = join(stateDir, `worker-bootstrap-${SLUG}.txt`);
  writeFileSync(manifest, '# worker-bootstrap manifest\n');
  return { main, worktree, stateDir, manifest };
}

function run(fx, args = [BRANCH]) {
  return spawnSyncGuarded('bash', [SCRIPT, ...args], {
    cwd: fx.main,
    encoding: 'utf8',
    env: { ...process.env, RIVER_WORKER_STATE_DIR: fx.stateDir },
  });
}

function hasWorktree(fx) {
  return git(fx.main, 'worktree', 'list', '--porcelain').includes(`worktree ${fx.worktree}`);
}

function hasBranch(fx) {
  const res = spawnSyncGuarded('git', ['show-ref', '--verify', '--quiet', `refs/heads/${BRANCH}`], {
    cwd: fx.main,
    encoding: 'utf8',
  });
  return res.status === 0;
}

test('クリーンな worktree は remove + branch -D + manifest 退避で exit 0', (t) => {
  const fx = makeFixture(t);
  const res = run(fx);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(hasWorktree(fx), false, 'worktree should be unregistered');
  assert.equal(existsSync(fx.worktree), false, 'worktree dir should be gone');
  assert.equal(hasBranch(fx), false, 'local branch should be deleted');
  assert.equal(existsSync(fx.manifest), false, 'manifest should be moved out');
  assert.equal(existsSync(join(fx.stateDir, 'archive', `worker-bootstrap-${SLUG}.txt`)), true);
  assert.match(res.stdout, /== 4\. merge --ff-only origin\/main/);
});

test('worktree に未 commit 変更があれば remove せず一覧を出して exit 1', (t) => {
  const fx = makeFixture(t);
  writeFileSync(join(fx.worktree, 'dirty.txt'), 'y\n');
  const res = run(fx);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /uncommitted changes/);
  assert.match(res.stderr, /dirty\.txt/);
  assert.equal(hasWorktree(fx), true, 'worktree must survive');
  assert.equal(hasBranch(fx), true, 'branch must survive');
  assert.equal(existsSync(fx.manifest), true, 'manifest must stay');
});

test('main checkout が main 以外にいれば何もせず exit 1', (t) => {
  const fx = makeFixture(t);
  git(fx.main, 'switch', '-q', '-c', 'other');
  const res = run(fx);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /not 'main'/);
  assert.equal(hasWorktree(fx), true, 'worktree must survive');
  assert.equal(hasBranch(fx), true, 'branch must survive');
  assert.equal(existsSync(fx.manifest), true, 'manifest must stay');
});

test('main / master / release-please--* は exit 64 で拒否', (t) => {
  const fx = makeFixture(t);
  for (const name of ['main', 'master', 'release-please--branches--main']) {
    const res = run(fx, [name]);
    assert.equal(res.status, 64, `${name}: ${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /protected branch/);
  }
  assert.equal(hasWorktree(fx), true, 'worktree must survive');
});

test('引数なしは exit 64', (t) => {
  const fx = makeFixture(t);
  const res = run(fx, []);
  assert.equal(res.status, 64, res.stdout + res.stderr);
});
