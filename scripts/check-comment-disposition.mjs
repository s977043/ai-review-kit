#!/usr/bin/env node
// PR のレビューコメントのうち「人間が書いたもの」を全件列挙し、disposition の作業リストを出す（refs #1827）。
//
// 背景:
//   CLAUDE.md「Merge-time checks」は docs/governance.md の「マージ前チェックリスト」を実行せよと定めるが、
//   散文のため実行漏れが起きる。ラベル面は #1770 の必須チェック `Blocked label guard` で機械化済みで、
//   残る散文がレビューコメントの disposition 確認と /preflight にあたる。本 script は前者のうち
//   「列挙の漏れ」を決定論で消す。2026-08-04 の #1746 では pulls/<N>/comments だけを列挙して 0 件だったため
//   「指摘なし」と判定し、issues/<N>/comments 側の指摘 3 件を見落として v1.72.0 で回帰を出荷している。
//
// 何を判定し、何を判定しないか:
//   判定するのは「人間由来のコメントが存在するか」だけであり、それが disposition 済みかどうかは判定しない。
//   disposition の有無は返信・reaction・追従コミットのいずれからも決定論では読めない。返信の有無で判定すると
//   「返信したが対応していない」を見逃し、「返信不要な賛辞コメント」を誤検出する。pulls/<N>/reviews の
//   state（CHANGES_REQUESTED）も、レビュアーと PR オーサーが同一アカウントの体制では formal review 自体が
//   使えないため機能しない（docs/governance.md § 2.1）。したがって本 script は「確認すべきコメントの全件」を
//   出力するところまでを担い、各件の dispose は人間 / AI が governance.md の手順で行う。
//
// bot の切り分け:
//   除外リストは持たない。GitHub API の `user.type` が `Bot` / `User` を返すため、`User` だけを残す。
//   新しい bot が増えても追随不要になる。
//   **限界**: PAT（個人アクセストークン）で動く自動化は `user.type: "User"` を返すため、bot でありながら
//   人間として列挙される。この形の誤検出は本 script では除去できない。列挙結果を読む側が投稿者名で判断する。
//   逆方向（人間を bot と誤って落とす）は起きないため、fail-safe の向きとしては安全側に倒れている。
//
// 使い方:
//   node scripts/check-comment-disposition.mjs <PR number> [--repo <owner/repo>] [--json]
//
// 終了コード:
//   0 … 人間由来のコメントなし（disposition の対象なし）
//   1 … 人間由来のコメントあり（列挙を出力。各件の dispose は利用者が行う）
//   2 … 使い方の誤り、または gh の呼び出し失敗
//
// exit 1 は「マージ禁止」ではなく「確認せよ」を意味する。したがって CI の必須チェックにはしない
// （コメントが 1 件付いた瞬間に恒久的にマージ不能となり、docs/development/improvement-flow.md の
// 「gate は止めるべきでないものを止めないことまで満たして初めて機能する」を満たせないため）。
// 配線先は .claude/commands/merge-check.md の Step 2 とする。

import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { isDirectRun } from './lib/is-direct-run.mjs';

/** 本文プレビューの最大長（1 件が作業リストの 1 行に収まる長さ）。 */
const EXCERPT_LENGTH = 120;

/**
 * 本文を 1 行のプレビューへ潰す。改行を空白へ畳み、長い場合は省略記号を付ける。
 *
 * @param {unknown} body
 * @returns {string}
 */
export function excerpt(body) {
  const flattened = String(body ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flattened.length <= EXCERPT_LENGTH) return flattened;
  return `${flattened.slice(0, EXCERPT_LENGTH)}…`;
}

/**
 * コメントが人間由来かを判定する。`user.type === 'User'` のみを人間とみなす。
 *
 * user.type が欠落している応答（想定外のスキーマ）は人間として扱う。見落としを増やす方向へ
 * 倒さないための fail-safe であり、余分に列挙されるだけで害がない。
 *
 * @param {{ user?: { type?: string } }} comment
 * @returns {boolean}
 */
export function isHumanComment(comment) {
  const type = comment?.user?.type;
  if (type === undefined || type === null) return true;
  return String(type) === 'User';
}

/**
 * 2 系統（line comments / issue comments）の生応答から、人間由来のコメントだけを正規化して返す。
 *
 * @param {{ lineComments?: unknown[], issueComments?: unknown[] }} input
 * @returns {{ source: 'line'|'issue', id: number|null, author: string, createdAt: string,
 *   path: string|null, line: number|null, url: string, excerpt: string, inReplyToId: number|null }[]}
 */
export function collectHumanComments({ lineComments = [], issueComments = [] } = {}) {
  const normalize = (comment, source) => ({
    source,
    id: typeof comment?.id === 'number' ? comment.id : null,
    author: String(comment?.user?.login ?? '(unknown)'),
    createdAt: String(comment?.created_at ?? ''),
    path: source === 'line' ? (comment?.path ?? null) : null,
    line: source === 'line' ? (comment?.line ?? null) : null,
    url: String(comment?.html_url ?? ''),
    excerpt: excerpt(comment?.body),
    inReplyToId: source === 'line' ? (comment?.in_reply_to_id ?? null) : null,
  });

  return [
    ...(Array.isArray(lineComments) ? lineComments : []),
    ...(Array.isArray(issueComments) ? issueComments : []),
  ]
    .map((comment, index) => ({
      comment,
      source: index < (Array.isArray(lineComments) ? lineComments.length : 0) ? 'line' : 'issue',
    }))
    .filter(({ comment }) => isHumanComment(comment))
    .map(({ comment, source }) => normalize(comment, source))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 作業リスト形式のテキストへ整形する。
 *
 * @param {number|string} prNumber
 * @param {ReturnType<typeof collectHumanComments>} comments
 * @param {{ lineTotal: number, issueTotal: number }} totals
 * @returns {string}
 */
export function formatReport(prNumber, comments, totals) {
  const lines = [];
  lines.push(
    `PR #${prNumber}: line comments ${totals.lineTotal} 件 / issue comments ${totals.issueTotal} 件 ` +
      `（うち人間由来 ${comments.length} 件）`
  );
  if (comments.length === 0) {
    lines.push('人間由来のコメントはありません（disposition の対象なし）。');
    return lines.join('\n');
  }
  lines.push('');
  lines.push('以下の各件について disposition を 1 つずつ確定してください');
  lines.push('（1. 追従コミットで適用 / 2. 不適用を reply で明記 / 3. follow-up Issue で追跡）:');
  lines.push('');
  for (const [index, comment] of comments.entries()) {
    const where =
      comment.source === 'line'
        ? `line ${comment.path ?? '(path 不明)'}:${comment.line ?? '?'}`
        : 'issue comment';
    const reply = comment.inReplyToId ? ` reply→${comment.inReplyToId}` : '';
    lines.push(`${index + 1}. [${where}] @${comment.author} ${comment.createdAt}${reply}`);
    lines.push(`   ${comment.excerpt}`);
    if (comment.url) lines.push(`   ${comment.url}`);
  }
  lines.push('');
  lines.push(
    '注意: PAT で動く自動化は user.type が "User" となるため、bot が人間として列挙されることがあります。'
  );
  lines.push('手順の正は docs/governance.md § 「レビュアーコメントの扱い」です。');
  return lines.join('\n');
}

/**
 * `gh api --paginate` を実行して JSON 配列を得る。
 *
 * `--paginate` は 2 系統とも必須（既定の 1 ページは 30 件で打ち切られる）。`per_page=100` は
 * URL クエリへ直接埋め込む（`-F per_page=100` は verb が POST になり HTTP 422 になる）。
 * `--slurp` はページ境界をまたいだ配列を 1 つの配列へ束ねるために使う。
 *
 * @param {string} endpoint
 * @returns {unknown[]}
 */
export function fetchComments(endpoint) {
  const result = spawnSync('gh', ['api', '--paginate', '--slurp', endpoint], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new Error(`gh の起動に失敗しました: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`gh api ${endpoint} が exit ${result.status} で失敗しました: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  // --slurp はページごとの配列を入れ子の配列で返すため平坦化する。
  return Array.isArray(parsed) ? parsed.flat() : [];
}

/**
 * 引数を解釈する。
 *
 * @param {string[]} argv
 * @returns {{ prNumber: string, repo: string, json: boolean }}
 */
export function parseArgs(argv) {
  let prNumber = null;
  let repo = ':owner/:repo';
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--repo') {
      repo = argv[index + 1];
      if (!repo) throw new Error('--repo には値が必要です');
      index += 1;
    } else if (arg.startsWith('--repo=')) {
      repo = arg.slice('--repo='.length);
    } else if (/^\d+$/.test(arg)) {
      prNumber = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!prNumber) throw new Error('PR 番号が必要です');
  return { prNumber, repo, json };
}

/**
 * 1 PR 分のチェックを実行する。
 *
 * @param {{ prNumber: string, repo?: string, fetch?: (endpoint: string) => unknown[] }} options
 */
export function checkCommentDisposition({
  prNumber,
  repo = ':owner/:repo',
  fetch = fetchComments,
}) {
  const lineComments = fetch(`repos/${repo}/pulls/${prNumber}/comments?per_page=100`);
  const issueComments = fetch(`repos/${repo}/issues/${prNumber}/comments?per_page=100`);
  const comments = collectHumanComments({ lineComments, issueComments });
  return {
    comments,
    totals: { lineTotal: lineComments.length, issueTotal: issueComments.length },
  };
}

const USAGE = `Usage: node scripts/check-comment-disposition.mjs <PR number> [--repo <owner/repo>] [--json]

終了コード: 0 = 人間由来コメントなし / 1 = あり（要 disposition）/ 2 = 使い方の誤り・gh 失敗`;

// CLI entry point
if (isDirectRun(import.meta.url)) {
  try {
    const { prNumber, repo, json } = parseArgs(process.argv.slice(2));
    const { comments, totals } = checkCommentDisposition({ prNumber, repo });
    if (json) {
      console.log(JSON.stringify({ prNumber, totals, comments }, null, 2));
    } else {
      console.log(formatReport(prNumber, comments, totals));
    }
    process.exitCode = comments.length === 0 ? 0 : 1;
  } catch (err) {
    console.error(`comment disposition check failed: ${err.message}`);
    console.error('');
    console.error(USAGE);
    process.exitCode = 2;
  }
}
