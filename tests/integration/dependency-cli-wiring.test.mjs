// tests/integration/dependency-cli-wiring.test.mjs
//
// `--dependency` の CLI → library 配線を pin する (#1975)。
//
// 背景: `--dependency` を転送している行は 4 箇所あるが、いずれも
// 「ライブラリ層 (local-runner / review-runner / review-plan) は覆われて
// いるのに、CLI からの転送だけが覆われていない」形だった。#1971 / #1972 と
// 同型で、転送行を殺しても全テストが通ってしまう。
//
// したがって本ファイルのケースはすべて **CLI エントリポイント経由**
// (runCliInProcess) で書く。`planLocalReview` / `doctorLocalReview` /
// `runReviewPlan` を直接呼ぶ形にすると、まさに守りたい配線を素通りする。
//
// ## 転送 4 箇所の no-op 判定（実出力の比較で判定。exit code では判定できない）
//
//   src/cli/commands/run.mjs:235     planLocalReview へ    → 覆えていない  → 本ファイルで pin
//   src/cli/commands/doctor.mjs:26   doctorLocalReview へ  → 覆えていない  → 本ファイルで pin
//   src/cli/commands/review.mjs:126  runReviewPlan へ      → 覆えていない  → 本ファイルで pin
//   src/cli/commands/run.mjs:321     runLocalReview へ     → **no-op**     → pin 対象外
//
// run.mjs:321 が no-op である理由: `runLocalReview` は `context` が渡された
// ときは自前の `availableDependencies` 引数を一切読まない
// (src/lib/local-runner.mjs:499-512 — 引数は `providedContext ?? await
// planLocalReview({...})` のフォールバック側でしか使われない)。run.mjs は
// 常に `context` を渡すため、この行は到達しない。実測でも
// `availableDependencies: ['bogus_dep_xyz']` に差し替えて `river run` の
// stdout がバイト単位で同一だった。ここに pin を置いても検出力は 0 になる。
//
// ## `--context` と語彙の形が違う
//
// `--context` は閉じた enum なので #1958 で「enum 外は効果なし」と警告できた。
// `--dependency` は `schemas/skill.schema.json` の `$defs.dependency` が
// `enum` と `{"pattern": "^custom:.+"}` の anyOf で、**開いた枝**を持つ。
// `custom:foo` には意味があるので同じ警告条件は使えない。本ファイルは警告では
// なく pin を足すものであり、開いた枝が CLI で受理され逐語で転送されること
// 自体を固定する（閉じてしまう変更への回帰ガード）。
//
// ## fixture の前提
//
// `coverage-gap` / `test-existence` は `dependencies: [test_runner,
// coverage_report]` を宣言しており、downstream + `--context diff,tests` の
// 差分で選択される。この 2 件が本ファイルの観測点である。宣言が変わった
// 場合はここが落ちるので、そのときは観測点を選び直すこと。

import assert from 'node:assert/strict';
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

import { runCliInProcess } from '../helpers/cli.mjs';
import { createTempDir, cleanupTempDir } from '../helpers/temp-dir.mjs';
import { createTempGitRepo } from '../helpers/temp-repo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '..', 'fixtures', 'plangate-review-artifacts');

// `RIVER_AVAILABLE_DEPENDENCIES` / `RIVER_DEPENDENCY_STUBS` は
// resolveAvailableDependencies の別入力なので、CLI 由来かどうかを測るために
// 必ず落とす（src/lib/utils.mjs resolveAvailableDependencies）。
const CLEAN_ENV = {
  RIVER_AVAILABLE_DEPENDENCIES: undefined,
  RIVER_DEPENDENCY_STUBS: undefined,
};

// dependency ベースの skip が実際に効く観測点。
const DEP_GATED_SKILLS = ['coverage-gap', 'test-existence'];

/** 変更を持つ一時 git リポジトリ（js の変更なので tests/diff コンテキストで選択が起きる）。 */
async function setupRepo(t) {
  const { dir, cleanup } = await createTempGitRepo({
    prefix: 'rr-dep-wiring-',
    initialFiles: {
      'a.js': 'export const a = 1;\n',
      'src/b.js': 'export const b = 1;\n',
    },
    changedFiles: {
      'a.js': 'export const a = 2;\n',
      'src/b.js': 'export const b = 2;\n',
    },
  });
  t.after(cleanup);
  return dir;
}

/** PlanGate fixture（plan/todo/diff.patch）を撒いた一時ディレクトリ。 */
function setupPlanFixture(t) {
  const dir = createTempDir({ prefix: 'rr-dep-plan-' });
  t.after(() => cleanupTempDir(dir));
  for (const f of ['plan.md', 'todo.md', 'diff.patch']) {
    copyFileSync(join(FIXTURE, f), join(dir, f));
  }
  return dir;
}

/** `Selected skills (N): a, b` 行から id 配列を取り出す。 */
function parseSelectedSkills(stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith('Selected skills ('));
  assert.ok(line, `no "Selected skills" line in output:\n${stdout}`);
  const body = line.slice(line.indexOf(':') + 1).trim();
  if (body === 'none matched this diff') return [];
  return body.split(',').map((s) => s.trim());
}

/** `Dependencies: ...` ヘッダ行の右辺。 */
function parseDependencyHeader(stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith('Dependencies:'));
  assert.ok(line, `no "Dependencies:" line in output:\n${stdout}`);
  return line.slice('Dependencies:'.length).trim();
}

/** `- <id>: <reasons>` のスキップ行から、指定 id の理由文字列を返す。 */
function skipReasonFor(stdout, skillId) {
  const line = stdout.split('\n').find((l) => l.startsWith(`- ${skillId}: `));
  return line ? line.slice(`- ${skillId}: `.length) : null;
}

describe('river run — --dependency wiring (src/cli/commands/run.mjs:235, #1975)', () => {
  test('--dependency changes the selected skill set, not just the skip reasons', async (t) => {
    const dir = await setupRepo(t);
    const argv = ['run', '.', '--dry-run', '--phase', 'downstream', '--context', 'diff,tests'];

    const without = await runCliInProcess([...argv, '--debug'], { cwd: dir, env: CLEAN_ENV });
    assert.equal(without.code, 0, without.stderr);
    const withDep = await runCliInProcess(
      [...argv, '--dependency', 'code_search,test_runner', '--debug'],
      { cwd: dir, env: CLEAN_ENV }
    );
    assert.equal(withDep.code, 0, withDep.stderr);

    const selWithout = parseSelectedSkills(without.stdout);
    const selWith = parseSelectedSkills(withDep.stdout);

    // 「別の入力なら別の結果になるはず」を仮定せず、まず別であることを固定する
    // (#1970 の --base フォールバック縮退と同じ罠を防ぐ)。
    assert.notDeepEqual(
      selWith,
      selWithout,
      '--dependency must change the selected skills; both runs degenerated to the same set'
    );

    // 未指定は「すべて利用可能」相当（dependency による skip が無効）。
    for (const id of DEP_GATED_SKILLS) {
      assert.ok(
        selWithout.includes(id),
        `${id} must be selected when --dependency is omitted; got ${JSON.stringify(selWithout)}`
      );
      assert.ok(
        !selWith.includes(id),
        `${id} must drop out when coverage_report is not advertised; got ${JSON.stringify(selWith)}`
      );
      assert.equal(skipReasonFor(withDep.stdout, id), 'missing dependencies: coverage_report');
    }
  });

  test('the run header echoes the forwarded --dependency list (and its absent form)', async (t) => {
    const dir = await setupRepo(t);
    const argv = ['run', '.', '--dry-run', '--phase', 'downstream', '--context', 'diff,tests'];

    const withDep = await runCliInProcess([...argv, '--dependency', 'code_search,test_runner'], {
      cwd: dir,
      env: CLEAN_ENV,
    });
    assert.equal(withDep.code, 0, withDep.stderr);
    assert.equal(parseDependencyHeader(withDep.stdout), 'code_search, test_runner');

    const without = await runCliInProcess(argv, { cwd: dir, env: CLEAN_ENV });
    assert.equal(without.code, 0, without.stderr);
    assert.equal(parseDependencyHeader(without.stdout), 'not specified (skip disabled)');
  });

  test('the open `custom:` branch is accepted and forwarded verbatim (never enum-filtered)', async (t) => {
    const dir = await setupRepo(t);
    const argv = ['run', '.', '--dry-run', '--phase', 'downstream', '--context', 'diff,tests'];

    // `custom:*` はスキーマの `^custom:.+` 枝。CLI は閉じた enum で弾いてはならない。
    const wildcard = await runCliInProcess([...argv, '--dependency', 'custom:*', '--debug'], {
      cwd: dir,
      env: CLEAN_ENV,
    });
    assert.equal(wildcard.code, 0, wildcard.stderr);
    assert.equal(parseDependencyHeader(wildcard.stdout), 'custom:*');

    // 逐語で転送されていることの behavioral な裏取り: `custom:*` は
    // custom 名前空間だけを満たすので、閉じた enum 側の依存は満たされない。
    // 「wildcard を全依存の許可に広げる」変更はここで落ちる。
    for (const id of DEP_GATED_SKILLS) {
      assert.equal(
        skipReasonFor(wildcard.stdout, id),
        'missing dependencies: test_runner, coverage_report'
      );
    }

    const named = await runCliInProcess([...argv, '--dependency', 'custom:foo'], {
      cwd: dir,
      env: CLEAN_ENV,
    });
    assert.equal(named.code, 0, named.stderr);
    assert.equal(parseDependencyHeader(named.stdout), 'custom:foo');
  });
});

describe('river doctor — --dependency wiring (src/cli/commands/doctor.mjs:26, #1975)', () => {
  test('--dependency reaches doctorLocalReview and changes both the header and the plan', async (t) => {
    const dir = await setupRepo(t);
    const argv = ['doctor', '.', '--phase', 'downstream', '--context', 'diff,tests'];

    const without = await runCliInProcess(argv, { cwd: dir, env: CLEAN_ENV });
    assert.equal(without.code, 0, without.stderr);
    const withDep = await runCliInProcess([...argv, '--dependency', 'code_search,test_runner'], {
      cwd: dir,
      env: CLEAN_ENV,
    });
    assert.equal(withDep.code, 0, withDep.stderr);

    assert.equal(parseDependencyHeader(without.stdout), 'not specified (skip disabled)');
    assert.equal(parseDependencyHeader(withDep.stdout), 'code_search, test_runner');

    const selWithout = parseSelectedSkills(without.stdout);
    const selWith = parseSelectedSkills(withDep.stdout);
    assert.notDeepEqual(
      selWith,
      selWithout,
      'doctor --dependency must change the planned skills; both runs degenerated to the same set'
    );
    for (const id of DEP_GATED_SKILLS) {
      assert.ok(selWithout.includes(id), `${id} must be planned when --dependency is omitted`);
      assert.ok(
        !selWith.includes(id),
        `${id} must drop out when coverage_report is not advertised`
      );
      assert.equal(skipReasonFor(withDep.stdout, id), 'missing dependencies: coverage_report');
    }
  });
});

describe('river review plan — --dependency wiring (src/cli/commands/review.mjs:126, #1975)', () => {
  test('--dependency reaches runReviewPlan and changes the artifact selectedSkills', async (t) => {
    const dir = setupPlanFixture(t);
    const argv = [
      'review',
      'plan',
      '--plan-only',
      '--phase',
      'downstream',
      '--context',
      'diff,tests',
    ];

    const readPlan = async (extraArgs, outName) => {
      const out = join(dir, outName);
      const result = await runCliInProcess([...argv, ...extraArgs, '--output-file', out], {
        cwd: dir,
        env: CLEAN_ENV,
      });
      assert.equal(result.code, 0, result.stderr);
      return JSON.parse(readFileSync(out, 'utf8'));
    };

    const without = await readPlan([], 'plan-without.json');
    const withDep = await readPlan(['--dependency', 'code_search,test_runner'], 'plan-with.json');

    const selWithout = without.plan.selectedSkills.map((s) => s.id);
    const selWith = withDep.plan.selectedSkills.map((s) => s.id);
    assert.notDeepEqual(
      selWith,
      selWithout,
      'review plan --dependency must change selectedSkills; both plans degenerated to the same set'
    );

    for (const id of DEP_GATED_SKILLS) {
      assert.ok(
        selWithout.includes(id),
        `${id} must be selected when --dependency is omitted; got ${JSON.stringify(selWithout)}`
      );
      assert.ok(
        !selWith.includes(id),
        `${id} must drop out when coverage_report is not advertised; got ${JSON.stringify(selWith)}`
      );
      const skipped = withDep.plan.skippedSkills.find((s) => s.id === id);
      assert.ok(skipped, `${id} must appear in skippedSkills`);
      assert.deepEqual(skipped.reasons, ['missing dependencies: coverage_report']);
    }

    // 未指定時に dependency 由来の skip が 1 件も無いこと（= null が
    // 「skip 無効」の sentinel であること）を固定する。
    const depSkipsWithout = without.plan.skippedSkills.filter((s) =>
      (s.reasons ?? []).some((r) => r.startsWith('missing dependencies:'))
    );
    assert.deepEqual(depSkipsWithout, [], 'omitting --dependency must disable dependency skipping');
  });
});
