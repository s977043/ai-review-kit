import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncGuarded } from './helpers/spawn-guard.mjs';

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

// 子プロセスの起動は `spawnSyncGuarded` 経由に統一する（#1950）。素の spawnSync だと
// script が固まったときにテストごと固まり、さらに ppid=1 の孤児が残る。既定の
// タイムアウトは 30 秒で、実測ではこのファイル全体が 3〜4 秒、最も遅い 1 呼び出しでも
// 1 秒未満なので、遅いマシンでも偽陽性にならない。
function git(cwd, ...args) {
  const res = spawnSyncGuarded('git', args, { cwd, encoding: 'utf8' });
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

function runScript(repo, args, env) {
  return spawnSyncGuarded('bash', [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
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
  const dirty = spawnSyncGuarded(SCAN[0], SCAN.slice(1), { cwd: repo, encoding: 'utf8' });
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

// #1838 の回帰テスト。
// `git archive | tar -x` の形だと、tar が入力を最後まで読まずに終了した場合に
// git archive が SIGPIPE を受け、`set -euo pipefail` の下でスクリプト全体が
// exit 141 で落ちる。macOS の bsdtar は tar の EOF マーカーを読んだ時点で終了でき、
// git archive が付ける blocking factor 20 のパディングを読み捨てないため、この
// 経路に入りうる。どちらが先に終わるかはスケジューリング次第なので、実環境での
// 失敗は間欠的（本 repo では並列作業中に再現、静穏時の逐次実行では再現せず）。
// ただしこのテストが作る小さな repo では毎回失敗する側に倒れる。CI は
// ubuntu-latest でこの経路を踏まず、#1828 の追加時は全テストが green のまま
// このバグを通した。
//
// このテストは実環境の間欠性を再現するものではない。tar 実装にもタイミングにも
// 依存せず「パイプ方式であること」自体を検出するため、「入力を読み切らない tar」を
// PATH の shim で再現する。パイプ経由（`-f` 無し）で呼ばれたら少しだけ読んで終了し、
// ファイル経由（`-f`）なら本物の tar に委譲する。読み手が必ず先に抜けるので、
// パイプを使う実装なら確定的に 141 で落ち、中間ファイルを使う実装なら影響を受けない。
function makeEarlyExitTarShim(t) {
  const realTar = spawnSyncGuarded('sh', ['-c', 'command -v tar'], {
    encoding: 'utf8',
  }).stdout.trim();
  assert.ok(realTar, 'tar が PATH に見つかること');

  const bin = mkdtempSync(join(tmpdir(), 'rr-clean-tree-tarshim-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));

  const shim = join(bin, 'tar');
  writeFileSync(
    shim,
    [
      '#!/bin/sh',
      '# -f 付き（ファイル入力）は本物の tar に委譲する。',
      'for a in "$@"; do',
      '  case "$a" in',
      `    -f|--file|--file=*) exec ${realTar} "$@" ;;`,
      '  esac',
      'done',
      '# stdin 入力: 入力を読み切らずに正常終了する読み手を再現する。',
      'head -c 4096 >/dev/null 2>&1',
      'exit 0',
      '',
    ].join('\n')
  );
  chmodSync(shim, 0o755);
  return bin;
}

test('入力を読み切らない tar でも SIGPIPE で落ちない', (t) => {
  const repo = makeRepo(t);
  // パイプバッファ（macOS/Linux とも 64KiB 程度）を超える大きさにして、
  // 読み手が先に消えたときに書き手が必ず SIGPIPE を受ける状況を作る。
  writeFileSync(join(repo, 'big.txt'), 'a'.repeat(1024 * 1024));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'big');

  const bin = makeEarlyExitTarShim(t);
  const res = runScript(repo, ['--ref', 'HEAD', '--raw', '--', 'ls'], {
    PATH: `${bin}:${process.env.PATH}`,
  });

  assert.notEqual(res.status, 141, `SIGPIPE で落ちている: ${res.stderr}`);
  assert.equal(res.status, 0, res.stderr);
  // 展開自体も成立していること（shim が握り潰した空ツリーではないこと）。
  assert.match(res.stdout, /^tracked\.md$/m);
  assert.match(res.stdout, /^big\.txt$/m);
  // 展開に使った中間 tar が clean tree に残っていないこと。
  assert.doesNotMatch(res.stdout, /\.tar$/m);
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
