// tests/cli-unknown-context-warning.test.mjs
//
// #1759 C3: `--context <未知の語彙>` を黙って受理し、レビューが空になるのに
// 原因が「applyTo が合わない / inputContext が無い」としか説明されない経路を
// warn で可視化する。
//
// 採った形は #1883（`warnWhenFingerprintMatchesNoFinding`,
// src/cli/commands/feedback.mjs:27）/ #1936（tests/cli-missing-target-warning.test.mjs）と
// 同じである。すなわち stderr へ出し、exit code は変えず、正当な打鍵では黙る。
//
// 警告条件を「enum 外」と言い切れる根拠は 2 つある。
//   1. スキルの `inputContext` は `schemas/skill.schema.json` の
//      `$defs.inputContext`（閉じた enum）で縛られており、
//      `runners/core/skill-loader.mjs` がその schema で全スキルを検証する。
//   2. 選択時の突合は `runners/core/review-runner.mjs:86-91`
//      `missingInputContexts()` の `Set.has()` による完全一致である。
// したがって enum 外の値はどのスキルの `inputContext` とも一致しえず、
// 「渡しても効果が無い」ことが確定する。
//
// このファイルを tests/cli-usage-error-exit-codes.test.mjs へ足さない理由:
// あの表は argv ごとの **exit code 契約** を pin するものであり（同ファイル :75-85）、
// stderr の文言は「ここでは固定しない」と明記されている（同 :112）。本変更は exit code を
// 1 つも動かさないため、あの表の CASES 行は 1 行も動かない。ただし「未知語彙でも
// usage error にならない（= exit 0 側に居続ける）」ことは VALID_CASES へ 1 行足して
// pin してある。
//
// ★ ここで最も重要なのは「出る」側ではなく「出ない」側である。案（警告）を採れた
//   根拠は「正当な打鍵でノイズが出ない」ことなので、下の no-warning ケース群が
//   壊れたら、この設計判断そのものが崩れる。語彙リストは実装からではなく
//   `schemas/skill.schema.json`（語彙の SSoT）から読み、判定は CLI の実 stderr で行う。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import { createTempGitRepo } from './helpers/temp-repo.mjs';

const UNKNOWN_CONTEXT_WARNING = 'has no effect for unknown value';

/**
 * 語彙の SSoT。テスト側で実装（src/cli.mjs）を参照すると自己整合になるため、
 * ajv が実際にスキルを検証する schema ファイルから直接読む。
 */
const SKILL_SCHEMA = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schemas/skill.schema.json', import.meta.url)), 'utf8')
);
const KNOWN_CONTEXTS = SKILL_SCHEMA.$defs.inputContext.enum;

describe('#1759 C3: --context warns only for values outside the inputContext vocabulary', () => {
  let repo = null;

  before(async () => {
    repo = await createTempGitRepo({
      initialFiles: { 'a.txt': 'hello\n' },
      prefix: 'river-1759-c3-context-',
    });
  });

  after(async () => {
    await repo.cleanup();
  });

  /** @param {string[]} argv */
  const run = (argv) => runCliInProcess(argv, { cwd: repo.dir, env: { RIVER_OFFLINE: '1' } });

  test('the vocabulary SSoT is a non-empty closed enum', () => {
    assert.ok(Array.isArray(KNOWN_CONTEXTS) && KNOWN_CONTEXTS.length > 0);
    assert.ok(KNOWN_CONTEXTS.includes('diff'));
  });

  test('warns on an unknown value, without changing the exit code', async () => {
    const result = await run(['run', '.', '--dry-run', '--context', 'BOGUS_CONTEXT']);
    assert.equal(result.code, 0, 'exit code must stay 0 (advisory only)');
    assert.match(result.stderr, new RegExp(UNKNOWN_CONTEXT_WARNING));
    // 直せる形になっていること: 打鍵したトークンがそのまま出る。
    assert.match(result.stderr, /BOGUS_CONTEXT/);
    // 何が正しい語彙なのかがその場で分かること。
    assert.match(result.stderr, /diff/);
  });

  test('reports every unknown value of a mixed list on ONE line', async () => {
    const result = await run(['run', '.', '--dry-run', '--context', 'junit,coverage,diff']);
    assert.equal(result.code, 0);
    const warningLines = result.stderr
      .split('\n')
      .filter((line) => line.includes(UNKNOWN_CONTEXT_WARNING));
    assert.equal(warningLines.length, 1, '未知語彙が複数あっても警告は 1 行に畳む');
    assert.match(warningLines[0], /junit/);
    assert.match(warningLines[0], /coverage/);
  });

  test('stays quiet when --context is not passed at all', async () => {
    const result = await run(['run', '.', '--dry-run']);
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stderr, new RegExp(UNKNOWN_CONTEXT_WARNING));
  });

  test('stays quiet for --context diff', async () => {
    const result = await run(['run', '.', '--dry-run', '--context', 'diff']);
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stderr, new RegExp(UNKNOWN_CONTEXT_WARNING));
  });

  test('stays quiet for --context diff,fullFile', async () => {
    const result = await run(['run', '.', '--dry-run', '--context', 'diff,fullFile']);
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stderr, new RegExp(UNKNOWN_CONTEXT_WARNING));
  });

  test('stays quiet for the whole vocabulary passed as one comma list', async () => {
    const result = await run(['run', '.', '--dry-run', '--context', KNOWN_CONTEXTS.join(',')]);
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stderr, new RegExp(UNKNOWN_CONTEXT_WARNING));
  });

  // 1 値ずつも掃く。まとめて渡す形だけだと「1 つでも既知なら黙る」という
  // 実装でも通ってしまうため。警告は parse 層に置いてあるのでコマンド面に
  // よらず同じに効き、掃引には最も軽い面（`runs list`）を使う。
  for (const ctx of KNOWN_CONTEXTS) {
    test(`stays quiet for --context ${ctx}`, async () => {
      const result = await run(['runs', 'list', '--context', ctx]);
      assert.equal(result.code, 0);
      assert.doesNotMatch(result.stderr, new RegExp(UNKNOWN_CONTEXT_WARNING));
    });
  }

  // その面でも「出る」側が効いていること（= 掃引の対照）。
  test('covers another surface that accepts --context (runs list)', async () => {
    const result = await run(['runs', 'list', '--context', 'BOGUS_CONTEXT']);
    assert.equal(result.code, 0);
    assert.match(result.stderr, new RegExp(UNKNOWN_CONTEXT_WARNING));
  });

  // exit code を 1 バイトも変えないことの直接確認。値欠落は従来どおり usage error。
  test('a missing --context value stays a usage error (exit 1), not a warning', async () => {
    const result = await run(['run', '.', '--dry-run', '--context']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--context option requires a comma-separated list/);
    assert.doesNotMatch(result.stderr, new RegExp(UNKNOWN_CONTEXT_WARNING));
  });
});
