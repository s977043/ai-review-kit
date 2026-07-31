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
//
// #1705 / #1706: 同じ「stdout 純度」原則の残存経路を同じ判定で塞いだ回帰テストを
// 追加する。
//
//   - river skills: バナーと SkillDispatcher の進捗行を text 以外で stderr へ回し、
//     `--output json` の stdout が JSON.parse できることを固定する。併せて
//     `--output` の宣言（text|markdown|json|yaml|html）と実挙動を一致させ、
//     描画器を持たない yaml / html が exit 1 で明示 reject されることを固定する。
//   - river run --baseline: regression summary を text 以外で stderr へ回す。
//     text は現状維持、markdown / json / yaml は意図した挙動変更として固定する。

import assert from 'node:assert';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import {
  createRepoWithSilentCatchChange,
  createTempGitRepo,
  writeFileRelative,
} from './helpers/temp-repo.mjs';

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

// -----------------------------------------------------------------------------
// river skills - banner / progress line stream routing (#1705)
// -----------------------------------------------------------------------------

const SKILLS_BANNER = /River Review \(Skills\) - Target:/;
// SkillDispatcher が出す進捗行。バナーだけを stderr に回しても、これらが
// stdout に残れば --output json の stdout は依然 valid な JSON にならない。
const SKILLS_PROGRESS = /Loading skills from local directory|Loaded \d+ skills|Analyzing /;

/**
 * `river skills`（サブコマンド無し）が 1 ファイル × 1 スキルを必ず処理する
 * 最小リポジトリを作る。`skills/` は初期コミットに含めるため、レビュー対象の
 * 差分は `src/app.js` の 1 ファイルだけになる。
 *
 * @returns {Promise<{ dir: string, cleanup: () => Promise<void> }>}
 */
function createRepoWithLocalSkill() {
  return createTempGitRepo({
    prefix: 'river-skills-stream-',
    initialFiles: {
      'src/app.js': 'export const value = 1;\n',
      'skills/demo.md': [
        '---',
        'id: demo-skill',
        'name: demo-skill',
        'description: demo skill for stdout purity tests',
        'files:',
        '  - "**/*.js"',
        'phase: midstream',
        '---',
        '',
        'Review the diff.',
        '',
      ].join('\n'),
    },
    changedFiles: { 'src/app.js': 'export const value = 2;\n' },
  });
}

describe('river skills - banner / progress line stream routing (#1705)', () => {
  test('json stdout parses as JSON and carries no banner or progress lines', async (t) => {
    const { dir, cleanup } = await createRepoWithLocalSkill();
    t.after(cleanup);

    const result = await runCliInProcess(['skills', '.', '--dry-run', '--output', 'json'], {
      cwd: dir,
    });

    assert.strictEqual(result.code, 0, result.stderr);
    // 受入条件（#1705）: stdout をそのまま JSON.parse できること。
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed), 'skills --output json must emit a JSON array');
    assert.strictEqual(parsed.length, 1, JSON.stringify(parsed));
    assert.strictEqual(parsed[0].file, 'src/app.js');
    assert.doesNotMatch(result.stdout, SKILLS_BANNER);
    assert.doesNotMatch(result.stdout, SKILLS_PROGRESS);
    assert.match(result.stderr, SKILLS_BANNER);
    assert.match(result.stderr, SKILLS_PROGRESS);
  });

  test('markdown stdout starts at the report heading with no progress lines', async (t) => {
    const { dir, cleanup } = await createRepoWithLocalSkill();
    t.after(cleanup);

    const result = await runCliInProcess(['skills', '.', '--dry-run', '--output', 'markdown'], {
      cwd: dir,
    });

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /^## Review Results/);
    assert.doesNotMatch(result.stdout, SKILLS_BANNER);
    assert.doesNotMatch(result.stdout, SKILLS_PROGRESS);
    assert.match(result.stderr, SKILLS_BANNER);
  });

  test('text keeps the banner and progress lines on stdout (default behavior unchanged)', async (t) => {
    const { dir, cleanup } = await createRepoWithLocalSkill();
    t.after(cleanup);

    const result = await runCliInProcess(['skills', '.', '--dry-run', '--output', 'text'], {
      cwd: dir,
    });

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, SKILLS_BANNER);
    assert.match(result.stdout, SKILLS_PROGRESS);
    assert.doesNotMatch(result.stderr, SKILLS_BANNER);
  });

  test('no --output flag renders the text report, not raw JSON', async (t) => {
    const { dir, cleanup } = await createRepoWithLocalSkill();
    t.after(cleanup);

    const result = await runCliInProcess(['skills', '.', '--dry-run'], { cwd: dir });

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Review Results \(1\)/);
    assert.match(result.stdout, /src\/app\.js \(Skill: demo-skill\)/);
    // 宣言（--output 既定は text）と実挙動を一致させた結果、既定は JSON ではない。
    assert.doesNotMatch(result.stdout, /^\s*\[\s*\{/m);
  });

  test('yaml / html are rejected instead of silently returning JSON', async (t) => {
    const { dir, cleanup } = await createRepoWithLocalSkill();
    t.after(cleanup);

    for (const format of ['yaml', 'html']) {
      const result = await runCliInProcess(['skills', '.', '--dry-run', '--output', format], {
        cwd: dir,
      });

      assert.strictEqual(result.code, 1, `${format}: expected exit 1, stderr=${result.stderr}`);
      assert.match(
        result.stderr,
        /Unsupported --output for skills/,
        `${format}: no reject message`
      );
      assert.strictEqual(result.stdout, '', `${format}: stdout must stay empty`);
    }
  });
});

// -----------------------------------------------------------------------------
// river run --baseline - regression summary stream routing (#1706)
// -----------------------------------------------------------------------------

const REGRESSION_SUMMARY = /## Regression Review Summary/;

/**
 * `--baseline` 比較用の baseline JSON を同梱したリポジトリ。
 * baseline.json は初期コミットに含めるので merge-base 比較の差分には入らない
 * （レビュー対象は `src/app.js` の変更のみ）。
 *
 * @returns {Promise<{ dir: string, cleanup: () => Promise<void> }>}
 */
function createRepoWithBaseline() {
  return createTempGitRepo({
    prefix: 'river-baseline-stream-',
    initialFiles: {
      'src/app.js': 'export const value = 1;\n',
      'baseline.json': '[]\n',
    },
    changedFiles: {
      'src/app.js': `export const value = 2;
export function test() {
  try {
    run();
  } catch(e) {
    return;
  }
}
`,
    },
  });
}

describe('river run --baseline - regression summary stream routing (#1706)', () => {
  test('html stdout starts at the doctype with --baseline', async (t) => {
    const { dir, cleanup } = await createRepoWithBaseline();
    t.after(cleanup);

    const result = await runCliInProcess(
      ['run', '.', '--dry-run', '--baseline', 'baseline.json', '--output', 'html'],
      { cwd: dir }
    );

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /^<!DOCTYPE html>\n<html lang="ja">/);
    assert.match(result.stdout.trimEnd(), /<\/html>$/);
    assert.doesNotMatch(result.stdout, REGRESSION_SUMMARY);
    assert.match(result.stderr, REGRESSION_SUMMARY);
  });

  test('text keeps the regression summary on stdout (default behavior unchanged)', async (t) => {
    const { dir, cleanup } = await createRepoWithBaseline();
    t.after(cleanup);

    const result = await runCliInProcess(
      ['run', '.', '--dry-run', '--baseline', 'baseline.json', '--output', 'text'],
      { cwd: dir }
    );

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, REGRESSION_SUMMARY);
    assert.doesNotMatch(result.stderr, REGRESSION_SUMMARY);
  });

  test('markdown / json / yaml move the regression summary to stderr (intended change)', async (t) => {
    for (const format of ['markdown', 'json', 'yaml']) {
      const { dir, cleanup } = await createRepoWithBaseline();
      t.after(cleanup);

      const result = await runCliInProcess(
        ['run', '.', '--dry-run', '--baseline', 'baseline.json', '--output', format],
        { cwd: dir }
      );

      assert.strictEqual(result.code, 0, `${format}: ${result.stderr}`);
      assert.doesNotMatch(result.stdout, REGRESSION_SUMMARY, `${format}: summary leaked to stdout`);
      assert.match(result.stderr, REGRESSION_SUMMARY, `${format}: summary missing from stderr`);
    }
  });

  test('json stdout parses as JSON with --baseline', async (t) => {
    const { dir, cleanup } = await createRepoWithBaseline();
    t.after(cleanup);

    const result = await runCliInProcess(
      ['run', '.', '--dry-run', '--baseline', 'baseline.json', '--output', 'json'],
      { cwd: dir }
    );

    assert.strictEqual(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed.issues), 'run --output json must emit an issues array');
  });
});
