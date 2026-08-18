#!/usr/bin/env node
// Normalize the GitHub Action dist so its bytes depend only on the sources,
// never on the machine or the directory the build happened to run in.
//
// Two normalizations run here:
//
//   1. Line endings -> LF. ncc bundles tslib and other deps with CRLF on some
//      platforms; this ensures cross-platform deterministic output.
//   2. Build-directory name -> the canonical checkout name (see below).
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  renameSync,
  cpSync,
  rmSync,
} from 'fs';
import { basename, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(repoRoot, 'runners/github-action/dist');

// --- 2. build-directory name -------------------------------------------------
//
// ncc resolves relocated assets relative to the PARENT of the build root, so
// both the emitted asset directory (dist/<name>/...) and the asset references
// inside the bundle (`__webpack_require__.ab + "<name>/..."`) are prefixed with
// `basename(repoRoot)`. The committed dist was therefore built in a directory
// named after the repository, which is what `actions/checkout` produces in CI.
// A build run from a git worktree such as `.claude/worktrees/agent-<id>/` bakes
// that directory name in instead, and `Action dist freshness` then reports a
// diff for a bundle whose sources did not change (observed in #1894).
//
// The canonical name is read from package.json `name` rather than hardcoded,
// so a repository rename only has to be applied in one place. It is not read
// from the git remote: the build must also work from a source tarball or a CI
// cache where no git metadata is present, and a remote can be renamed or
// missing without the checkout directory changing.
const canonicalName = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).name.replace(
  /^@[^/]+\//,
  ''
);
const buildDirName = basename(repoRoot.replace(/[/\\]+$/, ''));

// Only the ncc asset-prefix expression is rewritten, never a bare occurrence of
// the directory name. The repository name also appears in the bundle as a
// package name, as a URL, and inside vendored source paths such as
// `skills/agent-skills/river-review/...`; a plain string replacement would
// corrupt those. Anchoring on `__webpack_require__.ab` restricts the rewrite to
// strings ncc itself generated for asset resolution.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const assetPrefixPattern = new RegExp(
  `(__webpack_require__\\.ab\\s*\\+\\s*")${escapeRegExp(buildDirName)}/`,
  'g'
);

const renameBuildDirName = buildDirName !== canonicalName;

let normalized = 0;
for (const file of readdirSync(distDir)) {
  if (file.endsWith('.mjs') || file.endsWith('.map') || file.endsWith('.cjs')) {
    const path = join(distDir, file);
    const content = readFileSync(path, 'utf8');
    let fixed = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (renameBuildDirName) {
      fixed = fixed.replace(assetPrefixPattern, `$1${canonicalName}/`);
    }
    if (fixed !== content) {
      writeFileSync(path, fixed, 'utf8');
      normalized++;
    }
  }
}

// The emitted asset directory is renamed rather than left in place or merely
// reported: leaving `dist/<worktree name>/` behind makes `git status` on dist/
// dirty (the freshness job compares with `git status --porcelain`), and the
// bundle references the canonical directory after the rewrite above, so the
// assets have to live there for the built action to resolve them.
let renamedDir = false;
if (renameBuildDirName) {
  const staleDir = join(distDir, buildDirName);
  const targetDir = join(distDir, canonicalName);
  if (existsSync(staleDir)) {
    if (existsSync(targetDir)) {
      // A previous build already produced the canonical directory. The two hold
      // the same assets, so overwrite rather than fail.
      cpSync(staleDir, targetDir, { recursive: true, force: true });
      rmSync(staleDir, { recursive: true, force: true });
    } else {
      renameSync(staleDir, targetDir);
    }
    renamedDir = true;
  }
}

if (normalized > 0) console.log(`Normalized ${normalized} file(s) in dist/`);
if (renameBuildDirName && (normalized > 0 || renamedDir)) {
  console.log(
    `Rewrote build directory name "${buildDirName}" to "${canonicalName}" in dist/ ` +
      `(build ran outside a checkout named "${canonicalName}").`
  );
}
