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
 * the run record can name the commit a review observed (#1715 / 契約1
 * provenance). `mergeBase` is the comparison base, not the reviewed commit, so
 * it cannot stand in for this.
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
