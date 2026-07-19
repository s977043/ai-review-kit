/**
 * fullFile context supply resolver (#1606).
 *
 * The default runner (`river run` → src/lib/local-runner.mjs) already injects
 * the full text of changed source files into the LLM prompt via
 * {@link module:src/lib/repo-context.collectRepoContext} (the "Full file: …"
 * sections), under a per-file / total character budget. What was missing is a
 * DECLARATION of that capability in the `availableContexts` set used for
 * inputContext-based skill selection — so `recommended` skills whose
 * `inputContext` includes `fullFile` were silently skipped by
 * `missingInputContexts()` even though the content was present in the prompt
 * (the #1598 silent-skip class; #1606 a-3).
 *
 * This module decides — with the SAME eligibility rules and budget caps that
 * collectRepoContext actually applies — whether the runner can honestly claim
 * `fullFile` for the current change set, and records a debug ledger of which
 * files were supplied vs skipped (oversize / binary / generated / non-source).
 * It never injects content itself (collectRepoContext remains the single
 * content path, so the LLM prompt budget is unchanged); it only gates the
 * declaration. Fail-safe: any per-file error is recorded and skipped, and the
 * diff-only review continues regardless.
 */

import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';

// Budget caps aligned with src/lib/repo-context.mjs (SECTION_CAPS.fullFile /
// DEFAULT_MAX_CHARS). Kept in sync so the declaration never over-claims more
// than collectRepoContext actually supplies to the prompt.
export const PER_FILE_CHAR_CAP = 3000;
export const TOTAL_CHAR_CAP = 8000;
export const MAX_FILES = 5;

// Source-file extensions collectRepoContext.isSourceFile actually reads. Only
// these carry `fullFile` content; docs / data / lock files never do.
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|rb|go|java|kt|swift)$/;

// Machine-generated build output (mirror diff-processor.EXCLUDED_DIR_RE). These
// are not meaningfully reviewable and must never be supplied as fullFile.
const GENERATED_DIR_RE = /(?:^|\/)dist\//;

// Bytes sampled when sniffing for a binary file (a NUL byte in the head).
const BINARY_SNIFF_BYTES = 8000;

/**
 * Whether fullFile supply is enabled. Opt-out via `RIVER_FULLFILE_SUPPLY`
 * (off / 0 / false / no), mirroring the env-flag convention used by
 * `RIVER_OFFLINE` / `RIVER_DEPENDENCY_STUBS`. Default: enabled.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isFullFileSupplyEnabled(env = process.env) {
  const v = String(env?.RIVER_FULLFILE_SUPPLY ?? '')
    .trim()
    .toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false' || v === 'no');
}

function looksBinary(buf) {
  const n = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < n; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Decide whether the runner can declare `fullFile` for this change set and
 * produce a debug ledger of supplied / skipped files.
 *
 * @param {object} opts
 * @param {string[]} [opts.changedFiles] - repoRoot-relative changed file paths
 * @param {string} opts.repoRoot - absolute repository root
 * @param {string[]} [opts.excludePatterns] - config.exclude.files globs
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ available: boolean, enabled: boolean, totalChars: number,
 *   supplied: Array<{path: string, chars: number, truncated: boolean}>,
 *   skipped: Array<{path: string, reason: string}> }}
 */
export function resolveFullFileSupply({
  changedFiles = [],
  repoRoot,
  excludePatterns = [],
  env = process.env,
} = {}) {
  const enabled = isFullFileSupplyEnabled(env);
  const supplied = [];
  const skipped = [];

  if (!enabled) {
    return { available: false, enabled: false, totalChars: 0, supplied, skipped };
  }

  const considered = changedFiles.slice(0, MAX_FILES);
  for (const rel of changedFiles.slice(MAX_FILES)) {
    skipped.push({ path: rel, reason: 'beyond-file-limit' });
  }

  let totalChars = 0;
  for (const rel of considered) {
    if (
      GENERATED_DIR_RE.test(rel) ||
      excludePatterns.some((p) => minimatch(rel, p, { dot: true }))
    ) {
      skipped.push({ path: rel, reason: 'excluded' });
      continue;
    }
    if (!SOURCE_RE.test(rel)) {
      skipped.push({ path: rel, reason: 'non-source' });
      continue;
    }

    const abs = path.join(repoRoot, rel);
    let buf;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) {
        skipped.push({ path: rel, reason: 'missing' });
        continue;
      }
      buf = fs.readFileSync(abs);
    } catch {
      // Fail-safe: an unreadable file is skipped, never fatal.
      skipped.push({ path: rel, reason: 'unreadable' });
      continue;
    }

    if (looksBinary(buf)) {
      skipped.push({ path: rel, reason: 'binary' });
      continue;
    }

    const text = buf.toString('utf8');
    if (!text.trim()) {
      skipped.push({ path: rel, reason: 'empty' });
      continue;
    }

    const chars = Math.min(text.length, PER_FILE_CHAR_CAP);
    if (totalChars + chars > TOTAL_CHAR_CAP) {
      skipped.push({ path: rel, reason: 'budget-exceeded' });
      continue;
    }

    totalChars += chars;
    supplied.push({ path: rel, chars, truncated: text.length > PER_FILE_CHAR_CAP });
  }

  return { available: supplied.length > 0, enabled: true, totalChars, supplied, skipped };
}
