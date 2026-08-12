import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkCommentDisposition,
  collectHumanComments,
  excerpt,
  formatReport,
  isHumanComment,
  parseArgs,
} from '../scripts/check-comment-disposition.mjs';

// scripts/check-comment-disposition.mjs を実 API へ触れずに検証する（refs #1827）。
// fixture は GitHub API の実応答から必要フィールドだけを抜いた形。人間 / bot の切り分けは
// `user.type`（"User" / "Bot"）で行うため、除外リストは fixture 側にも実装側にも持たない。

const human = (overrides = {}) => ({
  id: 1,
  user: { login: 's977043', type: 'User' },
  created_at: '2026-08-12T00:00:00Z',
  html_url: 'https://github.com/s977043/river-review/pull/1/#c1',
  body: '人間の指摘',
  ...overrides,
});

const bot = (overrides = {}) => ({
  id: 2,
  user: { login: 'vercel[bot]', type: 'Bot' },
  created_at: '2026-08-12T00:00:01Z',
  html_url: 'https://github.com/s977043/river-review/pull/1/#c2',
  body: 'bot の定型',
  ...overrides,
});

test('line comment のみに人間コメントがある場合、それを列挙する', () => {
  const comments = collectHumanComments({
    lineComments: [human({ id: 10, path: 'src/cli.mjs', line: 42 }), bot({ id: 11 })],
    issueComments: [bot({ id: 12 })],
  });
  assert.equal(comments.length, 1);
  assert.equal(comments[0].source, 'line');
  assert.equal(comments[0].id, 10);
  assert.equal(comments[0].path, 'src/cli.mjs');
  assert.equal(comments[0].line, 42);
});

test('issue comment のみに人間コメントがある場合でも見落とさない（#1746 の再発防止）', () => {
  // pulls/<N>/comments は line comment しか返さないため、この形が #1746 の見落としにあたる。
  const comments = collectHumanComments({
    lineComments: [bot({ id: 20 })],
    issueComments: [human({ id: 21, body: 'PR 全体へのレビュー結果' })],
  });
  assert.equal(comments.length, 1);
  assert.equal(comments[0].source, 'issue');
  assert.equal(comments[0].id, 21);
});

test('両系統に人間コメントがある場合、両方を時系列で列挙する', () => {
  const comments = collectHumanComments({
    lineComments: [human({ id: 30, created_at: '2026-08-12T02:00:00Z' })],
    issueComments: [human({ id: 31, created_at: '2026-08-12T01:00:00Z' })],
  });
  assert.deepEqual(
    comments.map((c) => [c.id, c.source]),
    [
      [31, 'issue'],
      [30, 'line'],
    ]
  );
});

test('bot のみの場合は 0 件になる（除外リストを持たず user.type で判定する）', () => {
  const comments = collectHumanComments({
    lineComments: [bot({ id: 40 }), bot({ id: 41, user: { login: 'copilot', type: 'Bot' } })],
    issueComments: [bot({ id: 42, user: { login: 'github-actions[bot]', type: 'Bot' } })],
  });
  assert.deepEqual(comments, []);
});

test('user.type が欠落した応答は人間として扱う（fail-safe で見落としを増やさない）', () => {
  assert.equal(isHumanComment({ user: { login: 'x' } }), true);
  assert.equal(isHumanComment({}), true);
  assert.equal(isHumanComment({ user: { login: 'x', type: 'Bot' } }), false);
  assert.equal(isHumanComment({ user: { login: 'x', type: 'User' } }), true);
});

test('excerpt は改行を畳み、長い本文を切り詰める', () => {
  assert.equal(excerpt('a\n\nb  c'), 'a b c');
  assert.equal(excerpt(null), '');
  const long = 'あ'.repeat(200);
  assert.equal(excerpt(long).length, 121);
  assert.ok(excerpt(long).endsWith('…'));
});

test('checkCommentDisposition は 2 系統のエンドポイントを両方取得する', () => {
  const requested = [];
  const fetchStub = (endpoint) => {
    requested.push(endpoint);
    return endpoint.includes('/pulls/') ? [human({ id: 50 })] : [bot({ id: 51 })];
  };
  const { comments, totals } = checkCommentDisposition({
    prNumber: '1832',
    repo: 'owner/repo',
    fetch: fetchStub,
  });
  assert.deepEqual(requested, [
    'repos/owner/repo/pulls/1832/comments?per_page=100',
    'repos/owner/repo/issues/1832/comments?per_page=100',
  ]);
  assert.deepEqual(totals, { lineTotal: 1, issueTotal: 1 });
  assert.equal(comments.length, 1);
});

test('formatReport は 0 件と 1 件以上で別の作業指示を出す', () => {
  const empty = formatReport('1832', [], { lineTotal: 0, issueTotal: 3 });
  assert.match(empty, /人間由来のコメントはありません/);
  assert.match(empty, /issue comments 3 件/);

  const withComments = formatReport(
    '1832',
    collectHumanComments({ issueComments: [human({ id: 60, body: '直してほしい' })] }),
    { lineTotal: 0, issueTotal: 1 }
  );
  assert.match(withComments, /disposition/);
  assert.match(withComments, /@s977043/);
  assert.match(withComments, /直してほしい/);
  assert.match(withComments, /PAT/);
});

test('parseArgs は PR 番号を必須とし、--repo / --json を受け付ける', () => {
  assert.deepEqual(parseArgs(['1832']), { prNumber: '1832', repo: ':owner/:repo', json: false });
  assert.deepEqual(parseArgs(['--repo', 'a/b', '1832', '--json']), {
    prNumber: '1832',
    repo: 'a/b',
    json: true,
  });
  assert.deepEqual(parseArgs(['--repo=a/b', '1832']).repo, 'a/b');
  assert.throws(() => parseArgs([]), /PR 番号が必要です/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});
