import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export class GitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitError';
  }
}

export class GitRepoNotFoundError extends GitError {
  constructor(cwd) {
    super(`Not a git repository: ${cwd}`);
    this.name = 'GitRepoNotFoundError';
  }
}

async function runGit(args, { cwd }) {
  try {
    // Use a large maxBuffer (200MB) to handle large diffs (e.g., pnpm-lock.yaml changes)
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 200 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new GitError(detail);
  }
}

export async function ensureGitRepo(cwd) {
  const insideWorkTree = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd }).catch(
    () => null
  );
  if (insideWorkTree !== 'true') {
    throw new GitRepoNotFoundError(cwd);
  }
  return runGit(['rev-parse', '--show-toplevel'], { cwd });
}

export async function detectDefaultBranch(cwd) {
  const candidates = [];
  const ref = await runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd }).catch(
    () => null
  );
  if (ref) {
    const parts = ref.split('/');
    candidates.push(parts[parts.length - 1]);
  }
  candidates.push('main', 'master');

  for (const branch of candidates) {
    const exists = await runGit(['rev-parse', '--quiet', '--verify', branch], { cwd }).catch(
      () => null
    );
    if (exists) return branch;
    const remoteExists = await runGit(['rev-parse', '--quiet', '--verify', `origin/${branch}`], {
      cwd,
    }).catch(() => null);
    if (remoteExists) return branch;
  }
  return 'HEAD';
}

/**
 * Resolve `baseRef` to a commit SHA, or null when git cannot resolve it.
 *
 * Uses the SAME candidate order as {@link findMergeBase} (`origin/<ref>` then
 * `<ref>`), but NOT the same predicate: this asks `rev-parse` whether the ref
 * names a commit, while findMergeBase asks `merge-base HEAD <ref>` whether the
 * two share history. The implication holds in one direction only — a ref this
 * rejects is one findMergeBase cannot use either, but a ref this accepts can
 * still have no merge base (unrelated history, a shallow clone) and fall back
 * to HEAD. Callers that must not review an empty range therefore check the
 * resulting merge base as well (see resolveBaseRepoDiff in
 * src/cli/commands/review.mjs). Verified 2026-09-04: `--base <orphan branch>`
 * passes this check and still yields mergeBase === HEAD (#2046 review).
 *
 * @param {string} cwd repository path
 * @param {string} baseRef branch / ref / SHA as typed by the user
 * @returns {Promise<string|null>} commit SHA, or null when unresolvable
 */
export async function resolveRefToCommit(cwd, baseRef) {
  for (const ref of [`origin/${baseRef}`, baseRef]) {
    const sha = await runGit(['rev-parse', '--quiet', '--verify', `${ref}^{commit}`], {
      cwd,
    }).catch(() => null);
    if (sha) return sha;
  }
  return null;
}

export async function findMergeBase(cwd, baseRef) {
  const candidates = [`origin/${baseRef}`, baseRef];
  for (const ref of candidates) {
    const mergeBase = await runGit(['merge-base', 'HEAD', ref], { cwd }).catch(() => null);
    if (mergeBase) return mergeBase;
  }
  // fallback to current HEAD to keep diff calculations deterministic
  return runGit(['rev-parse', 'HEAD'], { cwd });
}

/**
 * Resolve the HEAD commit sha of a repository.
 *
 * Same `rev-parse HEAD` call `findMergeBase` already falls back to, exported so
 * the run record can name the commit a review was taken AGAINST (#1715 / 契約1
 * provenance). `mergeBase` is the comparison base, so it cannot stand in for
 * this.
 *
 * IMPORTANT — this is NOT "the commit containing the reviewed code". The local
 * runner diffs the WORKING TREE against `mergeBase`, so on a dirty tree (the
 * normal case for `river run` during development) the reviewed lines exist only
 * in the working tree and are absent from HEAD's tree. The sha identifies the
 * baseline the reviewed change sat on top of; pair it with
 * `isWorkingTreeDirty` to know whether HEAD alone reproduces what was reviewed.
 *
 * Fail-soft on purpose: returns null instead of throwing when `cwd` is not a
 * git repository or HEAD is unborn (a fresh `git init` before the first
 * commit). The sha is optional provenance and a review must never fail because
 * the commit identity could not be resolved.
 *
 * @param {string} cwd
 * @returns {Promise<string|null>} 40-hex sha, or null when unavailable
 */
export async function getHeadSha(cwd) {
  return runGit(['rev-parse', 'HEAD'], { cwd }).catch(() => null);
}

/**
 * Report whether the working tree carries changes HEAD does not have.
 *
 * Without this, a record holding only `commitSha` cannot distinguish "the
 * review read exactly HEAD's tree" from "the review read HEAD plus uncommitted
 * edits" — and the second is the default case locally. A consumer that treats
 * `source_commit_sha` as reproducible needs to see the difference (#1715 W1).
 *
 * `--porcelain` covers staged, unstaged, and untracked changes, which is
 * exactly the set `collectRepoDiff` can pick up beyond HEAD.
 *
 * Fail-soft, and tri-state on purpose: null means "could not determine" (not a
 * git repo, git unavailable). Collapsing that to `false` would report a clean
 * tree that was never observed.
 *
 * @param {string} cwd
 * @returns {Promise<boolean|null>} true when dirty, false when clean, null when unknown
 */
export async function isWorkingTreeDirty(cwd) {
  const status = await runGit(['status', '--porcelain'], { cwd }).catch(() => null);
  if (status === null) return null;
  return status.length > 0;
}

export async function listChangedFiles(cwd, baseRef) {
  const stdout = await runGit(['diff', '--name-only', baseRef], { cwd });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function diffWithContext(cwd, baseRef, { unified = 3 } = {}) {
  return runGit(['diff', `--unified=${unified}`, '--no-color', baseRef], { cwd });
}

export function collectAddedLineHints(diffText) {
  const hints = new Map();
  let currentFile = null;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ b/')) {
      // We record the first hunk per file; this keeps output stable for the placeholder comments.
      currentFile = line.replace('+++ b/', '').trim();
      continue;
    }
    if (!line.startsWith('@@')) continue;
    const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match && currentFile && !hints.has(currentFile)) {
      const startLine = Number.parseInt(match[1], 10);
      hints.set(currentFile, startLine);
    }
  }
  return hints;
}
