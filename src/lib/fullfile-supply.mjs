/**
 * fullFile context supply resolver (#1606).
 *
 * The default runner (`river run` → src/lib/local-runner.mjs) injects the full
 * text of changed source files into the LLM prompt via
 * {@link module:src/lib/repo-context.collectRepoContext} (the "Full file: …"
 * sections), under a per-file / total character (and optional token) budget.
 * What was missing is a DECLARATION of that capability in the `availableContexts`
 * set used for inputContext-based skill selection — so `recommended` skills
 * whose `inputContext` includes `fullFile` were silently skipped by
 * `missingInputContexts()` even though the content was present in the prompt
 * (the #1598 silent-skip class; #1606 a-3).
 *
 * PARITY (#1606 warning-1 fix): this resolver does NOT reimplement the
 * eligibility rules. It calls the exact same `collectFullFileSections` that
 * collectRepoContext uses, so the declaration (`available`) is true if and only
 * if that shared computation produces at least one non-empty "Full file:"
 * section. Security deny-globs (`shouldExcludeForContext`, e.g. secrets/pem/env),
 * redaction, the char budget, the `context.budget.maxTokens` token budget, and
 * per-file truncation are therefore all honored identically — there is no
 * "declare true / inject empty" path. It reads files (same cost the injection
 * pays) but discards the content; only the ledger is kept. Fail-safe: per-file
 * read errors are recorded as skips by the shared helper and the diff-only
 * review continues.
 */

import { collectFullFileSections } from './repo-context.mjs';

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

/**
 * Decide whether the runner can declare `fullFile` for this change set and
 * produce a debug ledger of supplied / skipped files. `available` is derived
 * from the SAME shared computation collectRepoContext uses for injection, so
 * the two never diverge.
 *
 * @param {object} opts
 * @param {string[]} [opts.changedFiles] - repoRoot-relative changed file paths
 *   (already narrowed by upstream diff exclusion; passed through verbatim)
 * @param {string} opts.repoRoot - absolute repository root
 * @param {object} [opts.security] - `config.security` (drives shouldExcludeForContext / redaction)
 * @param {object} [opts.context] - `config.context` (drives char/token budget + ranking)
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ available: boolean, enabled: boolean, totalChars: number,
 *   supplied: Array<{path: string, chars: number, truncated: boolean}>,
 *   skipped: Array<{path: string, reason: string}> }}
 */
export function resolveFullFileSupply({
  changedFiles = [],
  repoRoot,
  security,
  context: contextConfig,
  env = process.env,
} = {}) {
  if (!isFullFileSupplyEnabled(env)) {
    return { available: false, enabled: false, totalChars: 0, supplied: [], skipped: [] };
  }

  const { sections, supplied, skipped } = collectFullFileSections({
    changedFiles,
    repoRoot,
    security,
    context: contextConfig,
  });
  const totalChars = supplied.reduce((sum, s) => sum + s.chars, 0);

  return {
    available: sections.length > 0,
    enabled: true,
    totalChars,
    supplied,
    skipped,
  };
}
