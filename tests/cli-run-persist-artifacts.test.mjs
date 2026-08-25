// tests/cli-run-persist-artifacts.test.mjs
//
// `src/cli/commands/run.mjs` の `persistRunArtifacts`（`--save` / CI 自動保存 /
// job summary digest）の pin（#1966）。
//
// ---------------------------------------------------------------------------
// pin スコープの決め方
// ---------------------------------------------------------------------------
// `persistRunArtifacts` は #1965 で `runRunCommand` から抽出した永続化段であり、
// 抽出前から「テストで守られていない 55 行」だった。#1966 の敵対的レビューで
// 5 つの変異が全テストを素通りすると報告され、着手時に 5 件すべてを
// 「テストが覆っていない」のか「変異が no-op」なのかを実際の副作用
// （`.river/runs/` の位置・`GITHUB_STEP_SUMMARY` の中身・stderr 全文）で
// 判定した。5 件とも副作用が変わる、すなわち pin の不在だった。
//
// | 変異 | 覆うテスト |
// | --- | --- |
// | `resolveStoreDir(targetPath)` -> `resolveStoreDir(result.repoRoot)`（保存側） | subdirectory cwd の保存先と `runs list` の一致 |
// | 同上（digest 側） | digest が subdirectory の store を読む |
// | digest ガードから `process.env.GITHUB_STEP_SUMMARY &&` を削除 | `GITHUB_STEP_SUMMARY` 未設定の CI で warning が出ない |
// | job summary の区切り `'\n' +` -> `'' +` | 先行内容と digest が改行で分離される |
// | run record の `phase: parsed.phase` -> 固定文字列 | `--phase` が record へ伝播する（2 値で測る） |
// | run record の `decision: runDecision` -> 固定文字列 | record の `decision` と `gate.inputs.decision` の一致 |
//
// ---------------------------------------------------------------------------
// 既存テストではなく新規ファイルにした理由
// ---------------------------------------------------------------------------
// `tests/cli.test.mjs` の `river run - GitHub Actions supervision wiring
// (#1372 C1/M1)` は「CI で auto-save と digest が起きること」を覆っており、
// 本ファイルは「どの store へ書くか・区切り・record のフィールド配線」という
// 別の不変条件を扱う。`tests/cli-*.test.mjs` はこの粒度で 1 関心 1 ファイルに
// 分かれている（`cli-usage-error-exit-codes` / `cli-output-stream-routing` 等）
// ため、その型に合わせた。
//
// ---------------------------------------------------------------------------
// 自己整合を避けるための作り
// ---------------------------------------------------------------------------
// 期待値は `persistRunArtifacts` の実装からではなく、外から観測できる副作用
// （保存されたファイルのパス・`runs list` の出力・job summary の中身・stderr）
// から取る。`phase` は 1 つの固定値ではなく 2 つの入力で測るので、固定文字列へ
// 変異させるとどちらか一方が必ず落ちる。`decision` は独立に永続化される
// `gate.inputs.decision` と突き合わせるので、固定文字列は一致を壊す。

import assert from 'node:assert';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import { createTempGitRepo } from './helpers/temp-repo.mjs';

// GITHUB_ACTIONS / GITHUB_STEP_SUMMARY はこのテスト自身が CI 上で走るため、
// 継承させず毎回明示する（`undefined` は runCliInProcess が delete する）。
const NO_CI = { GITHUB_ACTIONS: undefined, GITHUB_STEP_SUMMARY: undefined };

/**
 * repo root と、その下に subdirectory を持つ一時 git repo を作る。
 * `river run` を subdirectory の cwd から実行すると targetPath が
 * subdirectory、`result.repoRoot` が repo root になり、両者が食い違う。
 */
async function createRepoWithSubdir() {
  const repo = await createTempGitRepo({
    prefix: 'river-persist-',
    initialFiles: {
      'src/app.js': 'export const value = 1;\n',
      'sub/lib.js': 'export const x = 1;\n',
    },
    changedFiles: {
      'src/app.js': 'export const value = 2;\n',
      'sub/lib.js': 'export const x = 2;\n',
    },
  });
  // macOS の一時ディレクトリは /var -> /private/var の symlink 配下にある。
  // CLI が報告するパスは process.cwd() 由来で解決済みなので、比較対象も
  // 解決しておかないと同じ場所を別物として扱ってしまう。
  return { ...repo, dir: realpathSync(repo.dir) };
}

function savedPathFromStderr(stderr) {
  const match = /Run saved: \S+ → (\S+)/.exec(stderr);
  assert.ok(match, `no "Run saved:" line in stderr: ${stderr}`);
  return match[1];
}

describe('river run - persistRunArtifacts store resolution (#1966)', () => {
  test('--save from a subdirectory writes the store the same cwd’s runs list reads', async (t) => {
    const { dir, cleanup } = await createRepoWithSubdir();
    t.after(cleanup);
    const sub = join(dir, 'sub');

    const save = await runCliInProcess(['run', '.', '--dry-run', '--save'], {
      cwd: sub,
      env: NO_CI,
    });
    assert.strictEqual(save.code, 0, save.stderr);

    // 保存先は cwd（targetPath）配下であって、git の repo root ではない。
    const savedPath = savedPathFromStderr(save.stderr);
    assert.ok(
      savedPath.startsWith(join(sub, '.river', 'runs') + '/'),
      `saved outside the target store: ${savedPath}`
    );
    assert.ok(existsSync(savedPath), `saved file missing: ${savedPath}`);
    assert.ok(
      !existsSync(join(dir, '.river')),
      'the repo root must not receive a store when the target is a subdirectory'
    );

    // コード上のコメントが宣言している不変条件そのもの:
    // --save と runs list が同じ storeDir を解決する。
    const runId = /Run saved: (\S+)/.exec(save.stderr)[1];
    const list = await runCliInProcess(['runs', 'list'], { cwd: sub, env: NO_CI });
    assert.strictEqual(list.code, 0, list.stderr);
    assert.ok(list.stdout.includes(runId), `runs list did not show ${runId}:\n${list.stdout}`);
  });

  test('the job summary digest reads the target store, not the repo root store', async (t) => {
    const { dir, cleanup } = await createRepoWithSubdir();
    t.after(cleanup);
    const sub = join(dir, 'sub');

    // repo root の store にだけ 2 件仕込む。この保存は targetPath === repoRoot
    // なので、store 解決を repoRoot へ変えても行き先が変わらない。2 件にするのは、
    // digest 側だけを repoRoot へ変えた場合でも件数が 1 にならないようにするため
    // （1 件だと、この run の保存先が subdirectory のまま残るので数が一致してしまう）。
    for (let i = 0; i < 2; i += 1) {
      const seed = await runCliInProcess(['run', '.', '--dry-run', '--save'], {
        cwd: dir,
        env: NO_CI,
      });
      assert.strictEqual(seed.code, 0, seed.stderr);
    }
    assert.ok(existsSync(join(dir, '.river', 'runs')), 'seed runs did not create the root store');

    const summaryFile = join(dir, 'step-summary.md');
    writeFileSync(summaryFile, '# prior content');
    const result = await runCliInProcess(['run', '.', '--dry-run'], {
      cwd: sub,
      env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile },
    });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stderr, /Run saved:/);

    // subdirectory の store には今回の 1 件しかない。repo root の store を
    // 読んでいたら seed と合わせて 2 件になる。
    const summary = readFileSync(summaryFile, 'utf8');
    assert.match(summary, /runs digest/);
    assert.match(summary, /Runs: 1 /, `digest counted the wrong store:\n${summary}`);
  });
});

describe('river run - job summary digest guard and separator (#1966)', () => {
  test('GITHUB_ACTIONS without GITHUB_STEP_SUMMARY appends nothing and warns nothing', async (t) => {
    const { dir, cleanup } = await createRepoWithSubdir();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run'], {
      cwd: dir,
      env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: undefined },
    });
    assert.strictEqual(result.code, 0, result.stderr);
    // auto-save は起きる。digest だけが黙って skip される。
    assert.match(result.stderr, /Run saved:/);
    assert.ok(
      !/job summary digest failed/.test(result.stderr),
      `digest ran without a destination:\n${result.stderr}`
    );
  });

  test('the digest is separated from the prior job summary content by a newline', async (t) => {
    const { dir, cleanup } = await createRepoWithSubdir();
    t.after(cleanup);
    const summaryFile = join(dir, 'step-summary.md');
    // 改行で終わらない先行内容。区切りが無いと digest の見出しが同じ行に続き、
    // Markdown の見出しとして描画されなくなる。
    writeFileSync(summaryFile, '# prior content');

    const result = await runCliInProcess(['run', '.', '--dry-run'], {
      cwd: dir,
      env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile },
    });
    assert.strictEqual(result.code, 0, result.stderr);

    const summary = readFileSync(summaryFile, 'utf8');
    assert.ok(
      summary.startsWith('# prior content\n'),
      `digest was appended without a separator: ${JSON.stringify(summary.slice(0, 40))}`
    );
  });
});

describe('river run - run record field wiring (#1966)', () => {
  /**
   * `--phase` を指定して 1 回保存し、書かれた record を読む。
   */
  async function saveWithPhase(t, phase) {
    const { dir, cleanup } = await createRepoWithSubdir();
    t.after(cleanup);
    const result = await runCliInProcess(['run', '.', '--dry-run', '--save', '--phase', phase], {
      cwd: dir,
      env: NO_CI,
    });
    assert.strictEqual(result.code, 0, result.stderr);
    return JSON.parse(readFileSync(savedPathFromStderr(result.stderr), 'utf8'));
  }

  test('--phase reaches the persisted record (measured with two values)', async (t) => {
    // 1 値だけだと固定文字列への変異がその値と一致したときに素通りする。
    const upstream = await saveWithPhase(t, 'upstream');
    assert.strictEqual(upstream.phase, 'upstream');

    const midstream = await saveWithPhase(t, 'midstream');
    assert.strictEqual(midstream.phase, 'midstream');
  });

  test('the persisted decision agrees with the gate inputs persisted beside it', async (t) => {
    // `decision` と `gate` は同じ deriveRunGate() の 1 回の呼び出しから来るので、
    // 両者は必ず一致する。record の `decision` だけを固定文字列へ変えると、
    // 独立に永続化された `gate.inputs.decision` との一致が壊れる。
    for (const phase of ['upstream', 'midstream']) {
      const record = await saveWithPhase(t, phase);
      assert.ok(typeof record.decision === 'string' && record.decision.length > 0);
      assert.strictEqual(
        record.decision,
        record.gate.inputs.decision,
        `record.decision disagrees with the persisted gate inputs (phase=${phase})`
      );
    }
  });
});
