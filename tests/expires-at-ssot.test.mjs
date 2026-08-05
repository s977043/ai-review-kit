// #1768: `expiresAt` の妥当性定義が schema / CLI / ライブラリの 3 箇所に分かれ、
// 互いに一致していなかった。schema が拒否し CLI も exit 1 で弾く `"0"` `"2026"`
// `"2026-08-04 10:00"` を、ライブラリ (`hasUnparseableExpiresAt`) だけが有効な
// 期限として扱っていた。
//
// このテストは「新モジュールと新モジュール」の自己整合ではなく、CLI の production
// 経路 (`parseArgs`) と ライブラリの production 経路 (`hasUnparseableExpiresAt` /
// `isExpired`) を突き合わせる。片方だけ直しても落ちる形にするのが目的。

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { parseArgs } from '../src/cli.mjs';
import { parseExpiresAt } from '../src/lib/expires-at.mjs';
import {
  appendEntry,
  expireEntries,
  hasUnparseableExpiresAt,
  isExpired,
  loadMemory,
} from '../src/lib/riverbed-memory.mjs';
import { isSuppressionExpired } from '../src/lib/suppression.mjs';
import { applyPromotionDecision, planPromotionRetire } from '../src/lib/promotion.mjs';
import { buildPromotionCandidateEntry } from '../scripts/feedback-rule-candidates.mjs';
import { createTempMemory, makeMemoryEntry as makeEntry } from './helpers/memory.mjs';
import { compileSuppressionContextValidator } from './helpers/schema-validator.mjs';

const validateSuppressionContext = compileSuppressionContextValidator();

// `Date.parse` が「読めてしまう」ために分裂が生じていた値と、RFC 3339 の正常値。
// `2027-02-30` は存在しない日で、`Date` は 2027-03-02 に繰り上げる。
//
// 末尾 2 つ（offset 省略・秒省略）は、v1.72.0–v1.72.1 の `--expires` ゲート
// （`if (Number.isNaN(Date.parse(value)))` のみ、値は verbatim 保存）が通した
// legacy 形のうち最も現実的なもの。`toISOString().slice(0, 19)` の切り出しや
// 多くのツールの既定表記がこの形になるため、`2027` や `March 5, 2027` より
// 実データに現れやすい。
const REJECTED = [
  '0',
  '2026',
  '2026-08-04 10:00',
  'notadate',
  '2027-02-30',
  '2027-01-01T00:00:00', // offset 省略
  '2027-01-01T00:00Z', // 秒省略
];
const ACCEPTED = ['2027-01-01', '2027-01-01T00:00:00Z', '2027-01-01T00:00:00+09:00'];

/** CLI の実経路で `--expires <value>` が受理されるか。 */
function cliAccepts(value) {
  const parsed = parseArgs([
    'suppression',
    'add',
    '--fingerprint',
    'a'.repeat(16),
    '--feedback',
    'false_positive',
    '--rationale',
    'r',
    '--expires',
    value,
  ]);
  return parsed.usageError === false;
}

describe('expiresAt validity is one definition (#1768)', () => {
  test('CLI とライブラリの判定が全値で一致する', () => {
    for (const value of [...REJECTED, ...ACCEPTED]) {
      const libValid = !hasUnparseableExpiresAt({ expiresAt: value });
      assert.equal(
        libValid,
        cliAccepts(value),
        `${JSON.stringify(value)}: CLI=${cliAccepts(value)} library=${libValid}`
      );
    }
  });

  test('CLI が拒否する緩い値はライブラリでも unparseable になる', () => {
    for (const value of REJECTED) {
      assert.equal(cliAccepts(value), false, `${value} は CLI が受理してしまった`);
      assert.equal(hasUnparseableExpiresAt({ expiresAt: value }), true, value);
    }
  });

  test('CLI が受理する RFC 3339 の値はライブラリでも有効なまま', () => {
    for (const value of ACCEPTED) {
      assert.equal(cliAccepts(value), true, `${value} は CLI が拒否してしまった`);
      assert.equal(hasUnparseableExpiresAt({ expiresAt: value }), false, value);
    }
  });

  // schema は変更していない（読むだけ）。CLI が正規化した値が schema を満たすこと
  // を、正規化関数の出力そのもので確認する。
  test('CLI が受理する値の正規化結果は suppression-context schema を満たす', () => {
    for (const value of ACCEPTED) {
      const normalized = parseExpiresAt(value);
      assert.notEqual(normalized, null, value);
      assert.equal(
        validateSuppressionContext({ scope: 'file', active: true, expiresAt: normalized }),
        true,
        `${value} -> ${normalized}: ${JSON.stringify(validateSuppressionContext.errors)}`
      );
    }
  });

  // 分裂の中身: `Date` は緩い値を「誰も書いていない時刻」として読んでいた。
  test('緩い値を Date が読む時刻は利用者の意図と無関係（分裂の原因を固定する）', () => {
    // ISO 形式として読める `2026` / `2027-02-30` は UTC 固定。`0` は非 ISO なので
    // 実装依存のローカル時刻に落ちる（Node 22.22.2 では 2000-01-01 のローカル
    // 深夜）ため、TZ に依存しない形で「読めてしまう」ことだけを固定する。
    assert.equal(new Date('2026').toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(Number.isNaN(Date.parse('0')), false);
    assert.equal(new Date('0').getFullYear(), 2000);
    assert.equal(new Date('2027-02-30').toISOString(), '2027-03-02T00:00:00.000Z');
    // その時刻はもう期限判定に使われない。
    for (const value of ['2026', '0', '2027-02-30']) {
      assert.equal(Number.isNaN(Date.parse(parseExpiresAt(value) ?? 'x')), true, value);
    }
  });
});

// #1756 / #1762 が定めた `onUnparseable` の契約は変えていない。緩い値が
// unparseable 側に移るだけで、各呼び出し元の「方向」は据え置き。
describe('isExpired の onUnparseable 契約は #1762 のまま (#1768)', () => {
  const now = new Date('2026-08-05T00:00:00.000Z');

  test('正常値の判定は onUnparseable に依らず不変', () => {
    const past = { expiresAt: '2026-08-04T00:00:00.000Z' };
    const future = { expiresAt: '2027-01-01T00:00:00.000Z' };
    const tz = { expiresAt: '2026-08-05T00:00:00+09:00' }; // = 2026-08-04T15:00Z, 既に past
    const dateOnly = { expiresAt: '2026-08-04' }; // date-only は UTC 深夜
    for (const onUnparseable of ['expired', 'not-expired']) {
      assert.equal(isExpired(past, now, { onUnparseable }), true);
      assert.equal(isExpired(future, now, { onUnparseable }), false);
      assert.equal(isExpired(tz, now, { onUnparseable }), true);
      assert.equal(isExpired(dateOnly, now, { onUnparseable }), true);
      assert.equal(isExpired({}, now, { onUnparseable }), false);
    }
  });

  test('緩い値は各方向へ振り分けられる（NaN 比較には戻らない）', () => {
    for (const value of REJECTED) {
      assert.equal(isExpired({ expiresAt: value }, now, { onUnparseable: 'expired' }), true, value);
      assert.equal(
        isExpired({ expiresAt: value }, now, { onUnparseable: 'not-expired' }),
        false,
        value
      );
    }
  });

  test('onUnparseable は依然として必須', () => {
    assert.throws(() => isExpired({ expiresAt: '2026' }, now), TypeError);
    assert.throws(
      () => isExpired({ expiresAt: '2026' }, now, { onUnparseable: 'nope' }),
      TypeError
    );
  });
});

// 呼び出し元 3 箇所（read-side 1 / write-side 2）の実挙動。
// 旧 CLI が書いた緩い値を持つ既存 index が、どちらの向きに倒れるかを固定する。
describe('既存データ（旧 CLI が書いた緩い値）の扱い (#1768)', () => {
  const now = new Date('2026-08-05T00:00:00.000Z');

  test('read-side: suppression は失効する（抑制が効かなくなる = fail-safe）', () => {
    for (const value of REJECTED) {
      assert.equal(
        isSuppressionExpired({ context: { expiresAt: value } }, now),
        true,
        `${value} が抑制を効かせ続けている`
      );
    }
    // 正常値の分類は変わらない。
    assert.equal(
      isSuppressionExpired({ context: { expiresAt: '2027-01-01T00:00:00Z' } }, now),
      false
    );
    assert.equal(
      isSuppressionExpired({ context: { expiresAt: '2026-08-04T00:00:00Z' } }, now),
      true
    );
  });

  test('write-side: expireEntries は archive せず警告する', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-1768-' });
    try {
      for (const [i, value] of REJECTED.entries()) {
        appendEntry(indexPath, makeEntry({ id: `legacy-${i}`, expiresAt: value }));
      }
      appendEntry(
        indexPath,
        makeEntry({ id: 'really-expired', expiresAt: '2026-08-04T00:00:00.000Z' })
      );
      const warnings = [];
      const count = expireEntries(indexPath, { now, warn: (msg) => warnings.push(msg) });
      assert.equal(count, 1, '正常に期限切れの 1 件だけが archive される');
      assert.equal(warnings.length, REJECTED.length);
      const mem = loadMemory(indexPath);
      for (const [i] of REJECTED.entries()) {
        assert.equal(mem.entries.find((e) => e.id === `legacy-${i}`).status, undefined);
      }
      assert.equal(mem.entries.find((e) => e.id === 'really-expired').status, 'archived');
    } finally {
      cleanup();
    }
  });

  test('write-side: promotion は archive を見送り unparseableExpiresAt を立てる', () => {
    for (const value of REJECTED) {
      const entry = buildPromotionCandidateEntry({
        skillId: 'skill-a',
        feedbackType: 'false_positive',
        group: [
          { pr: 1, findingFingerprint: null, feedbackType: 'false_positive' },
          { pr: 2, findingFingerprint: null, feedbackType: 'false_positive' },
        ],
        now: new Date('2026-07-20T00:00:00.000Z'),
      });
      applyPromotionDecision(entry, {
        decision: 'approved',
        approver: 'alice',
        now: new Date('2026-07-21T00:00:00.000Z'),
      });
      entry.expiresAt = value; // 旧 CLI / 手編集で入った値を再現する
      const plan = planPromotionRetire(entry, { now });
      assert.equal(plan.willExpire, false, `${value} で archive されている`);
      assert.equal(plan.unparseableExpiresAt, true, value);
      assert.equal(entry.status ?? 'active', 'active');
    }
  });
});
