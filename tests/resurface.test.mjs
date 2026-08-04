import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkForResurfacingFindings,
  shouldResurface,
  buildResurfaceComments,
} from '../src/lib/resurface.mjs';

function makeSuppression(overrides = {}) {
  return {
    id: 's1',
    type: 'suppression',
    title: 'Suppress finding',
    content: 'Accepted for now',
    metadata: { createdAt: '2026-01-01T00:00:00Z', author: 't', relatedFiles: ['src/auth.ts'] },
    context: { active: true, scope: 'file', findingId: 'f1' },
    ...overrides,
  };
}

test('checkForResurfacingFindings returns empty for no suppressions', () => {
  const result = checkForResurfacingFindings({
    memoryContext: { suppressions: [] },
    changedFiles: ['a.ts'],
  });
  assert.deepEqual(result, []);
});

test('checkForResurfacingFindings returns empty for null memoryContext', () => {
  const result = checkForResurfacingFindings({ memoryContext: null, changedFiles: ['a.ts'] });
  assert.deepEqual(result, []);
});

test('checkForResurfacingFindings matches file-scoped suppression', () => {
  const ctx = { suppressions: [makeSuppression()] };
  const result = checkForResurfacingFindings({ memoryContext: ctx, changedFiles: ['src/auth.ts'] });
  assert.equal(result.length, 1);
  assert.ok(result[0].reason.includes('Resurfaced'));
});

test('checkForResurfacingFindings skips unrelated files', () => {
  const ctx = { suppressions: [makeSuppression()] };
  const result = checkForResurfacingFindings({
    memoryContext: ctx,
    changedFiles: ['src/billing.ts'],
  });
  assert.equal(result.length, 0);
});

test('shouldResurface matches subsystem scope', () => {
  const s = makeSuppression({
    context: { active: true, scope: 'subsystem' },
    metadata: {
      createdAt: '2026-01-01T00:00:00Z',
      author: 't',
      relatedFiles: ['src/auth/login.ts'],
    },
  });
  assert.equal(shouldResurface(s, ['src/auth/oauth.ts']), true);
  assert.equal(shouldResurface(s, ['src/billing/charge.ts']), false);
});

test('shouldResurface returns false for inactive suppression', () => {
  const s = makeSuppression({ context: { active: false, scope: 'file' } });
  assert.equal(shouldResurface(s, ['src/auth.ts']), false);
});

test('shouldResurface returns false for expired suppression', () => {
  const s = makeSuppression({
    context: { active: true, scope: 'file', expiresAt: '2025-01-01T00:00:00Z' },
  });
  assert.equal(shouldResurface(s, ['src/auth.ts']), false);
});

// #1746 W2 の読み取り側 fail-safe（suppression.test.mjs と同じ理由）。
// parse 不能な expiresAt は文字列比較では永久に「未失効」だった。
test('shouldResurface treats an unparseable expiresAt as expired', () => {
  const s = makeSuppression({
    context: { active: true, scope: 'file', expiresAt: 'notadate' },
  });
  assert.equal(shouldResurface(s, ['src/auth.ts']), false);
});

test('shouldResurface keeps a valid future expiresAt active', () => {
  const s = makeSuppression({
    context: { active: true, scope: 'file', expiresAt: '2099-01-01T00:00:00Z' },
  });
  assert.equal(shouldResurface(s, ['src/auth.ts']), true);
});

test('shouldResurface returns true for global scope', () => {
  const s = makeSuppression({ context: { active: true, scope: 'global' } });
  assert.equal(shouldResurface(s, ['any/file.ts']), true);
});

test('buildResurfaceComments creates valid comments', () => {
  const candidates = [{ suppression: makeSuppression(), reason: '[Resurfaced] test' }];
  const comments = buildResurfaceComments(candidates);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].resurfaced, true);
  assert.equal(comments[0].file, 'src/auth.ts');
  assert.ok(comments[0].message.includes('Severity: nit'));
  assert.ok(comments[0].message.includes('Confidence: low'));
});
