// #1644: finding の `scope` を GitHub Action の PR コメント経路へ届ける回帰テスト。
//
// 対象は `runners/github-action/post-inline-comments.cjs`（CommonJS の
// actions/github-script ランナー。`npm run build:action` の bundle 対象外）。
//
// 期待値は実装から導かない。post-inline-comments.cjs の関数を両側から呼ぶと
// 「pre-existing を隠す」条件を反転させても緑のままになるため、この test は
// 公開経路（module.exports の関数）だけを呼び、期待値は手書きの literal で
// 固定する。
//
// 固定する不変条件:
//   - `scope: 'pre-existing'` の finding は inline review comment にならない
//   - その finding は summary の <details> に **全文**（message / evidence /
//     suggestion）で残る = 投稿を止めても情報が失われない
//   - scope が欠損 / null / 語彙外の finding は従来どおり inline に出る（fail-safe）
//   - pre-existing が 0 件なら <details> ブロック自体を出さない

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const postInlineComments = require(
  fileURLToPath(new URL('../runners/github-action/post-inline-comments.cjs', import.meta.url))
);

const MAX_SUMMARY_BODY = postInlineComments.MAX_SUMMARY_BODY;

/**
 * Run the action entry point against a fake Octokit and return what it posted.
 *
 * @param {object} data JSON artifact the action reads
 * @param {object} [options]
 * @param {boolean} [options.failBatch] make the batched review call reject
 */
async function run(data, { failBatch = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'river-inline-scope-'));
  const jsonPath = join(dir, 'output.json');
  writeFileSync(jsonPath, JSON.stringify(data), 'utf8');

  const posted = {
    batchComments: null,
    singleComments: [],
    summaryBody: null,
    warnings: [],
    infos: [],
    failures: [],
  };

  const github = {
    rest: {
      pulls: {
        async createReview({ comments }) {
          if (failBatch) throw new Error('line not in diff');
          posted.batchComments = comments;
        },
        async createReviewComment({ path, line, body }) {
          posted.singleComments.push({ path, line, body });
        },
      },
      issues: {
        listComments: 'listComments',
        async createComment({ body }) {
          posted.summaryBody = body;
        },
        async updateComment({ body }) {
          posted.summaryBody = body;
        },
      },
    },
    async paginate() {
      return [];
    },
  };

  const context = {
    repo: { owner: 'acme', repo: 'widgets' },
    payload: { pull_request: { number: 7, head: { sha: 'deadbeef' } } },
  };

  const core = {
    info: (m) => posted.infos.push(m),
    warning: (m) => posted.warnings.push(m),
    setFailed: (m) => posted.failures.push(m),
  };

  const previous = process.env.RIVER_REVIEWER_JSON_PATH;
  process.env.RIVER_REVIEWER_JSON_PATH = jsonPath;
  try {
    await postInlineComments({ github, context, core });
  } finally {
    if (previous === undefined) delete process.env.RIVER_REVIEWER_JSON_PATH;
    else process.env.RIVER_REVIEWER_JSON_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
  return posted;
}

/** Minimal artifact whose severity counts match the issue list. */
function artifact(issues, extra = {}) {
  const counts = {};
  for (const i of issues) counts[i.severity] = (counts[i.severity] ?? 0) + 1;
  return { issues, summary: { issueCountBySeverity: counts }, ...extra };
}

const IN_DIFF = {
  id: 'rr-in',
  title: 'null check missing on the new branch',
  message: 'The added guard clause does not cover the empty-array case.',
  severity: 'major',
  file: 'src/app.js',
  line: 12,
  evidence: ['if (!items.length) is absent'],
  suggestion: 'if (!items?.length) return [];',
  scope: 'in-diff',
};

const PRE_EXISTING = {
  id: 'rr-pre',
  title: 'legacy helper swallows exceptions',
  message: 'The surrounding catch block returns silently.',
  severity: 'critical',
  file: 'src/app.js',
  line: 3,
  evidence: ['catch (e) { return null; }'],
  suggestion: 'catch (e) { logger.error(e); throw e; }',
  scope: 'pre-existing',
};

describe('#1644: pre-existing findings never become inline review comments', () => {
  it('posts the in-diff finding inline and withholds the pre-existing one', async () => {
    const posted = await run(artifact([IN_DIFF, PRE_EXISTING]));

    assert.deepEqual(
      posted.batchComments.map((c) => `${c.path}:${c.line}`),
      ['src/app.js:12']
    );
    assert.equal(posted.batchComments.length, 1);
    assert.ok(!JSON.stringify(posted.batchComments).includes('legacy helper swallows exceptions'));
  });

  it('withholds it on the per-comment fallback path too', async () => {
    const posted = await run(artifact([IN_DIFF, PRE_EXISTING]), { failBatch: true });

    assert.deepEqual(
      posted.singleComments.map((c) => `${c.path}:${c.line}`),
      ['src/app.js:12']
    );
  });

  it('posts inline when scope is absent (fail-safe: never demote the unclassified)', async () => {
    const { scope, ...noScope } = PRE_EXISTING;
    assert.equal(scope, 'pre-existing');
    const posted = await run(artifact([noScope]));

    assert.equal(posted.batchComments.length, 1);
    assert.equal(posted.batchComments[0].line, 3);
    assert.ok(!posted.summaryBody.includes('<details>'));
  });

  it('posts inline for null and out-of-vocabulary scope values', async () => {
    for (const scope of [null, '', 'preexisting', 'PRE-EXISTING', 'unknown']) {
      const posted = await run(artifact([{ ...PRE_EXISTING, scope }]));
      assert.equal(posted.batchComments.length, 1, `scope=${JSON.stringify(scope)} was demoted`);
      assert.ok(
        !posted.summaryBody.includes('<details>'),
        `scope=${JSON.stringify(scope)} was folded`
      );
    }
  });
});

describe('#1644: the summary keeps every pre-existing finding in full', () => {
  it('folds it into a details block carrying message, evidence and fix', async () => {
    const posted = await run(artifact([IN_DIFF, PRE_EXISTING]));
    const body = posted.summaryBody;

    assert.ok(body.includes('<details>'));
    assert.ok(
      body.includes(
        "<summary>🔍 1 pre-existing finding — outside this diff's added lines</summary>"
      )
    );
    assert.ok(
      body.includes('🔴 **[critical]** legacy helper swallows exceptions `src/app.js:3`'),
      body
    );
    assert.ok(body.includes('The surrounding catch block returns silently.'));
    assert.ok(body.includes('**Evidence:** catch (e) { return null; }'));
    assert.ok(body.includes('catch (e) { logger.error(e); throw e; }'));
    assert.ok(body.includes('</details>'));
  });

  it('pluralises the count label', async () => {
    const posted = await run(
      artifact([PRE_EXISTING, { ...PRE_EXISTING, id: 'rr-pre2', line: 4, severity: 'minor' }])
    );
    assert.ok(
      posted.summaryBody.includes(
        "<summary>🔍 2 pre-existing findings — outside this diff's added lines</summary>"
      )
    );
  });

  it('renders the fix as a plain fence, not a dead suggestion widget', async () => {
    const posted = await run(artifact([IN_DIFF, PRE_EXISTING]));

    assert.ok(posted.batchComments[0].body.includes('```suggestion'));
    assert.ok(!posted.summaryBody.includes('```suggestion'));
    assert.ok(posted.summaryBody.includes('**Suggested fix:**\n```\ncatch (e) { logger.error'));
  });

  it('keeps an unlocated pre-existing finding in the folded block, not the inline-failure list', async () => {
    const unlocated = { ...PRE_EXISTING, file: undefined, line: undefined };
    const posted = await run(artifact([unlocated]));

    assert.ok(!posted.summaryBody.includes('### Findings not posted inline'));
    assert.ok(posted.summaryBody.includes('<details>'));
    assert.ok(posted.summaryBody.includes('🔴 **[critical]** legacy helper swallows exceptions\n'));
  });

  it('places the folded block below the in-diff inline-failure list', async () => {
    const unlocatedInDiff = {
      ...IN_DIFF,
      id: 'rr-unlocated',
      file: undefined,
      line: undefined,
    };
    const posted = await run(artifact([unlocatedInDiff, PRE_EXISTING]));

    const listAt = posted.summaryBody.indexOf('### Findings not posted inline');
    const detailsAt = posted.summaryBody.indexOf('<details>');
    assert.ok(listAt >= 0);
    assert.ok(detailsAt > listAt);
  });

  it('emits no details block when nothing is pre-existing', async () => {
    const posted = await run(artifact([IN_DIFF]));
    assert.ok(!posted.summaryBody.includes('<details>'));
    assert.ok(!posted.summaryBody.includes('pre-existing'));
  });

  it('neutralises details markup smuggled through finding text', async () => {
    const posted = await run(
      artifact([{ ...PRE_EXISTING, message: 'closes early </details> and reopens <summary>x' }])
    );

    // Only the opening `<` of the tag is escaped, matching neutralizeDetailsMarkup
    // in src/cli/render.mjs — enough to stop the tag from being parsed.
    assert.ok(posted.summaryBody.includes('&lt;/details> and reopens &lt;summary>x'));
    assert.equal(posted.summaryBody.split('</details>').length - 1, 1);
  });

  it('degrades to pointer lines instead of exceeding the comment size limit', async () => {
    const bulky = Array.from({ length: 60 }, (_, i) => ({
      ...PRE_EXISTING,
      id: `rr-bulk-${i}`,
      line: i + 1,
      message: 'x'.repeat(2000),
    }));
    const posted = await run(artifact(bulky));

    assert.ok(posted.summaryBody.length <= MAX_SUMMARY_BODY);
    assert.ok(posted.summaryBody.includes('<details>'));
    assert.ok(
      posted.summaryBody.includes('- 🔴 **legacy helper swallows exceptions** `src/app.js:1`')
    );
    assert.ok(!posted.summaryBody.includes('**Evidence:**'));
  });
});

describe('#1644: the Tech Lead pointer list marks pre-existing only', () => {
  it('appends the marker to a pre-existing entry', async () => {
    const posted = await run(
      artifact([PRE_EXISTING], {
        teamLeadReport: { top3Findings: [PRE_EXISTING] },
      })
    );

    assert.ok(
      posted.summaryBody.includes(
        '- 🔴 **legacy helper swallows exceptions** (src/app.js) _(pre-existing)_'
      ),
      posted.summaryBody
    );
  });

  it('adds no marker for in-diff or for a finding without scope', async () => {
    const { scope, ...noScope } = IN_DIFF;
    assert.equal(scope, 'in-diff');
    const posted = await run(
      artifact([IN_DIFF], {
        teamLeadReport: { top3Findings: [IN_DIFF, { ...noScope, id: 'rr-noscope' }] },
      })
    );

    assert.ok(!posted.summaryBody.includes('_(pre-existing)_'));
    assert.equal(
      posted.summaryBody.split('- 🟠 **null check missing on the new branch** (src/app.js)')
        .length - 1,
      2
    );
  });
});
