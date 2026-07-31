// tests/cli-output-stream-routing.test.mjs
//
// #1695: `--output html` の実行ヘッダーが stdout に混入し、リダイレクトした
// HTML 成果物の先頭が壊れる問題の回帰テスト。
//
// 判定は「text 以外は stderr」に反転させてあるため、以後 --output に新しい
// 形式を追加しても同じ穴が空かない。このテストはその不変条件を、
//
//   - html: stdout が <!DOCTYPE html> で始まり </html> で終わる
//   - text: 実行ヘッダーは stdout（既定挙動は不変）
//   - markdown / json / yaml: 実行ヘッダーは stderr（既存挙動は不変）
//
// の3点で固定する。`river runs diff --output html`（Loop Dashboard）も
// 同型の漏れが無いことを併せて検証する。

import assert from 'node:assert';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import { createRepoWithSilentCatchChange, writeFileRelative } from './helpers/temp-repo.mjs';

const RUN_HEADER = /River Review \(local\)/;

// -----------------------------------------------------------------------------
// river run - run header stream routing
// -----------------------------------------------------------------------------

describe('river run - run header stream routing (#1695)', () => {
  test('html stdout starts at the doctype and carries no run header', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run', '--output', 'html'], {
      cwd: dir,
    });

    assert.strictEqual(result.code, 0, result.stderr);
    // Redirecting stdout to a file must yield a valid HTML document.
    assert.match(result.stdout, /^<!DOCTYPE html>\n<html lang="ja">/);
    assert.match(result.stdout.trimEnd(), /<\/html>$/);
    assert.doesNotMatch(result.stdout, RUN_HEADER);
    assert.match(result.stderr, RUN_HEADER);
  });

  test('text keeps the run header on stdout (default behavior unchanged)', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run', '--output', 'text'], {
      cwd: dir,
    });

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, RUN_HEADER);
    assert.doesNotMatch(result.stderr, RUN_HEADER);
  });

  test('markdown / json / yaml keep the run header on stderr (unchanged)', async (t) => {
    for (const format of ['markdown', 'json', 'yaml']) {
      const { dir, cleanup } = await createRepoWithSilentCatchChange();
      t.after(cleanup);

      const result = await runCliInProcess(['run', '.', '--dry-run', '--output', format], {
        cwd: dir,
      });

      assert.strictEqual(result.code, 0, `${format}: ${result.stderr}`);
      assert.doesNotMatch(result.stdout, RUN_HEADER, `${format}: header leaked to stdout`);
      assert.match(result.stderr, RUN_HEADER, `${format}: header missing from stderr`);
    }
  });

  test('html --debug keeps debug info off stdout', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run', '--output', 'html', '--debug'], {
      cwd: dir,
    });

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /^<!DOCTYPE html>/);
    assert.doesNotMatch(result.stdout, /--- diff preview ---/);
    assert.match(result.stderr, /Debug info \(not included in output\)/);
    assert.match(result.stderr, /--- diff preview ---/);
  });
});

// -----------------------------------------------------------------------------
// river runs diff - Loop Dashboard html
// -----------------------------------------------------------------------------

/**
 * 保存済み run レコードの id を、ストアのファイル名から取得する。
 * `runs list` の整形出力を正規表現で解くより壊れにくい。
 *
 * @param {string} dir リポジトリルート
 * @returns {string[]} runId の配列（ファイル名昇順 = 生成順）
 */
function listSavedRunIds(dir) {
  return readdirSync(join(dir, '.river', 'runs'))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => name.slice(0, -'.json'.length));
}

describe('river runs diff - loop dashboard html (#1695)', () => {
  test('html stdout starts at the doctype for both the 2-run and 3-run paths', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    // 3 件保存する。3 件以上で振動検知パス（diffRunHistory）へ入るため、
    // 2-run パスと 3-run パスの両方を同じフィクスチャで踏める。
    for (const value of [2, 3, 4]) {
      writeFileRelative(
        dir,
        'src/app.js',
        `export const value = ${value};\nexport function test() {\n  try {\n    run();\n  } catch(e) {\n    return;\n  }\n}\n`
      );
      const save = await runCliInProcess(['run', '.', '--dry-run', '--save'], { cwd: dir });
      assert.strictEqual(save.code, 0, save.stderr);
    }

    const ids = listSavedRunIds(dir);
    assert.strictEqual(ids.length, 3, `expected 3 saved runs, got ${ids.length}`);

    const twoRun = await runCliInProcess(['runs', 'diff', ids[0], ids[1], '--output', 'html'], {
      cwd: dir,
    });
    assert.strictEqual(twoRun.code, 0, twoRun.stderr);
    assert.match(twoRun.stdout, /^<!DOCTYPE html>/);
    assert.match(twoRun.stdout.trimEnd(), /<\/html>$/);

    const threeRun = await runCliInProcess(
      ['runs', 'diff', ids[0], ids[1], ids[2], '--output', 'html'],
      { cwd: dir }
    );
    assert.strictEqual(threeRun.code, 0, threeRun.stderr);
    assert.match(threeRun.stdout, /^<!DOCTYPE html>/);
    assert.match(threeRun.stdout.trimEnd(), /<\/html>$/);
  });
});
