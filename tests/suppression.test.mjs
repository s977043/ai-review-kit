import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hashFinding,
  inferSubsystem,
  createSuppression,
  revokeSuppression,
  findActiveSuppressions,
  findUnparseableSuppressionExpiries,
  isSuppressionExpired,
} from '../src/lib/suppression.mjs';
import { loadMemory } from '../src/lib/riverbed-memory.mjs';
import { parseArgs } from '../src/cli.mjs';
import { createTempMemory } from './helpers/memory.mjs';
import { compileSuppressionContextValidator } from './helpers/schema-validator.mjs';

const validateSuppressionContext = compileSuppressionContextValidator();

const tmpIndex = () => createTempMemory({ layout: 'nested', prefix: 'river-supp-' });

test('hashFinding produces stable hash for same input', () => {
  const h1 = hashFinding({ file: 'a.ts', message: 'test', ruleId: 'r1' });
  const h2 = hashFinding({ file: 'a.ts', message: 'test', ruleId: 'r1' });
  assert.equal(h1, h2);
  assert.equal(h1.length, 16);
});

test('hashFinding produces different hash for different input', () => {
  const h1 = hashFinding({ file: 'a.ts', message: 'test' });
  const h2 = hashFinding({ file: 'b.ts', message: 'test' });
  assert.notEqual(h1, h2);
});

test('inferSubsystem extracts correct subsystem', () => {
  assert.equal(inferSubsystem('src/auth/handler.ts'), 'auth');
  assert.equal(inferSubsystem('src/lib/utils.mjs'), 'lib');
  assert.equal(inferSubsystem('runners/core/loader.mjs'), 'runners');
  assert.equal(inferSubsystem('file.ts'), '');
});

test('createSuppression creates valid entry', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const entry = createSuppression({
      indexPath,
      findingId: 'f1',
      findingHash: 'abc123',
      filePaths: ['src/auth.ts'],
      rationale: 'Accepted for now',
      scope: 'file',
      author: 'tester',
    });
    assert.equal(entry.type, 'suppression');
    assert.ok(entry.id.startsWith('suppression-abc123-'));
    assert.equal(entry.content, 'Accepted for now');
    assert.ok(entry.metadata.tags.includes('active'));
    assert.ok(entry.context.active);
    const index = loadMemory(indexPath);
    assert.equal(index.entries.length, 1);
  } finally {
    cleanup();
  }
});

test('createSuppression rejects missing rationale', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    assert.throws(() => createSuppression({ indexPath, filePaths: ['a.ts'] }), /rationale/);
  } finally {
    cleanup();
  }
});

test('revokeSuppression appends resurface entry', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    createSuppression({
      indexPath,
      findingId: 'f1',
      findingHash: 'h1',
      filePaths: ['a.ts'],
      rationale: 'ok',
    });
    const entry = revokeSuppression(indexPath, 'suppression-h1-123', {
      reason: 'no longer valid',
    });
    assert.equal(entry.type, 'resurface');
    assert.equal(entry.context.action, 'revoke');
    const index = loadMemory(indexPath);
    assert.equal(index.entries.length, 2);
  } finally {
    cleanup();
  }
});

test('findActiveSuppressions matches by file path', () => {
  const index = {
    entries: [
      {
        id: 's1',
        type: 'suppression',
        content: 'ok',
        metadata: { createdAt: '2026-01-01T00:00:00Z', author: 't', relatedFiles: ['src/auth.ts'] },
        context: { active: true, scope: 'file' },
      },
      {
        id: 's2',
        type: 'suppression',
        content: 'ok',
        metadata: {
          createdAt: '2026-01-01T00:00:00Z',
          author: 't',
          relatedFiles: ['src/billing.ts'],
        },
        context: { active: true, scope: 'file' },
      },
    ],
  };
  const result = findActiveSuppressions(index, ['src/auth.ts']);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 's1');
});

test('findActiveSuppressions excludes revoked suppressions', () => {
  const index = {
    entries: [
      {
        id: 's1',
        type: 'suppression',
        content: 'ok',
        metadata: { createdAt: '2026-01-01T00:00:00Z', author: 't', relatedFiles: ['src/auth.ts'] },
        context: { active: true, scope: 'file' },
      },
      {
        id: 'r1',
        type: 'resurface',
        content: 'revoked',
        metadata: { createdAt: '2026-01-02T00:00:00Z', author: 't' },
        context: { suppressionId: 's1', action: 'revoke' },
      },
    ],
  };
  const result = findActiveSuppressions(index, ['src/auth.ts']);
  assert.equal(result.length, 0);
});

test('findActiveSuppressions excludes expired suppressions', () => {
  const index = {
    entries: [
      {
        id: 's1',
        type: 'suppression',
        content: 'ok',
        metadata: { createdAt: '2024-01-01T00:00:00Z', author: 't', relatedFiles: ['src/auth.ts'] },
        context: { active: true, scope: 'file', expiresAt: '2025-01-01T00:00:00Z' },
      },
    ],
  };
  const result = findActiveSuppressions(index, ['src/auth.ts']);
  assert.equal(result.length, 0);
});

// #1746 W2 の読み取り側 fail-safe。`suppression add --expires notadate` は
// v1.72.0 まで exit 0 のまま context.expiresAt: "notadate" を永続化していた。
// 旧実装の失効判定は文字列比較（`expiresAt < new Date().toISOString()`）で、
// "notadate" は "2026-..." より辞書順で後ろに来るため常に「未失効」になり、
// 永久に失効しない suppression になっていた。既に書き込まれてしまった
// index.json を救うため、parse 不能な値は失効扱いに倒す。
test('findActiveSuppressions treats an unparseable expiresAt as expired (index.json fixture)', () => {
  const { indexPath, cleanup } = createTempMemory({
    layout: 'nested',
    prefix: 'river-supp-expiry-',
    entries: [
      {
        id: 's-bogus-expiry',
        type: 'suppression',
        content: 'ok',
        metadata: {
          createdAt: '2026-01-01T00:00:00Z',
          author: 't',
          relatedFiles: ['src/auth.ts'],
        },
        context: { active: true, scope: 'file', expiresAt: 'notadate' },
      },
    ],
  });
  try {
    const index = loadMemory(indexPath);
    assert.equal(index.entries[0].context.expiresAt, 'notadate', 'fixture の前提が壊れている');
    const warnings = [];
    assert.deepEqual(
      findActiveSuppressions(index, ['src/auth.ts'], { warn: (m) => warnings.push(m) }),
      []
    );
    // #1780: 失効させるだけでなく、その事実が運用者へ届くこと。
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /s-bogus-expiry/);
    assert.match(warnings[0], /"notadate"/);
  } finally {
    cleanup();
  }
});

// #1780 回帰テーブル。v1.72.0–v1.72.1 の CLI は `Number.isNaN(Date.parse(value))`
// だけを見て受理し、値を verbatim 保存していた（`git show v1.72.1:src/cli.mjs`）。
// #1777 で妥当性定義が RFC 3339 の SSoT（src/lib/expires-at.mjs）へ寄った結果、
// これらは unparseable = 失効扱いになる。方向は fail-safe なので変えないが、
// 「無警告で抑制が止まる」ことだけは直す対象なので、警告の有無まで固定する。
const LEGACY_UNPARSEABLE_EXPIRES_AT = [
  '2027-01-01T00:00:00', // offset 無し（toISOString().slice(0,19) の形）
  '2027-01-01T00:00Z', // 秒が無い
  '2027/01/01', // スラッシュ区切り
  '2027-01-01T09:00:00+0900', // basic format offset（`date -Iseconds` の形）
];

test('findActiveSuppressions warns for each legacy expiresAt form it expires (#1780)', () => {
  const now = new Date('2026-08-12T00:00:00Z');
  for (const expiresAt of LEGACY_UNPARSEABLE_EXPIRES_AT) {
    // まず失効側の挙動（#1777 以降の前提）を固定する。
    assert.equal(
      isSuppressionExpired({ context: { expiresAt } }, now),
      true,
      `${expiresAt} は unparseable として失効扱いであること`
    );

    const index = {
      entries: [
        {
          id: `s-legacy-${expiresAt}`,
          type: 'suppression',
          content: 'ok',
          metadata: {
            createdAt: '2026-01-01T00:00:00Z',
            author: 't',
            relatedFiles: ['src/auth.ts'],
          },
          context: { active: true, scope: 'file', expiresAt },
        },
      ],
    };
    const warnings = [];
    const result = findActiveSuppressions(index, ['src/auth.ts'], {
      warn: (m) => warnings.push(m),
    });
    assert.deepEqual(result, [], `${expiresAt} の suppression は適用されないこと`);
    assert.equal(warnings.length, 1, `${expiresAt} で警告が 1 件出ること`);
    // 部分文字列の包含で見る。値には `/` や `+` が含まれるため、正規表現へ
    // 組み立てるとエスケープが必要になり、そのエスケープ自体が不完全な
    // sanitization として検出される（CodeQL js/incomplete-sanitization）。
    assert.ok(
      warnings[0].includes(`s-legacy-${expiresAt}`),
      `警告に entry id が含まれること: ${warnings[0]}`
    );
    assert.ok(
      warnings[0].includes(`"${expiresAt}"`),
      `警告に該当の値が含まれること: ${warnings[0]}`
    );
    assert.match(warnings[0], /unparseable context\.expiresAt/);
  }
});

test('findActiveSuppressions stays quiet for a parseable deadline and for out-of-scope entries (#1780)', () => {
  const entry = (id, expiresAt, file) => ({
    id,
    type: 'suppression',
    content: 'ok',
    metadata: { createdAt: '2026-01-01T00:00:00Z', author: 't', relatedFiles: [file] },
    context: { active: true, scope: 'file', expiresAt },
  });
  const index = {
    entries: [
      // 正当な期限で普通に失効したもの: 警告の対象ではない。
      entry('s-real-expiry', '2025-01-01T00:00:00Z', 'src/auth.ts'),
      // 期限は読めないが、この変更セットを覆っていないもの。
      entry('s-out-of-scope', '2027/01/01', 'src/billing.ts'),
    ],
  };
  const warnings = [];
  const result = findActiveSuppressions(index, ['src/auth.ts'], { warn: (m) => warnings.push(m) });
  assert.deepEqual(result, []);
  assert.deepEqual(warnings, []);
});

test('findUnparseableSuppressionExpiries reports only active entries (#1780)', () => {
  const entries = [
    {
      id: 's-active-bad',
      type: 'suppression',
      context: { active: true, expiresAt: '2027-01-01T00:00:00' },
    },
    {
      id: 's-inactive-bad',
      type: 'suppression',
      context: { active: false, expiresAt: '2027-01-01T00:00:00' },
    },
    { id: 's-good', type: 'suppression', context: { active: true, expiresAt: '2027-01-01' } },
    { id: 's-none', type: 'suppression', context: { active: true } },
    // revoke は append-only で、元 entry の context.active は true のまま残る。
    // active だけを見ると「修復せよ」と報告してしまう（#1780 W2）。
    {
      id: 's-revoked-bad',
      type: 'suppression',
      context: { active: true, expiresAt: '2027-01-01T00:00:00' },
    },
    { id: 'r-1', type: 'resurface', context: { suppressionId: 's-revoked-bad', action: 'revoke' } },
  ];
  assert.deepEqual(findUnparseableSuppressionExpiries(entries), [
    { id: 's-active-bad', expiresAt: '2027-01-01T00:00:00' },
  ]);
  assert.deepEqual(findUnparseableSuppressionExpiries(undefined), []);
});

test('isSuppressionExpired fails safe on malformed values and keeps valid ones', () => {
  const at = (expiresAt) => ({ context: { expiresAt } });
  const now = new Date('2026-08-04T00:00:00Z');
  // parse 不能 -> 失効扱い（fail-safe）
  assert.equal(isSuppressionExpired(at('notadate'), now), true);
  assert.equal(isSuppressionExpired(at('2026-13-45'), now), true);
  // 正当な値は従来どおり
  assert.equal(isSuppressionExpired(at('2025-01-01T00:00:00Z'), now), true);
  assert.equal(isSuppressionExpired(at('2099-01-01T00:00:00Z'), now), false);
  assert.equal(isSuppressionExpired(at('2027-01-01'), now), false);
  // expiresAt 自体が無ければ失効しない
  assert.equal(isSuppressionExpired(at(undefined), now), false);
  assert.equal(isSuppressionExpired({}, now), false);
});

test('findActiveSuppressions matches subsystem scope', () => {
  const index = {
    entries: [
      {
        id: 's1',
        type: 'suppression',
        content: 'ok',
        metadata: {
          createdAt: '2026-01-01T00:00:00Z',
          author: 't',
          relatedFiles: ['src/auth/login.ts'],
        },
        context: { active: true, scope: 'subsystem' },
      },
    ],
  };
  const result = findActiveSuppressions(index, ['src/auth/oauth.ts']);
  assert.equal(result.length, 1);
});

// --- #687 PR-A: feedbackType / fingerprint / severity ---

test('createSuppression preserves backward compat when no new fields are passed', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const entry = createSuppression({
      indexPath,
      findingId: 'f1',
      findingHash: 'abc1234567890def',
      filePaths: ['src/auth.ts'],
      rationale: 'Accepted for now',
    });
    assert.equal(entry.context.scope, 'file');
    assert.equal(entry.context.active, true);
    assert.equal(entry.context.findingHash, 'abc1234567890def');
    // None of the new fields should leak into the entry when not passed.
    assert.equal('feedbackType' in entry.context, false);
    assert.equal('fingerprint' in entry.context, false);
    assert.equal('severity' in entry.context, false);
  } finally {
    cleanup();
  }
});

test('createSuppression stores feedbackType / fingerprint / severity when provided', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const fingerprint = 'a'.repeat(16);
    const entry = createSuppression({
      indexPath,
      findingId: 'f1',
      filePaths: ['src/auth.ts'],
      rationale: 'False positive on dynamic key lookup',
      fingerprint,
      feedbackType: 'false_positive',
      severity: 'minor',
      sourceCommentId: 12345,
      prNumber: 678,
    });
    assert.equal(entry.context.fingerprint, fingerprint);
    assert.equal(entry.context.fingerprintAlgo, 'v1');
    assert.equal(entry.context.feedbackType, 'false_positive');
    assert.equal(entry.context.severity, 'minor');
    assert.equal(entry.context.sourceCommentId, 12345);
    assert.equal(entry.context.sourcePR, 678);
    // Entry id should now seed from the canonical fingerprint, not findingHash.
    assert.ok(entry.id.startsWith('suppression-' + fingerprint + '-'));
  } finally {
    cleanup();
  }
});

test('createSuppression accepts minSeverityToAutoSuppress and duplicateOfFingerprint', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const fp = 'b'.repeat(16);
    const dupOf = 'c'.repeat(16);
    const entry = createSuppression({
      indexPath,
      filePaths: ['src/payment.ts'],
      rationale: 'duplicate of #f0',
      fingerprint: fp,
      feedbackType: 'duplicate',
      severity: 'major',
      minSeverityToAutoSuppress: 'critical',
      duplicateOfFingerprint: dupOf,
    });
    assert.equal(entry.context.minSeverityToAutoSuppress, 'critical');
    assert.equal(entry.context.duplicateOfFingerprint, dupOf);
  } finally {
    cleanup();
  }
});

test('createSuppression context payload validates against suppression-context.schema.json', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const entry = createSuppression({
      indexPath,
      filePaths: ['src/auth.ts'],
      rationale: 'r',
      fingerprint: 'd'.repeat(16),
      feedbackType: 'accepted_risk',
      severity: 'critical',
      sourceCommentId: 1,
      prNumber: 2,
      expiresAt: '2099-01-01T00:00:00Z',
    });
    const ok = validateSuppressionContext(entry.context);
    assert.ok(ok, JSON.stringify(validateSuppressionContext.errors));
  } finally {
    cleanup();
  }
});

// #1753 M2: `--expires` の parse 層検証は schema (`expiresAt` は
// `format: date-time`) より緩く、`2027-01-01` をそのまま書き込んで schema 違反
// データを作っていた。parse 層で正規化するようになったので、CLI から入った値が
// 実際の書き込み経路 (createSuppression) を通ったあとで schema を満たすことを、
// 自己整合ではなく production の経路そのもので確認する。
test('an --expires value parsed by the CLI validates against the schema after createSuppression', () => {
  const cliCases = [
    { input: '2027-01-01', normalized: '2027-01-01T00:00:00.000Z' },
    { input: '2027-01-01T00:00:00Z', normalized: '2027-01-01T00:00:00.000Z' },
    { input: '2027-01-01T00:00:00+09:00', normalized: '2026-12-31T15:00:00.000Z' },
  ];
  for (const cliCase of cliCases) {
    const parsed = parseArgs([
      'suppression',
      'add',
      '--fingerprint',
      'd'.repeat(16),
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--severity',
      'Critical',
      '--expires',
      cliCase.input,
    ]);
    assert.equal(parsed.usageError, false, `${cliCase.input} が誤って拒否された`);
    assert.equal(parsed.suppressionExpiresAt, cliCase.normalized);
    assert.equal(parsed.suppressionSeverity, 'critical', '大小無視の正規化が効いていない');

    const { cleanup, indexPath } = tmpIndex();
    try {
      const entry = createSuppression({
        indexPath,
        filePaths: ['src/auth.ts'],
        rationale: parsed.suppressionRationale,
        fingerprint: parsed.suppressionFingerprint,
        feedbackType: parsed.suppressionFeedbackType,
        severity: parsed.suppressionSeverity,
        expiresAt: parsed.suppressionExpiresAt,
      });
      assert.equal(entry.context.expiresAt, cliCase.normalized);
      const ok = validateSuppressionContext(entry.context);
      assert.ok(ok, `${cliCase.input}: ${JSON.stringify(validateSuppressionContext.errors)}`);
    } finally {
      cleanup();
    }
  }
});

test('the schema rejects the pre-#1753 date-only expiresAt (why normalization is required)', () => {
  // 反証を明示的に固定する: 正規化しなければ schema を通らない。
  assert.equal(
    validateSuppressionContext({ scope: 'file', active: true, expiresAt: '2027-01-01' }),
    false
  );
});

test('suppression-context schema rejects an invalid feedbackType', () => {
  const ok = validateSuppressionContext({
    scope: 'file',
    active: true,
    feedbackType: 'totally-bogus',
  });
  assert.equal(ok, false);
});

test('suppression-context schema rejects a fingerprint that is not 16 lowercase hex', () => {
  const tooShort = validateSuppressionContext({
    scope: 'file',
    active: true,
    fingerprint: 'abc',
  });
  assert.equal(tooShort, false);
  const upper = validateSuppressionContext({
    scope: 'file',
    active: true,
    fingerprint: 'A'.repeat(16),
  });
  assert.equal(upper, false);
});

test('createSuppression drops invalid prNumber / sourceCommentId (NaN, float, non-positive)', () => {
  // Use distinct fingerprints so the two appendEntry calls cannot collide on
  // hashFinding(filePaths[0]) + Date.now() under fast CI runners. The
  // fingerprint feeds the entry id seed (see createSuppression in
  // src/lib/suppression.mjs).
  const { cleanup, indexPath } = tmpIndex();
  try {
    const entry = createSuppression({
      indexPath,
      filePaths: ['src/auth.ts'],
      rationale: 'r',
      fingerprint: 'a'.repeat(16),
      prNumber: NaN,
      sourceCommentId: 1.5,
    });
    assert.equal('sourcePR' in entry.context, false);
    assert.equal('sourceCommentId' in entry.context, false);

    const entry2 = createSuppression({
      indexPath,
      filePaths: ['src/auth.ts'],
      rationale: 'r',
      fingerprint: 'b'.repeat(16),
      prNumber: 0,
      sourceCommentId: -3,
    });
    assert.equal('sourcePR' in entry2.context, false);
    assert.equal('sourceCommentId' in entry2.context, false);
  } finally {
    cleanup();
  }
});

test('suppression-context schema rejects non-positive sourceCommentId', () => {
  const ok = validateSuppressionContext({
    scope: 'file',
    active: true,
    sourceCommentId: 0,
  });
  assert.equal(ok, false);
});

test('suppression-context schema accepts a backward-compatible legacy entry', () => {
  // Pre-#687 entries only had {scope, active, findingId, findingHash}. The
  // schema must not reject them so existing memory indexes stay valid.
  const legacy = {
    scope: 'file',
    active: true,
    findingId: 'f1',
    findingHash: 'legacyhash',
  };
  const ok = validateSuppressionContext(legacy);
  assert.ok(ok, JSON.stringify(validateSuppressionContext.errors));
});
