// Canonical "is this module the CLI entry point?" check (regression F-1).
//
// Background: this repo previously had THREE different inline
// implementations of this check spread across scripts/*.mjs:
//   1. The "canonical" form with no error handling:
//        process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
//   2. A try/catch-guarded copy of (1) (scripts/evaluate-convergence-efficiency.mjs).
//   3. A looser `process.argv[1].endsWith('<script-name>')` form
//        (scripts/skill-changelog.mjs).
// Form (1) crashes at *import time* with ENOENT whenever `process.argv[1]`
// does not resolve to a real file on disk. This is not hypothetical: running
// `node --input-type=module -` and piping `import '<script>.mjs'` via stdin
// (used to regression-test these scripts, and independently reproduced by
// Codex) leaves `process.argv[1]` unset or pointing at a synthetic path, so
// `realpathSync()` throws before the importing code ever runs. Form (3)
// avoids the crash but is a weaker, drift-prone stand-in for the intended
// check.
//
// This helper is the single source of truth: it keeps the strict
// `import.meta.url === pathToFileURL(realpathSync(...)).href` comparison
// (which correctly handles symlinks) but never lets a missing/synthetic
// `process.argv[1]` crash the importing module — any failure to resolve
// falls back to `false` (i.e. "not a direct run"), which is always the safe
// default: at worst it skips a CLI entry point, it never runs one it
// shouldn't.

import { realpathSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Detect whether the current module was invoked directly as a CLI entry
 * point (e.g. `node scripts/foo.mjs`) rather than merely `import`-ed by
 * another module (tests, other scripts, bundlers, `node --input-type=module -`).
 *
 * @param {string} importMetaUrl - the caller's `import.meta.url`.
 * @returns {boolean} true if this module is the process's entry point.
 */
export function isDirectRun(importMetaUrl) {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return importMetaUrl === pathToFileURL(realpathSync(entryArg)).href;
  } catch {
    return false;
  }
}
