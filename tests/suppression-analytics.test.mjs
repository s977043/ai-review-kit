import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeSuppressions,
  formatIssueBody,
  THRESHOLDS,
} from '../scripts/suppression-analytics.mjs';
import { findActiveSuppressions } from '../src/lib/suppression.mjs';

const NOW = new Date('2026-06-10T00:00:00Z');

function suppression({
  fingerprint = 'a1b2c3d4e5f60718',
  sourcePR = 1,
  severity = 'minor',
  createdAt = '2026-06-01T00:00:00Z',
  active = true,
  expiresAt = null,
} = {}) {
  return {
    id: `sup-${fingerprint}-${sourcePR}`,
    type: 'suppression',
    createdAt,
    context: { fingerprint, sourcePR, severity, active, ...(expiresAt ? { expiresAt } : {}) },
  };
}

test('flags a fingerprint suppressed across 3+ distinct PRs', () => {
  const entries = [
    suppression({ sourcePR: 10 }),
    suppression({ sourcePR: 11 }),
    suppression({ sourcePR: 12 }),
    suppression({ fingerprint: 'ffffffffffffffff', sourcePR: 10 }),
  ];
  const result = analyzeSuppressions(entries, { now: NOW });
  assert.equal(result.repeatedFingerprints.length, 1);
  assert.equal(result.repeatedFingerprints[0].fingerprint, 'a1b2c3d4e5f60718');
  assert.deepEqual(result.repeatedFingerprints[0].prs, [10, 11, 12]);
});

test('same PR repeated does not count toward the repeat threshold', () => {
  const entries = [
    suppression({ sourcePR: 10 }),
    suppression({ sourcePR: 10 }),
    suppression({ sourcePR: 10 }),
  ];
  const result = analyzeSuppressions(entries, { now: NOW });
  assert.equal(result.repeatedFingerprints.length, 0);
});

test('flags stale major/critical suppressions but not recent or minor ones', () => {
  const entries = [
    suppression({ severity: 'major', createdAt: '2026-05-01T00:00:00Z' }), // 40d old
    suppression({ severity: 'critical', createdAt: '2026-06-09T00:00:00Z', sourcePR: 2 }), // 1d old
    suppression({ severity: 'minor', createdAt: '2026-01-01T00:00:00Z', sourcePR: 3 }), // old but minor
  ];
  const result = analyzeSuppressions(entries, { now: NOW });
  assert.equal(result.staleHighSeverity.length, 1);
  assert.equal(result.staleHighSeverity[0].severity, 'major');
  assert.ok(result.staleHighSeverity[0].ageDays >= THRESHOLDS.staleHighSeverityDays);
});

test('inactive, expired, and non-suppression entries are excluded', () => {
  const entries = [
    suppression({ active: false }),
    suppression({ expiresAt: '2026-06-01T00:00:00Z', sourcePR: 2 }),
    { type: 'adr', context: {} },
    suppression({ sourcePR: 3 }),
  ];
  const result = analyzeSuppressions(entries, { now: NOW });
  assert.equal(result.active, 1);
});

test('an unparseable expiresAt counts as expired, not as active', () => {
  // `new Date('notadate').getTime()` is NaN and `NaN <= now` is false, so the
  // former in-script comparison counted this entry as ACTIVE while the review
  // path treated it as expired (#1764).
  const result = analyzeSuppressions([suppression({ expiresAt: 'notadate' })], { now: NOW });
  assert.equal(result.active, 0);
});

test('well-formed expiresAt values keep their existing classification', () => {
  const cases = [
    { label: 'absent', expiresAt: null, expectedActive: 1 },
    { label: 'already past', expiresAt: '2026-06-01T00:00:00Z', expectedActive: 0 },
    { label: 'exactly now', expiresAt: '2026-06-10T00:00:00Z', expectedActive: 0 },
    { label: 'not yet reached', expiresAt: '2026-07-01T00:00:00Z', expectedActive: 1 },
    // 2026-06-10T08:00+09:00 is 2026-06-09T23:00Z, one hour before NOW.
    { label: 'past with offset', expiresAt: '2026-06-10T08:00:00+09:00', expectedActive: 0 },
    // 2026-06-10T10:00+09:00 is 2026-06-10T01:00Z, one hour after NOW.
    { label: 'future with offset', expiresAt: '2026-06-10T10:00:00+09:00', expectedActive: 1 },
  ];
  for (const { label, expiresAt, expectedActive } of cases) {
    const result = analyzeSuppressions([suppression({ expiresAt })], { now: NOW });
    assert.equal(result.active, expectedActive, `expiresAt ${label}`);
  }
});

test('analytics and findActiveSuppressions agree on the same index', () => {
  // Cross-check against the production review path rather than against another
  // copy of the same rule: a self-consistent assertion would still pass if both
  // sides re-derived expiry the same wrong way. Values are far enough from the
  // real clock that both paths classify them identically, because
  // findActiveSuppressions reads the wall clock and cannot be given a `now`.
  const scoped = (opts) => {
    const entry = suppression(opts);
    entry.context.scope = 'file';
    entry.metadata = { relatedFiles: ['src/a.mjs'] };
    return entry;
  };
  const entries = [
    scoped({ fingerprint: 'aaaaaaaaaaaaaaaa', expiresAt: 'notadate' }),
    scoped({ fingerprint: 'bbbbbbbbbbbbbbbb', sourcePR: 2, expiresAt: '2099-01-01T00:00:00Z' }),
    scoped({ fingerprint: 'cccccccccccccccc', sourcePR: 3, expiresAt: '2000-01-01T00:00:00Z' }),
    scoped({
      fingerprint: 'dddddddddddddddd',
      sourcePR: 4,
      expiresAt: '2099-01-01T09:00:00+09:00',
    }),
    scoped({ fingerprint: 'eeeeeeeeeeeeeeee', sourcePR: 5 }),
  ];

  const analytics = analyzeSuppressions(entries, { now: new Date() });
  const reviewPath = findActiveSuppressions({ entries }, ['src/a.mjs'], { warn: () => {} });

  assert.equal(analytics.active, reviewPath.length);
  assert.deepEqual(reviewPath.map((e) => e.context.fingerprint).sort(), [
    'bbbbbbbbbbbbbbbb',
    'dddddddddddddddd',
    'eeeeeeeeeeeeeeee',
  ]);
});

// #1780: 「失効したこと」ではなく「期限が読めなくて失効したこと」を出す。
// active カウントが減るだけでは、運用者は理由を観測できない。
test('unparseable expiresAt entries are reported separately from the active count (#1780)', () => {
  const legacyForms = [
    '2027-01-01T00:00:00',
    '2027-01-01T00:00Z',
    '2027/01/01',
    '2027-01-01T09:00:00+0900',
  ];
  const entries = legacyForms.map((expiresAt, i) =>
    suppression({ fingerprint: `f${String(i).repeat(15)}`, sourcePR: i + 1, expiresAt })
  );
  // 正当な将来日と、正当に失効済みの値は報告対象に入らない。
  entries.push(
    suppression({ fingerprint: 'aaaaaaaaaaaaaaaa', sourcePR: 90, expiresAt: '2027-01-01' })
  );
  entries.push(
    suppression({
      fingerprint: 'bbbbbbbbbbbbbbbb',
      sourcePR: 91,
      expiresAt: '2026-01-01T00:00:00Z',
    })
  );

  const result = analyzeSuppressions(entries, { now: NOW });
  assert.equal(result.active, 1, '将来日の 1 件だけがアクティブ');
  assert.deepEqual(
    result.unparseableExpiresAt.map((e) => e.expiresAt),
    legacyForms
  );

  const body = formatIssueBody(result);
  assert.match(body, /期限が読めないため失効扱い/);
  for (const form of legacyForms) assert.ok(body.includes(form), `${form} が本文に出ること`);
});

test('unparseableExpiresAt is empty when every deadline parses (#1780)', () => {
  const result = analyzeSuppressions([suppression({ expiresAt: '2027-01-01T00:00:00Z' })], {
    now: NOW,
  });
  assert.deepEqual(result.unparseableExpiresAt, []);
  assert.doesNotMatch(formatIssueBody(result), /期限が読めないため失効扱い/);
});

test('issue body keeps a backtick-bearing expiresAt inside a fenced block (#1780)', () => {
  // 値は旧 CLI が verbatim 保存した任意の文字列。バッククォートを含むと
  // インライン code span が壊れ、issue 本文の残りを巻き込む。
  const result = analyzeSuppressions([suppression({ expiresAt: '2027`01`01' })], { now: NOW });
  const body = formatIssueBody(result);
  assert.equal(result.unparseableExpiresAt.length, 1);
  const lines = body.split('\n');
  const open = lines.indexOf('```text');
  const close = lines.indexOf('```', open + 1);
  assert.ok(open >= 0 && close > open, 'fenced block が出ること');
  const block = lines.slice(open + 1, close);
  assert.ok(
    block.some((l) => l.includes('"2027`01`01"')),
    `値が fence の内側にあること: ${JSON.stringify(block)}`
  );
  // 次のアクション文は fence の外に残り、巻き込まれていない。
  assert.ok(lines.slice(close + 1).some((l) => l.includes('skill-optimizer')));
});

// #1780 W3: 追加した診断を「自分自身の出力」ではなく既存の判定経路と突き合わせる。
// analyzeSuppressions の期待値を analyzeSuppressions で作ると、両者が同じ誤りを
// 共有していても緑になる。実際、revoke 済み entry の扱いのズレ（W2）はこの突合が
// 無いあいだ検出されなかった。
test('unparseableExpiresAt agrees with the warning ids findActiveSuppressions emits, revocations included (#1780)', () => {
  const scoped = (id, expiresAt) => ({
    id,
    type: 'suppression',
    createdAt: '2026-01-01T00:00:00Z',
    metadata: { relatedFiles: ['src/a.mjs'] },
    context: { active: true, scope: 'file', fingerprint: 'a1b2c3d4e5f60718', expiresAt },
  });
  const entries = [
    scoped('s-legacy-noffset', '2027-01-01T00:00:00'),
    scoped('s-legacy-slash', '2027/01/01'),
    // revoke 済み: どちらの経路からも報告されてはならない。
    scoped('s-revoked', '2027-01-01T09:00:00+0900'),
    {
      id: 'r-1',
      type: 'resurface',
      createdAt: '2026-01-02T00:00:00Z',
      context: { suppressionId: 's-revoked', action: 'revoke' },
    },
    // 正当な将来日と、正当に失効済みの値。
    scoped('s-future', '2099-01-01T00:00:00Z'),
    scoped('s-past', '2000-01-01T00:00:00Z'),
  ];

  const warnings = [];
  findActiveSuppressions({ entries }, ['src/a.mjs'], { warn: (m) => warnings.push(m) });
  const warnedIds = entries
    .filter((e) => e.type === 'suppression')
    .map((e) => e.id)
    .filter((id) => warnings.some((w) => w.includes(id)));

  // findActiveSuppressions は壁時計を読むため now を渡せない。値は現実の時刻から
  // 十分離してあるので、両経路の分類は一致する。
  const analytics = analyzeSuppressions(entries, { now: new Date() });

  assert.deepEqual(warnedIds, ['s-legacy-noffset', 's-legacy-slash']);
  assert.deepEqual(
    analytics.unparseableExpiresAt.map((e) => e.id),
    warnedIds
  );
});

test('the default warn sink writes to console.warn (#1780)', () => {
  const entries = [
    {
      id: 's-default-sink',
      type: 'suppression',
      metadata: { relatedFiles: ['src/a.mjs'] },
      context: { active: true, scope: 'file', expiresAt: '2027-01-01T00:00:00' },
    },
  ];
  const original = console.warn;
  const captured = [];
  console.warn = (m) => captured.push(m);
  try {
    // 2 引数呼び出し（既定の sink）。呼び出し元が opts を渡さない現状の経路
    // （regression-eval.mjs:110）と同じ形。
    findActiveSuppressions({ entries }, ['src/a.mjs']);
  } finally {
    console.warn = original;
  }
  assert.equal(captured.length, 1);
  assert.ok(captured[0].includes('s-default-sink'));
});

test('formatIssueBody renders both signal sections with next action', () => {
  const result = analyzeSuppressions(
    [
      suppression({ sourcePR: 10 }),
      suppression({ sourcePR: 11 }),
      suppression({ sourcePR: 12, severity: 'major', createdAt: '2026-05-01T00:00:00Z' }),
    ],
    { now: NOW }
  );
  const body = formatIssueBody(result);
  assert.match(body, /反復 suppress/);
  assert.match(body, /長期滞留/);
  assert.match(body, /skill-optimizer/);
});
