/**
 * Deterministic command sandbox — preparation layer only (#1401 §11.8 (a)).
 *
 * PURE PREPARATION LAYER. This module implements increment (a) of the executor
 * from the #1401 design (§11.2 clean cwd, §11.3 env, §10.2 on-disk secret,
 * §10.3 stdout exfil / symlink non-following): it builds the scrubbed child
 * environment and stages review-target files into a clean cwd that contains no
 * `.git` and follows no symlinks.
 *
 * IT DOES NOT EXECUTE ANYTHING. There is deliberately NO import or use of
 * `child_process` / `spawn` / `execFile` / `exec` here — the RCE surface (the
 * actual `execFile` launch, increment (b)) lands in a separate PR. Reading and
 * copying files is allowed; starting processes is not. Keeping this layer
 * process-free means it has no RCE surface of its own and its symlink-blocking
 * and env-scrubbing behavior can be exercised freely by canary tests.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * SAFE_ENV allowlist (§11.3 / §3.3). Only these keys are copied from the
 * parent `process.env` into the child environment. Everything else — including
 * `NODE_OPTIONS`, `NODE_PATH`, `XDG_CONFIG_HOME`, `*_TOKEN`, `*_SECRET`,
 * `AWS_*`, `GITHUB_*` — is dropped by construction (allowlist, not denylist, so
 * a new secret variable name fails safe instead of leaking).
 */
export const SAFE_ENV_ALLOWLIST = Object.freeze(['PATH', 'LANG', 'LC_ALL', 'TZ']);

/**
 * Build the scrubbed environment for a sandboxed child process (§11.3 / §3.3).
 *
 * Starts from an empty object and copies ONLY the {@link SAFE_ENV_ALLOWLIST}
 * keys from `processEnv` (when present). `HOME` is NOT copied from the real
 * environment — the caller supplies the path to a fresh empty temp directory
 * via `home`, so `~/.aws` / `~/.npmrc` / `~/.git-credentials` are unreachable
 * (§10.2). `XDG_CONFIG_HOME` is pinned to the same empty `home` so config
 * autoload cannot reach the real `~/.config` (§10.1 (D)).
 *
 * Does not mutate `processEnv`; returns a fresh object.
 *
 * @param {Record<string, string | undefined>} processEnv - source env (e.g. `process.env`)
 * @param {{ home: string }} options - `home` is a fresh empty temp dir path
 * @returns {Record<string, string>} new child environment
 */
export function buildSandboxEnv(processEnv, { home } = {}) {
  if (typeof home !== 'string' || home.length === 0) {
    throw new TypeError('buildSandboxEnv: `home` (empty temp dir path) is required');
  }
  const source = processEnv && typeof processEnv === 'object' ? processEnv : {};
  const childEnv = {};
  for (const key of SAFE_ENV_ALLOWLIST) {
    const value = source[key];
    // Only copy real string values; skip undefined so the child env stays minimal.
    if (typeof value === 'string') {
      childEnv[key] = value;
    }
  }
  // HOME / XDG_CONFIG_HOME point at the caller-provided empty temp dir. The real
  // $HOME and ~/.config are never inherited (on-disk secret blocking, §10.2).
  childEnv.HOME = home;
  childEnv.XDG_CONFIG_HOME = home;
  return childEnv;
}

/**
 * True when any component of `relPath` is exactly `.git` (§10.2). Blocks both
 * `.git` and nested `.git/config` so a persisted GITHUB_TOKEN is never staged.
 * @param {string} relPath
 * @returns {boolean}
 */
function isGitPath(relPath) {
  return relPath.split(/[\\/]/).some((segment) => segment === '.git');
}

/**
 * True when `relPath` escapes `sourceDir` (absolute, `..` traversal, or empty).
 * Defensive: staging must never read outside the review target.
 * @param {string} sourceDir
 * @param {string} relPath
 * @returns {boolean}
 */
function escapesRoot(sourceDir, relPath) {
  if (path.isAbsolute(relPath)) return true;
  const resolved = path.resolve(sourceDir, relPath);
  const root = path.resolve(sourceDir);
  const rel = path.relative(root, resolved);
  return rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

/**
 * True when any ancestor path component (from `sourceDir` down to, and
 * including, the full entry) is a symlink (§10.3.2 (A)). Following a symlinked
 * PARENT directory would also reach outside the review target (e.g. a
 * `link/credentials` where `link -> ~/.aws`), so every segment is `lstat`ed —
 * not just the leaf.
 *
 * @param {string} sourceDir
 * @param {string} relPath
 * @returns {Promise<boolean>}
 */
async function pathContainsSymlink(sourceDir, relPath) {
  const segments = relPath.split(/[\\/]/).filter((s) => s.length > 0);
  let current = sourceDir;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch {
      // Missing intermediate component: nothing to follow. The leaf copy below
      // will surface a real ENOENT; treat "cannot stat" as "not a symlink here".
      return false;
    }
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * Recursively scan `dir` for any residual symlink and return their absolute
 * paths (§10.3.2 (A) step 3 / §11.2 step 3 — multi-layer TOCTOU re-check). Used
 * to prove that nothing symlinked survived into the clean cwd.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function findResidualSymlinks(dir) {
  const found = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      found.push(full);
    } else if (entry.isDirectory()) {
      found.push(...(await findResidualSymlinks(full)));
    }
  }
  return found;
}

/**
 * Stage review-target files into a clean cwd (§11.2 / §10.3.2 (A)).
 *
 * Copies each relative `files` entry from `sourceDir` into `destDir` (which the
 * caller created with {@link makeSandboxTempDir} / `fs.mkdtemp`). Symlinks are
 * NOT followed: any entry whose leaf OR any ancestor component is a symlink is
 * skipped and recorded (blocking `~/.aws`-style exfil). `.git` paths are
 * excluded (blocking `.git/config` token leak). After copying, `destDir` is
 * re-scanned for residual symlinks; any found are unlinked and recorded (they
 * should never occur, since symlinks are never copied — the re-scan is a
 * multi-layer TOCTOU guard).
 *
 * Never starts a process. Copy failures for an individual entry are recorded in
 * `errors` and do not abort the whole staging pass.
 *
 * @param {{ sourceDir: string, destDir: string, files: string[] }} args
 * @returns {Promise<{
 *   copied: string[],
 *   skippedSymlinks: string[],
 *   skippedGit: string[],
 *   skippedOutside: string[],
 *   errors: Array<{ file: string, message: string }>,
 * }>}
 */
export async function copyReviewTargetToSandbox({ sourceDir, destDir, files } = {}) {
  if (typeof sourceDir !== 'string' || sourceDir.length === 0) {
    throw new TypeError('copyReviewTargetToSandbox: `sourceDir` is required');
  }
  if (typeof destDir !== 'string' || destDir.length === 0) {
    throw new TypeError('copyReviewTargetToSandbox: `destDir` is required');
  }

  const copied = [];
  const skippedSymlinks = [];
  const skippedGit = [];
  const skippedOutside = [];
  const errors = [];

  const list = Array.isArray(files) ? files : [];
  for (const raw of list) {
    if (typeof raw !== 'string' || raw.length === 0) {
      // Ignore non-string / empty entries safely rather than throwing.
      continue;
    }
    const relPath = path.normalize(raw);

    if (isGitPath(relPath)) {
      skippedGit.push(raw);
      continue;
    }
    if (escapesRoot(sourceDir, relPath)) {
      skippedOutside.push(raw);
      continue;
    }
    if (await pathContainsSymlink(sourceDir, relPath)) {
      skippedSymlinks.push(raw);
      continue;
    }

    const srcPath = path.join(sourceDir, relPath);
    const destPath = path.join(destDir, relPath);
    try {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      // Copy the file contents only. COPYFILE_FICLONE is best-effort; symlinks
      // were already excluded above, so this always copies a regular file.
      await fs.copyFile(srcPath, destPath);
      copied.push(raw);
    } catch (err) {
      errors.push({ file: raw, message: err?.message ?? String(err) });
    }
  }

  // Multi-layer re-check: prove no symlink survived into the clean cwd.
  const residual = await findResidualSymlinks(destDir);
  for (const link of residual) {
    try {
      await fs.unlink(link);
    } catch {
      // Ignore unlink failure; it is still recorded so the caller can fail safe.
    }
    skippedSymlinks.push(path.relative(destDir, link));
  }

  return { copied, skippedSymlinks, skippedGit, skippedOutside, errors };
}

/**
 * Create a fresh empty temp directory for use as a sandbox `HOME` or clean cwd
 * (`RIVER_EXEC_ROOT`). Thin wrapper over `fs.mkdtemp`, injectable for tests.
 *
 * Cleanup is the CALLER'S responsibility: wrap usage in `try/finally` and
 * remove the returned directory (e.g. `fs.rm(dir, { recursive: true,
 * force: true })`) on every path — success, spawn failure, timeout, exception —
 * so no sandbox directory is ever left behind (§11.2 lifecycle).
 *
 * @param {(prefix: string) => Promise<string>} [mkdtempImpl] - defaults to `fs.mkdtemp`
 * @param {string} [prefix] - path prefix; defaults to `os.tmpdir()/river-sandbox-`
 * @returns {Promise<string>} absolute path of the new empty directory
 */
export function makeSandboxTempDir(mkdtempImpl, prefix) {
  const impl = typeof mkdtempImpl === 'function' ? mkdtempImpl : fs.mkdtemp;
  const base =
    typeof prefix === 'string' && prefix.length > 0
      ? prefix
      : path.join(os.tmpdir(), 'river-sandbox-');
  return impl(base);
}
