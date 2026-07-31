// #1574 producer Slice 2 (#1715): `commitSha` on every local-runner result.
//
// `mergeBase` is the COMPARISON base, not the reviewed commit, so provenance
// needs the HEAD sha as its own field. local-runner builds it once in
// collectLocalContext and every exported entry point re-emits it, which is the
// same call-site coverage problem docs/development/pipeline-params-checklist.md
// describes: a result object that silently loses the field on one branch makes
// `source_commit_sha` null for that path only, and nothing else notices.
//
// The eight return sites that carry the git identity trio
// (defaultBranch / mergeBase / commitSha) are pinned below, one test each:
//
//   src/lib/local-runner.mjs collectLocalContext  — the single producer
//   src/lib/local-runner.mjs planLocalReview      — skipped-by-label / no-changes / ok
//   src/lib/local-runner.mjs runLocalReview       — no-changes / skipped-by-label / ok
//   src/lib/local-runner.mjs doctorLocalReview    — ok
//
// collectLocalContext is not exported; it is covered transitively because every
// other assertion here reads the value it produced.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import { doctorLocalReview, planLocalReview, runLocalReview } from '../src/lib/local-runner.mjs';
import { getHeadSha } from '../src/lib/git.mjs';
import { createTempGitRepo, runGit } from './helpers/temp-repo.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

/** Repo with a staged change, so the review has something to look at. */
async function repoWithChange(t) {
  const { dir, cleanup } = await createTempGitRepo({
    prefix: 'river-commitsha-',
    initialFiles: { 'src/app.js': 'export const value = 1;\n' },
    changedFiles: { 'src/app.js': 'export const value = 2;\n' },
  });
  t.after(cleanup);
  await runGit(['add', '.'], dir);
  return dir;
}

/** Repo whose worktree matches HEAD, so the runner reports no-changes. */
async function repoWithoutChange(t) {
  const { dir, cleanup } = await createTempGitRepo({
    prefix: 'river-commitsha-clean-',
    initialFiles: { 'src/app.js': 'export const value = 1;\n' },
  });
  t.after(cleanup);
  return dir;
}

async function withPrLabels(labels, fn) {
  const prev = process.env.RIVER_PR_LABELS;
  process.env.RIVER_PR_LABELS = labels;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.RIVER_PR_LABELS;
    else process.env.RIVER_PR_LABELS = prev;
  }
}

async function assertCarriesHeadSha(result, dir) {
  const head = await getHeadSha(dir);
  assert.match(head, SHA_RE);
  assert.equal(result.commitSha, head, `status=${result.status} lost commitSha`);
  // The HEAD sha must not be confused with the comparison base: on a repo with
  // a single commit they happen to be equal, so this only asserts the field is
  // populated independently, not that the two always differ.
  assert.equal(typeof result.mergeBase, 'string');
}

describe('local-runner commitSha propagation (#1715)', () => {
  test('planLocalReview status=ok carries the HEAD sha', async (t) => {
    const dir = await repoWithChange(t);
    const context = await planLocalReview({ cwd: dir, dryRun: true });
    assert.equal(context.status, 'ok');
    await assertCarriesHeadSha(context, dir);
  });

  test('planLocalReview status=no-changes carries the HEAD sha', async (t) => {
    const dir = await repoWithoutChange(t);
    const context = await planLocalReview({ cwd: dir, dryRun: true });
    assert.equal(context.status, 'no-changes');
    await assertCarriesHeadSha(context, dir);
  });

  test('planLocalReview status=skipped-by-label carries the HEAD sha', async (t) => {
    const dir = await repoWithChange(t);
    writeFileSync(
      join(dir, '.river-review.json'),
      JSON.stringify({ exclude: { prLabelsToIgnore: ['skip-review'] } }, null, 2),
      'utf8'
    );
    const context = await withPrLabels('skip-review', () =>
      planLocalReview({ cwd: dir, dryRun: true })
    );
    assert.equal(context.status, 'skipped-by-label');
    await assertCarriesHeadSha(context, dir);
  });

  test('runLocalReview status=ok carries the HEAD sha', async (t) => {
    const dir = await repoWithChange(t);
    const result = await runLocalReview({ cwd: dir, dryRun: true, quiet: true });
    assert.equal(result.status, 'ok');
    await assertCarriesHeadSha(result, dir);
  });

  test('runLocalReview status=no-changes carries the HEAD sha', async (t) => {
    const dir = await repoWithoutChange(t);
    const result = await runLocalReview({ cwd: dir, dryRun: true, quiet: true });
    assert.equal(result.status, 'no-changes');
    await assertCarriesHeadSha(result, dir);
  });

  test('runLocalReview status=skipped-by-label carries the HEAD sha', async (t) => {
    const dir = await repoWithChange(t);
    writeFileSync(
      join(dir, '.river-review.json'),
      JSON.stringify({ exclude: { prLabelsToIgnore: ['skip-review'] } }, null, 2),
      'utf8'
    );
    const result = await withPrLabels('skip-review', () =>
      runLocalReview({ cwd: dir, dryRun: true, quiet: true })
    );
    assert.equal(result.status, 'skipped-by-label');
    await assertCarriesHeadSha(result, dir);
  });

  test('doctorLocalReview carries the HEAD sha', async (t) => {
    const dir = await repoWithChange(t);
    const result = await doctorLocalReview({ cwd: dir });
    assert.equal(result.status, 'ok');
    await assertCarriesHeadSha(result, dir);
  });

  test('a runner result from a non-git target does not fabricate a sha', async (t) => {
    // getHeadSha is fail-soft: ensureGitRepo rejects before the runner returns,
    // so the only observable contract is that the resolver itself never throws
    // and never invents a value the record could persist.
    const dir = await repoWithChange(t);
    assert.equal(await getHeadSha(join(dir, 'does-not-exist')), null);
  });
});
