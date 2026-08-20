// tests/cli-missing-target-warning.test.mjs
//
// #1936: 存在しないパス・参照を黙って受理して空の結果を返す経路を warn で可視化する。
//
// 対象は 2 経路である。
//
//   1. `evolve aggregate <存在しないパス>` — `resolveStoreDir()` が
//      `<存在しないパス>/.river/runs` を解決してしまうため、打鍵ミスが
//      「まだ run が 1 件も無い」正常なレポートと 1 バイトも違わない出力になっていた。
//   2. `run --baseline <path>` + 早期 return（`no-changes` / `skipped-by-label` /
//      `--estimate`）— 比較ブロックへ到達しないので、`--baseline` を指定した事実ごと
//      無言で消えていた。
//
// 採った形は #1883（`warnWhenFingerprintMatchesNoFinding`,
// src/cli/commands/feedback.mjs:27）と同じである。すなわち stderr へ出し、exit code は
// 変えず、正当にデータが無いだけのときは黙る。
//
// このファイルを tests/cli-usage-error-exit-codes.test.mjs へ足さない理由:
// あの表は argv ごとの **exit code 契約** を pin するものであり（同ファイル :75-85）、
// stderr の文言は「ここでは固定しない」と明記されている（同 :112）。本 PR は exit code を
// 1 つも動かさないので、あの表の行は 1 行も動かない。動かないこと自体は同ファイルの
// 掃引が担保するが、**警告が出る / 出ない**は掃引の対象外なので、ここで別に pin する。
//
// ★ ここで最も重要なのは「出る」側ではなく「出ない」側である。案 2（警告）を採れた
//   根拠は「正当に空のケースでノイズが出ない」ことなので、下の no-warning ケース群が
//   壊れたら、この設計判断そのものが崩れる。

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import { cleanupTempDir, createTempDir } from './helpers/temp-dir.mjs';
import { createTempGitRepo } from './helpers/temp-repo.mjs';

const MISSING_TARGET_WARNING = 'does not exist, so this aggregate read an empty store';
const BASELINE_UNUSED_WARNING = 'was not used';

function writeRunRecord(dir) {
  mkdirSync(join(dir, '.river', 'runs'), { recursive: true });
  writeFileSync(
    join(dir, '.river', 'runs', 'run-001.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      runId: 'run-001',
      createdAt: '2026-08-01T00:00:00.000Z',
      phase: 'upstream',
      gate: 'advisory',
      decision: 'pass',
      findings: [
        {
          id: 'f1',
          title: 't',
          severity: 'minor',
          category: 'readability',
          filePath: 'a.txt',
          evidence: 'hello',
          skillId: 'x',
        },
      ],
    })
  );
}

describe('#1936: evolve aggregate warns only when the positional path does not exist', () => {
  let dir = null;

  before(() => {
    dir = createTempDir({ prefix: 'river-1936-aggregate-' });
  });

  after(() => {
    cleanupTempDir(dir);
  });

  test('warns on a non-existent path, without changing the exit code', async () => {
    const result = await runCliInProcess(['evolve', 'aggregate', 'no-such-dir'], { cwd: dir });
    assert.equal(result.code, 0, 'exit code must stay 0 (advisory only)');
    assert.match(result.stderr, new RegExp(MISSING_TARGET_WARNING));
    // 直せる形になっていること: 打鍵したトークンがそのまま出る。
    assert.match(result.stderr, /no-such-dir/);
  });

  test('stays quiet on a first-ever run (no .river/ at all)', async () => {
    const result = await runCliInProcess(['evolve', 'aggregate', '.'], { cwd: dir });
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stderr, new RegExp(MISSING_TARGET_WARNING));
  });

  test('stays quiet when no positional is given at all', async () => {
    const result = await runCliInProcess(['evolve', 'aggregate'], { cwd: dir });
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stderr, new RegExp(MISSING_TARGET_WARNING));
  });

  test('stays quiet when .river/runs exists but is empty', async () => {
    mkdirSync(join(dir, '.river', 'runs'), { recursive: true });
    const result = await runCliInProcess(['evolve', 'aggregate', '.'], { cwd: dir });
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stderr, new RegExp(MISSING_TARGET_WARNING));
  });

  test('stays quiet when runs exist, and when a --month scope selects none of them', async () => {
    writeRunRecord(dir);

    const all = await runCliInProcess(['evolve', 'aggregate', '.'], { cwd: dir });
    assert.equal(all.code, 0);
    assert.match(all.stdout, /\| Runs \| 1 \|/);
    assert.doesNotMatch(all.stderr, new RegExp(MISSING_TARGET_WARNING));

    // 月スコープが空になるのは「正当に空」であって打鍵ミスではない。
    const scoped = await runCliInProcess(['evolve', 'aggregate', '--month', '2000-01', '.'], {
      cwd: dir,
    });
    assert.equal(scoped.code, 0);
    assert.match(scoped.stdout, /\| Runs \| 0 \|/);
    assert.doesNotMatch(scoped.stderr, new RegExp(MISSING_TARGET_WARNING));
  });

  test('stays quiet for an existing FILE path (existsSync is not narrowed to directories)', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    const result = await runCliInProcess(['evolve', 'aggregate', './a.txt'], { cwd: dir });
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stderr, new RegExp(MISSING_TARGET_WARNING));
  });
});

describe('#1936: run --baseline reports that an early return skipped the comparison', () => {
  let repo = null;

  before(async () => {
    // 差分ゼロ（全ファイルコミット済み）= `no-changes` の早期 return が成立する状態。
    repo = await createTempGitRepo({
      initialFiles: { 'a.txt': 'hello\n' },
      prefix: 'river-1936-baseline-',
    });
    writeFileSync(join(repo.dir, 'base.json'), '[]');
  });

  after(async () => {
    await repo.cleanup();
  });

  test('warns when the baseline file does not exist', async () => {
    const result = await runCliInProcess(
      ['run', '.', '--dry-run', '--baseline', './no-such.json'],
      { cwd: repo.dir, env: { RIVER_OFFLINE: '1' } }
    );
    assert.equal(result.code, 0, 'exit code must stay 0 (advisory only)');
    assert.match(result.stdout, /No changes to review/);
    assert.match(result.stderr, new RegExp(BASELINE_UNUSED_WARNING));
    assert.match(result.stderr, /no-such\.json/);
  });

  test('warns when the baseline file EXISTS but was never read', async () => {
    // 「比較が走らなかった」ことが症状なので、ファイルの有無で分岐しない。
    const result = await runCliInProcess(['run', '.', '--dry-run', '--baseline', './base.json'], {
      cwd: repo.dir,
      env: { RIVER_OFFLINE: '1' },
    });
    assert.equal(result.code, 0);
    assert.match(result.stderr, new RegExp(BASELINE_UNUSED_WARNING));
    assert.match(result.stderr, /base\.json/);
  });

  test('stays quiet when --baseline was not passed at all', async () => {
    const result = await runCliInProcess(['run', '.', '--dry-run'], {
      cwd: repo.dir,
      env: { RIVER_OFFLINE: '1' },
    });
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stderr, new RegExp(BASELINE_UNUSED_WARNING));
  });

  test('warns under --estimate, which never runs the review', async () => {
    writeFileSync(join(repo.dir, 'a.txt'), 'hello\nworld\n');
    const result = await runCliInProcess(
      ['run', '.', '--estimate', '--baseline', './no-such.json'],
      { cwd: repo.dir, env: { RIVER_OFFLINE: '1' } }
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Cost Estimate:/);
    assert.match(result.stderr, new RegExp(BASELINE_UNUSED_WARNING));
  });
});
