// tests/cli-base-option-scope.test.mjs
//
// #2065 — 「受理したオプションが実際に消費されているか」の機械的な検査。
//
// #2046 / #2051 / #2057 は `--base` を**読む**面での silent failure を順に
// 塞いだが、`--base` そのものは `src/cli.mjs` の単一 allowlist
// （`KNOWN_OPTION_TOKENS` と `if (arg === '--base')` の平坦な連鎖）にあり、
// 差分を扱わない面（`doctor` / `runs` / `eval` など）も受理して値を捨てていた。
// #2065 でコマンド別 allowlist（`COMMAND_SCOPED_OPTIONS`）を入れて閉じている。
//
// このファイルが担うのは、その allowlist が**実装からずれないこと**の固定である。
// exit code の全量は tests/cli-usage-error-exit-codes.test.mjs（canary）側で
// pin してあり、ここでは canary が見ない 2 つの軸を見る:
//
//   1. 宣言 vs 実装: `BASE_CONSUMING_SURFACES` に挙がっている面の集合と、
//      ソース上で実際に `parsed.base` を読むファイルの集合を、それぞれ独立に
//      固定する。新しい面が `parsed.base` を読み始めたのに allowlist を広げ
//      なければ（あるいはその逆でも）ここが落ちる。
//   2. 面ごとの受理 / 拒否: parseArgs を直接呼び、`--base main`（= 解決できる
//      正常な値）が面ごとに受理されるか拒否されるかを網羅的に確認する。
//      **解決できない ref ではなく解決できる ref で測る**のが要点で、前者だと
//      #2046 系の「値の検証」による拒否と区別がつかない。
//
// 2 の判定は parseArgs の `usageError` フラグだけで行い、実行時の副作用を持ち
// 込まない（canary の VALID_CASES と同じ方針）。

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

import { BASE_CONSUMING_SURFACES, parseArgs } from '../src/cli.mjs';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * `src/` 配下の `.mjs` を再帰列挙する。
 * @param {string} dir
 * @returns {string[]} 絶対パス
 */
function listSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSourceFiles(abs));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) found.push(abs);
  }
  return found.sort();
}

describe('#2065 --base command-scoped allowlist', () => {
  test('the declared consuming surfaces are exactly the five diff-reading ones', () => {
    assert.deepEqual(
      [...BASE_CONSUMING_SURFACES].sort(),
      ['review exec', 'review plan', 'review route', 'run', 'skills'].sort(),
      '`--base` を読む面を増減させたなら、この期待値と pages/reference/runner-cli-reference.md（ja/en）も同じ PR で更新すること'
    );
  });

  test('the files that read `parsed.base` are exactly the pinned set', () => {
    // `--base` の値がソース上でどこへ流れるかの実測。ここが増えたのに
    // BASE_CONSUMING_SURFACES が変わっていなければ、新しい面が値を読んでいる
    // のに parse 層が拒否している（またはその逆）ことになる。
    // src/lib/git.mjs は解決ヘルパー（resolveBaseMergeBase）の実装そのもの、
    // src/lib/local-runner.mjs は `run` 面の実体で、いずれも面ではない。
    const readers = listSourceFiles(SRC_DIR)
      .filter((abs) => {
        const source = readFileSync(abs, 'utf8');
        return /parsed\??\.base\b/.test(source) || /resolveBaseMergeBase/.test(source);
      })
      .map((abs) => relative(REPO_ROOT, abs).split('\\').join('/'))
      .sort();
    assert.deepEqual(readers, [
      'src/cli.mjs',
      'src/cli/commands/review.mjs',
      'src/cli/commands/run.mjs',
      'src/cli/commands/skills.mjs',
      'src/lib/git.mjs',
      'src/lib/local-runner.mjs',
    ]);
  });

  // 面ごとの代表 argv。`--base` を付けない状態では usage error にならない形を
  // 選んである（そうでないと `--base` の可否ではなく別の理由を測ってしまう）。
  const SURFACES = [
    { surface: 'run', argv: ['run', '.'] },
    { surface: 'doctor', argv: ['doctor', '.'] },
    { surface: 'skills', argv: ['skills', '.'] },
    { surface: 'skills list', argv: ['skills', 'list'] },
    { surface: 'skills resolve', argv: ['skills', 'resolve', '--path', 'a.txt'] },
    { surface: 'skills export', argv: ['skills', 'export', '--to', 'exported'] },
    { surface: 'skills import', argv: ['skills', 'import', '--from', 'incoming'] },
    { surface: 'runs list', argv: ['runs', 'list'] },
    { surface: 'runs summary', argv: ['runs', 'summary'] },
    { surface: 'runs digest', argv: ['runs', 'digest'] },
    { surface: 'review plan', argv: ['review', 'plan', '--plan-only'] },
    { surface: 'review exec', argv: ['review', 'exec', '--dry-run'] },
    { surface: 'review route', argv: ['review', 'route'] },
    { surface: 'review verify', argv: ['review', 'verify'] },
    { surface: 'eval', argv: ['eval'] },
    {
      surface: 'feedback add',
      argv: ['feedback', 'add', '--type', 'false_positive', '--skill', 'demo-skill'],
    },
    {
      surface: 'suppression add',
      argv: [
        'suppression',
        'add',
        '--fingerprint',
        '0123456789abcdef',
        '--feedback',
        'false_positive',
        '--rationale',
        'because',
      ],
    },
  ];

  test('every listed surface parses cleanly without --base (control)', () => {
    for (const { surface, argv } of SURFACES) {
      assert.equal(
        parseArgs(argv).usageError,
        false,
        `${surface}: --base 抜きの代表 argv が usage error になっている（測定の前提が崩れている）`
      );
    }
  });

  for (const { surface, argv } of SURFACES) {
    const consumes = BASE_CONSUMING_SURFACES.has(surface);
    test(`\`river ${surface} --base main\` is ${consumes ? 'accepted' : 'rejected'}`, () => {
      const parsed = parseArgs([...argv, '--base', 'main']);
      assert.equal(
        parsed.usageError,
        !consumes,
        consumes
          ? `${surface} は --base を読む面なので受理され続けなければならない`
          : `${surface} は --base を読まないので usage error にならなければならない`
      );
    });
  }

  test('the option is rejected regardless of where it is written in argv', () => {
    // `review` はサブコマンドを前後どちらにも書ける（#1755）。判定を parse
    // ループ内ではなく post-loop に置いたのはこのためで、語順で結論が割れない
    // ことを固定する。
    assert.equal(parseArgs(['review', '--base', 'main', 'verify']).usageError, true);
    assert.equal(parseArgs(['review', 'verify', '--base', 'main']).usageError, true);
    assert.equal(parseArgs(['review', '--base', 'main', 'route']).usageError, false);
    assert.equal(parseArgs(['review', 'route', '--base', 'main']).usageError, false);
  });

  test('--help and the bare command keep their exit-0 contract', () => {
    // `-h` / `--help` は argv のどこにあっても command を 'help' へ倒すため、
    // ここで拒否すると `river run . --base main --help` が usage error になる。
    assert.equal(parseArgs(['doctor', '.', '--base', 'main', '--help']).usageError, false);
    assert.equal(parseArgs(['--base', 'main']).usageError, false);
  });
});
