// #1929 派生: `Scope:` 自己申告ラベルの文法が読み手側（verifier）と
// 消し手側（output surfaces の strip）で一致していることを振る舞いで固定する。
//
// 以前は verifier.mjs がラベルの正規表現をハードコードしており、
// finding-factory.mjs の定義とバイト一致で二重管理されていた。語彙が片側だけ
// 増えると、strip はラベルを表示から消すのに verifier は自己申告を認識できず
// `debug.scopeStats.mismatch` にも載らない、という観測不能な失敗になる。
//
// そこで固定するのは「同一実装を両側から呼んでいる」ことではなく、
// **同じ入力集合に対して 2 つの surface の判定が一致する** ことである。
//   - 読み手: resolveFindingScope（src/lib/verifier.mjs）が selfReported を返すか
//   - 消し手: stripSelfReportedScope（src/lib/finding-factory.mjs）が文字列を変えるか
// この 2 つが食い違う入力が 1 つでもあれば落ちる。片側だけに語彙を足す変更は
// まさにその食い違いを作るので、この形でだけ検出できる。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveFindingScope } from '../src/lib/verifier.mjs';
import {
  FINDING_SCOPES,
  stripSelfReportedScope,
  normalizeScope,
} from '../src/lib/finding-factory.mjs';

/**
 * 境界を含む入力集合。`recognized` は「自己申告ラベルとして認識されるべきか」を
 * 実装からではなく仕様（既知語彙のみ・値制約あり）から直に書いた期待値。
 */
const CASES = [
  // --- 認識されるべき ---
  { name: '行頭の Scope:', message: 'Scope: in-diff', recognized: true, value: 'in-diff' },
  {
    name: '前置きがある Scope:',
    message: 'Fix: ガードする Scope: pre-existing Confidence: high',
    recognized: true,
    value: 'pre-existing',
  },
  {
    name: '大小違い',
    message: 'Scope: Pre-Existing',
    recognized: true,
    value: 'pre-existing',
  },
  { name: '区切り違い（_）', message: 'Scope: in_diff', recognized: true, value: 'in-diff' },
  { name: '区切り違い（空白）', message: 'Scope: in diff', recognized: true, value: 'in-diff' },
  { name: '区切り無し', message: 'Scope: indiff', recognized: true, value: 'in-diff' },
  {
    name: 'コロン後に空白が無い',
    message: 'Scope:pre-existing',
    recognized: true,
    value: 'pre-existing',
  },
  {
    name: '改行区切りの直後',
    message: 'Evidence: 落ちる\nScope: pre-existing',
    recognized: true,
    value: 'pre-existing',
  },

  // --- 認識されるべきでない ---
  { name: '語彙外の値', message: 'Scope: unknown', recognized: false },
  { name: '値が無い', message: 'Scope:', recognized: false },
  {
    name: '散文中の OAuth scope',
    message: 'Evidence: トークンの Scope: read:user が広すぎる',
    recognized: false,
  },
  {
    name: '直前が語構成文字（境界なし）',
    message: 'Evidence: theScope: in-diff',
    recognized: false,
  },
  {
    name: '値の直後が語構成文字（\\b 違反）',
    message: 'Scope: in-diffish',
    recognized: false,
  },
  { name: 'ラベルが無い', message: 'Evidence: 落ちる Fix: 直す', recognized: false },
  { name: '空文字', message: '', recognized: false },
];

/** verifier 側がラベルを自己申告として認識したか（機械判定は無効化する）。 */
function readerRecognizes(message) {
  const resolved = resolveFindingScope({ finding: { message }, diffFiles: null });
  return resolved.selfReported !== null;
}

/** strip 側がラベルを取り除いたか。 */
function stripperRemoves(message) {
  return stripSelfReportedScope(message) !== message;
}

describe('#1929: Scope ラベル文法は読み手と消し手で一致する', () => {
  for (const { name, message, recognized, value } of CASES) {
    it(`${name}: 期待どおり認識される / されない`, () => {
      assert.strictEqual(readerRecognizes(message), recognized);
      if (recognized) {
        const resolved = resolveFindingScope({ finding: { message }, diffFiles: null });
        assert.strictEqual(resolved.selfReported, normalizeScope(value));
        assert.strictEqual(resolved.source, 'self-reported');
      }
    });
  }

  it('全入力で 読み手の認識範囲 と 消し手の除去範囲 が一致する', () => {
    const disagreements = CASES.filter(
      ({ message }) => readerRecognizes(message) !== stripperRemoves(message)
    ).map(({ name, message }) => ({
      name,
      message,
      reader: readerRecognizes(message),
      stripper: stripperRemoves(message),
    }));
    assert.deepStrictEqual(
      disagreements,
      [],
      `Scope ラベル文法が surface 間でズレている: ${JSON.stringify(disagreements)}`
    );
  });

  // 語彙が増えたときに片側だけが追従する事故を捕まえるため、探索入力は固定リテラルでは
  // なく宣言された語彙 FINDING_SCOPES から生成する。新しい scope 値は FINDING_SCOPES に
  // 載るので、そこから作った `Scope: <新語彙>` が自動でこのテストの入力になる。
  const generatedProbes = FINDING_SCOPES.flatMap((scope) =>
    ['-', '_', ' ', ''].map((separator) => ({
      scope,
      message: `Evidence: 落ちる Scope: ${scope.replaceAll('-', separator)}`,
      separator,
    }))
  );

  it('宣言語彙の正準表記は必ず両 surface が認識する', () => {
    for (const scope of FINDING_SCOPES) {
      const message = `Evidence: 落ちる Scope: ${scope}`;
      assert.strictEqual(readerRecognizes(message), true, `reader が ${scope} を取りこぼした`);
      assert.strictEqual(stripperRemoves(message), true, `stripper が ${scope} を取りこぼした`);
    }
  });

  it('宣言語彙の表記ゆれでも 読み手 と 消し手 の判定が一致する', () => {
    const disagreements = generatedProbes
      .filter(({ message }) => readerRecognizes(message) !== stripperRemoves(message))
      .map(({ scope, separator, message }) => ({
        scope,
        separator,
        message,
        reader: readerRecognizes(message),
        stripper: stripperRemoves(message),
      }));
    assert.deepStrictEqual(
      disagreements,
      [],
      `語彙の追従が片側だけで止まっている: ${JSON.stringify(disagreements)}`
    );
  });
});
