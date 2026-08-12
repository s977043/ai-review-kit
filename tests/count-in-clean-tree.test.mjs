import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/count-in-clean-tree.sh を実プロセス実行で検証する（refs #1827）。
// 使い捨ての git repo を作り、追跡済み / 追跡外 / .gitignore 対象の 3 種類を置いて、
// 「作業ツリーでは数えられるが clean tree では数えられない」ことを対比で確かめる。
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'count-in-clean-tree.sh'
);

const MARKER = 'CLEAN_TREE_MARKER';

function git(cwd, ...args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

// 追跡済み 1 件 / 追跡外 1 件 / .gitignore 対象 1 件を持つ repo を作る。
function makeRepo(t) {
  const repo = mkdtempSync(join(tmpdir(), 'rr-clean-tree-test-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'test');
  writeFileSync(join(repo, '.gitignore'), 'Working/\n');
  writeFileSync(join(repo, 'tracked.md'), `${MARKER}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');

  // 未 commit の新規ファイル（#1786 の混入源と同じ形）
  writeFileSync(join(repo, 'untracked.md'), `${MARKER}\n`);
  // .gitignore 対象（textlint のような FS 走査型ツールが数えてしまう側）
  mkdirSync(join(repo, 'Working'));
  writeFileSync(join(repo, 'Working', 'draft.md'), `${MARKER}\n`);

  return repo;
}

function runScript(repo, args) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' });
}

// FS 走査型ツールの代役。git を介さずディレクトリを歩いて MARKER を数える。
const SCAN = [
  'bash',
  '-c',
  `grep -rl --exclude-dir=.git ${MARKER} . | sort | tr -d ' ' | tr '\\n' ' '`,
];

test('clean tree では追跡外ファイルが数えられない', (t) => {
  const repo = makeRepo(t);

  // 作業ツリーで直接走査すると、追跡外と .gitignore 対象まで数えてしまう。
  const dirty = spawnSync(SCAN[0], SCAN.slice(1), { cwd: repo, encoding: 'utf8' });
  assert.equal(dirty.status, 0, dirty.stderr);
  const dirtyFiles = dirty.stdout.trim().split(' ').filter(Boolean).sort();
  assert.deepEqual(dirtyFiles, ['./Working/draft.md', './tracked.md', './untracked.md']);

  // clean tree では追跡済みの 1 件だけになる。
  const clean = runScript(repo, ['--ref', 'HEAD', '--raw', '--', ...SCAN]);
  assert.equal(clean.status, 0, clean.stderr);
  const cleanFiles = clean.stdout.trim().split(' ').filter(Boolean).sort();
  assert.deepEqual(cleanFiles, ['./tracked.md']);

  assert.ok(cleanFiles.length < dirtyFiles.length, '汚染分が減っていること');
});

test('一時ディレクトリが実行後に残らない', (t) => {
  const repo = makeRepo(t);

  const res = runScript(repo, ['--ref', 'HEAD', '--raw', '--', 'true']);
  assert.equal(res.status, 0, res.stderr);

  const m = /clean tree: (\S+) \(removed on exit\)/.exec(res.stderr);
  assert.ok(m, `stderr に clean tree のパスが出ていること: ${res.stderr}`);
  assert.equal(existsSync(m[1]), false, `一時ディレクトリが残っている: ${m[1]}`);
});

test('コマンドが失敗しても一時ディレクトリを片付け、exit code を伝播する', (t) => {
  const repo = makeRepo(t);

  const res = runScript(repo, ['--ref', 'HEAD', '--raw', '--', 'bash', '-c', 'exit 3']);
  assert.equal(res.status, 3);

  const m = /clean tree: (\S+) \(removed on exit\)/.exec(res.stderr);
  assert.ok(m, res.stderr);
  assert.equal(existsSync(m[1]), false, `一時ディレクトリが残っている: ${m[1]}`);
});

test('既定出力は ref と SHA とコマンドを含む貼り付け可能なブロックになる', (t) => {
  const repo = makeRepo(t);
  const sha = git(repo, 'rev-parse', 'HEAD');

  const res = runScript(repo, [
    '--ref',
    'HEAD',
    '--',
    'bash',
    '-c',
    `grep -c ${MARKER} tracked.md`,
  ]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^```console\n/);
  assert.match(res.stdout, /```\n$/);
  assert.ok(res.stdout.includes(sha), 'SHA が含まれること');
  assert.ok(res.stdout.includes('# exit code: 0'), 'exit code が含まれること');
  assert.ok(res.stdout.includes(MARKER), '実行コマンドが含まれること');
  // 実測値そのもの（tracked.md の 1 件）が出力に載る
  assert.match(res.stdout, /^1$/m);
});

test('解決できない ref はエラー終了する', (t) => {
  const repo = makeRepo(t);

  const res = runScript(repo, ['--ref', 'no-such-ref', '--', 'true']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /cannot resolve ref/);
});

test('コマンド未指定と未知オプションは usage エラーになる', (t) => {
  const repo = makeRepo(t);

  assert.equal(runScript(repo, []).status, 2);
  assert.equal(runScript(repo, ['--nope', '--', 'true']).status, 2);
  assert.equal(runScript(repo, ['--help']).status, 0);
});
