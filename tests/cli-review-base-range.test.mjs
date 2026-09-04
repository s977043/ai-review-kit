// tests/cli-review-base-range.test.mjs
//
// #2046: `river review plan --base <ref>` は値を parse するだけで誰も読まず、
// commit 済みの差分があっても `no-changes` を返していた。同じ `--base` を
// `river review route` へ渡すと反映されるため、route が案内する
// 「次のコマンド」に従うと結果が食い違う silent failure だった。
//
// ここで固定するのは次の 3 点。
//   1. plan が `--base <ref>` の範囲を実際に見ること（git の答えと一致する）
//   2. 同じ `--base` に対する route と plan の変更ファイル集合が一致すること
//   3. `--base` を渡したときは、その範囲が空でも on-disk の diff artifact へ
//      フォールバックしないこと（fail-safe。指定した ref が勝つ）
//
// 判定は CLI 面（runCliInProcess）で行う。両経路の配線そのものを検査する必要が
// あり、`runReviewPlan` を直接呼ぶと配線層が無検査のまま緑になるため。

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before, describe } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import { createTempGitRepo, runGit, writeFileRelative } from './helpers/temp-repo.mjs';

/** `git diff --name-only <ref>`（working tree 込み）の答え = 突合の一次ソース。 */
async function gitChangedFiles(dir, ref) {
  const { stdout } = await runGit(['diff', '--name-only', ref], dir);
  return stdout.split('\n').filter(Boolean).sort();
}

async function revParse(dir, ref) {
  const { stdout } = await runGit(['rev-parse', ref], dir);
  return stdout.trim();
}

/**
 * `river review plan` を CLI 面で実行し、artifact を返す。
 * plan の artifact は console.log ではなく process.stdout.write で出るため
 * （src/cli/commands/review.mjs:190）、runCliInProcess では捕捉できない。
 * `--output-file` に書かせて読む。出力先を repo の外へ置くのは、artifact ファイル
 * 自体が次の実行の差分に混ざらないようにするため。
 */
const outDir = mkdtempSync(join(tmpdir(), 'river-plan-out-'));
let planCounter = 0;

after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

async function runPlan(dir, extraArgs) {
  const outFile = join(outDir, `plan-${planCounter++}.json`);
  const res = await runCliInProcess(
    ['review', 'plan', '.', ...extraArgs, '--plan-only', '--debug', '--output-file', outFile],
    { cwd: dir }
  );
  assert.equal(res.code, 0, res.stderr);
  return JSON.parse(readFileSync(outFile, 'utf8'));
}

describe('river review --base <ref> (#2046)', () => {
  let dir;
  let cleanup;
  /** 初期コミット（schemas/ を含む変更より前）。 */
  let base0;
  /** schemas/ の追加を取り込んだあとのコミット。 */
  let base1;

  before(async () => {
    ({ dir, cleanup } = await createTempGitRepo({
      initialFiles: { 'README.md': '# base\n' },
    }));
    base0 = await revParse(dir, 'HEAD');

    // C1: schema ファイルを含むコミット。base0 からの範囲にだけ現れる。
    writeFileRelative(dir, 'schemas/thing.schema.json', '{ "type": "object" }\n');
    writeFileRelative(dir, 'src/a.js', 'export const a = 1;\n');
    await runGit(['add', '.'], dir);
    await runGit(['commit', '-m', 'add schema and a'], dir);
    base1 = await revParse(dir, 'HEAD');

    // working tree の変更。どちらの base 範囲にも現れる。
    writeFileRelative(dir, 'src/a.js', 'export const a = 2;\n');
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('plan --base <ref> reviews that ref range (was: silently no-changes)', async () => {
    const expected = await gitChangedFiles(dir, base0);
    assert.ok(expected.includes('schemas/thing.schema.json'), '前提: base0 の範囲に schema がある');

    const artifact = await runPlan(dir, ['--base', base0]);
    assert.equal(artifact.status, 'ok', '--base の範囲に差分があるのに no-changes を返している');
    assert.deepEqual([...(artifact.debug?.changedFiles ?? [])].sort(), expected);
  });

  test('plan honors the ref it was given (a narrower base yields a narrower set)', async () => {
    const expected = await gitChangedFiles(dir, base1);
    assert.ok(
      !expected.includes('schemas/thing.schema.json'),
      '前提: base1 の範囲に schema は含まれない'
    );

    const artifact = await runPlan(dir, ['--base', base1]);
    assert.deepEqual([...(artifact.debug?.changedFiles ?? [])].sort(), expected);
  });

  test('route and plan see the same file set for the same --base', async () => {
    // route の JSON は変更ファイル一覧を出さないので、集合の一致は
    // 「同じ集合から導かれる観測」で突き合わせる: schema ファイルが範囲に
    // 入っているかどうかは route 側では matchedTriggers に現れ、plan 側では
    // debug.changedFiles に現れる。2 経路が違う範囲を見ていれば食い違う。
    for (const base of [base0, base1]) {
      const expected = await gitChangedFiles(dir, base);
      const schemaInRange = expected.some((f) => f.startsWith('schemas/'));

      const routeRes = await runCliInProcess(
        ['review', 'route', '.', '--base', base, '--format', 'json'],
        { cwd: dir }
      );
      assert.equal(routeRes.code, 0, routeRes.stderr);
      const route = JSON.parse(routeRes.stdout);
      assert.equal(
        route.matchedTriggers.includes('fileType:schema'),
        schemaInRange,
        `route が base ${base} の範囲を見ていない`
      );

      const planArtifact = await runPlan(dir, ['--base', base]);
      assert.deepEqual(
        [...(planArtifact.debug?.changedFiles ?? [])].sort(),
        expected,
        `plan が base ${base} の範囲を見ていない`
      );
    }
  });
});

describe('river review plan --base precedence over the diff artifact (#2046)', () => {
  let dir;
  let cleanup;

  before(async () => {
    ({ dir, cleanup } = await createTempGitRepo({
      initialFiles: { 'src/a.js': 'export const a = 1;\n' },
    }));
    // cwd default の diff artifact（artifact-resolver の CWD_DEFAULTS.diff）。
    writeFileSync(
      join(dir, 'diff.patch'),
      [
        'diff --git a/src/stale.js b/src/stale.js',
        'index 0000000..1111111 100644',
        '--- a/src/stale.js',
        '+++ b/src/stale.js',
        '@@ -1 +1 @@',
        '-const stale = 1;',
        '+const stale = 2;',
        '',
      ].join('\n')
    );
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('without --base the diff artifact still drives the plan (backward compatible)', async () => {
    const artifact = await runPlan(dir, []);
    assert.equal(artifact.status, 'ok');
    assert.deepEqual(artifact.debug?.changedFiles, ['src/stale.js']);
  });

  test('an empty --base range reports no-changes instead of falling back to it', async () => {
    const artifact = await runPlan(dir, ['--base', 'HEAD']);
    assert.equal(
      artifact.status,
      'no-changes',
      '空の --base 範囲が on-disk の diff.patch へフォールバックしている'
    );
  });
});
