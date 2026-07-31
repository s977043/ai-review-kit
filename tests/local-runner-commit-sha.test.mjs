// #1574 producer Slice 2 (#1715): `commitSha` + `dirty` on every local-runner
// result.
//
// `mergeBase` is the COMPARISON base, so provenance needs the HEAD sha as its
// own field — but the sha alone is not enough. The runner diffs the WORKING
// TREE, so on a dirty tree the reviewed lines are absent from HEAD's tree, and
// a record holding only `commitSha` cannot say which case it was. `dirty`
// closes that gap (#1715 W1).
//
// local-runner builds both once in collectLocalContext and every exported entry
// point re-emits them, which is the same call-site coverage problem
// docs/development/pipeline-params-checklist.md describes: a result object that
// silently loses a field on one branch makes the provenance wrong for that path
// only, and nothing else notices.
//
// The eight return sites that carry the git identity fields
// (defaultBranch / mergeBase / commitSha / dirty) are pinned below, one test each:
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
import { getHeadSha, isWorkingTreeDirty } from '../src/lib/git.mjs';
import { createTempGitRepo, runGit } from './helpers/temp-repo.mjs';

// 40 hex for SHA-1, 64 for a SHA-256 repository (`git init --object-format=sha256`).
// Pinning 40 only would fail on such a repo even though the producer is correct;
// the record itself does not constrain the length (#1715 N3 — adding a `pattern`
// to the two aggregate schemas is deliberately out of this PR's scope).
const SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

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

/** Repo with an unstaged edit, so only `git status --porcelain` sees it. */
async function repoWithUnstagedChange(t) {
  const { dir, cleanup } = await createTempGitRepo({
    prefix: 'river-commitsha-unstaged-',
    initialFiles: { 'src/app.js': 'export const value = 1;\n' },
    changedFiles: { 'src/app.js': 'export const value = 2;\n' },
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
  // NOTE — asserting `commitSha === HEAD` is the point, not an oversight, even
  // though these fixtures stage a change that HEAD's tree does NOT contain.
  // `commitSha` records the baseline the review ran against; the reviewed lines
  // come from the working tree. That gap is exactly what `dirty` below exists
  // to make visible, so this assertion pins the intended semantics rather than
  // "HEAD contains the reviewed code" (#1715 W1).
  assert.equal(result.commitSha, head, `status=${result.status} lost commitSha`);
  // Every path must carry the dirty flag too — a path that drops it silently
  // loses the only signal distinguishing a reproducible sha from a stale one.
  assert.equal(typeof result.dirty, 'boolean', `status=${result.status} lost dirty`);
  // The HEAD sha must not be confused with the comparison base: on a repo with
  // a single commit they happen to be equal, so this only asserts the field is
  // populated independently, not that the two always differ.
  assert.equal(typeof result.mergeBase, 'string');
}

describe('local-runner commitSha / dirty propagation (#1715)', () => {
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

  test('a dirty working tree is reported as dirty, a clean one as clean', async (t) => {
    // The staged fixture and the unstaged fixture are both dirty: HEAD's tree
    // reproduces neither. Only the untouched repo is clean.
    const staged = await repoWithChange(t);
    const unstaged = await repoWithUnstagedChange(t);
    const clean = await repoWithoutChange(t);

    assert.equal((await planLocalReview({ cwd: staged, dryRun: true })).dirty, true);
    assert.equal((await planLocalReview({ cwd: unstaged, dryRun: true })).dirty, true);
    assert.equal((await planLocalReview({ cwd: clean, dryRun: true })).dirty, false);

    // Same answer straight from the resolver, so the runner is not massaging it.
    assert.equal(await isWorkingTreeDirty(staged), true);
    assert.equal(await isWorkingTreeDirty(unstaged), true);
    assert.equal(await isWorkingTreeDirty(clean), false);
  });

  test('a runner result from a non-git target does not fabricate a sha or a clean tree', async (t) => {
    // getHeadSha / isWorkingTreeDirty are fail-soft: ensureGitRepo rejects
    // before the runner returns, so the only observable contract is that the
    // resolvers never throw and never invent a value the record could persist.
    // `dirty` in particular must be null, not false — reporting "clean" for a
    // tree that was never inspected is the one wrong answer.
    const dir = await repoWithChange(t);
    assert.equal(await getHeadSha(join(dir, 'does-not-exist')), null);
    assert.equal(await isWorkingTreeDirty(join(dir, 'does-not-exist')), null);
  });
});
