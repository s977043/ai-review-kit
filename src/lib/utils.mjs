/**
 * Parse a comma-separated list string into a trimmed array.
 * Empty/undefined input returns an empty array.
 */
export function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Check if offline (rules-only) mode is enabled via `RIVER_OFFLINE`
 * (set by `--offline` / `--rules-only`; ADR-002 / #1071).
 * @param {NodeJS.ProcessEnv} [env] - injectable for tests (#1357)
 * @returns {boolean}
 */
export function isOfflineMode(env = process.env) {
  const offline = String(env?.RIVER_OFFLINE ?? '')
    .trim()
    .toLowerCase();
  return offline === '1' || offline === 'true' || offline === 'yes' || offline === 'on';
}

/**
 * Check if an LLM (OpenAI / Gemini / Anthropic) API key is configured in the environment.
 *
 * Offline (rules-only) mode: when `RIVER_OFFLINE` is set (via `--offline` /
 * `--rules-only`), AI is force-disabled even if a key is present, so the review
 * runs on deterministic heuristics only (ADR-002 / #1071).
 * @param {NodeJS.ProcessEnv} [env] - injectable for tests (#1357)
 * @returns {boolean}
 */
export function isLlmEnabled(env = process.env) {
  if (isOfflineMode(env)) {
    return false;
  }
  return !!(
    env?.RIVER_OPENAI_API_KEY ||
    env?.OPENAI_API_KEY ||
    env?.GOOGLE_API_KEY ||
    env?.ANTHROPIC_API_KEY ||
    env?.RIVER_ANTHROPIC_API_KEY
  );
}

/**
 * Resolve the effective `availableContexts` for `buildExecutionPlan`'s
 * `inputContext`-based skill selection. Combines caller-supplied contexts
 * with `RIVER_AVAILABLE_CONTEXTS` (deduplicated). If the caller does not
 * supply any contexts, falls back to `defaultContexts` (defaults to
 * `['diff']`). The `alwaysInclude` option forces specific contexts to
 * remain present even when the caller passes a narrower list — useful
 * when the runtime has actually resolved an artifact (e.g. diff) and
 * should not let a CLI override silently strip it.
 *
 * Shared between `src/lib/local-runner.mjs` (legacy `river run`) and
 * `src/lib/review-plan.mjs` (`river review exec` / Phase 3).
 *
 * @param {string[] | null | undefined} inputContexts
 * @param {{ defaultContexts?: string[]; alwaysInclude?: string[] }} [options]
 * @returns {string[]}
 */
export function resolveAvailableContexts(
  inputContexts,
  { defaultContexts = ['diff'], alwaysInclude = [] } = {}
) {
  const envContexts = parseList(process.env.RIVER_AVAILABLE_CONTEXTS);
  const base = inputContexts && inputContexts.length ? inputContexts : defaultContexts;
  return [...new Set([...alwaysInclude, ...base, ...envContexts])];
}

/**
 * Known dependency identifiers that `RIVER_DEPENDENCY_STUBS=1` should
 * mark as "available". Keep in sync with `schemas/skill.schema.json`
 * dependencies enum.
 */
export const dependencyStubs = [
  'code_search',
  'test_runner',
  'coverage_report',
  'adr_lookup',
  'repo_metadata',
  'tracing',
];

/**
 * Resolve the effective `availableDependencies` for `buildExecutionPlan`.
 * Returns `null` (the disabled sentinel) when the caller passes nothing
 * and neither `RIVER_AVAILABLE_DEPENDENCIES` nor `RIVER_DEPENDENCY_STUBS`
 * is set, which preserves backward-compatible "do not skip on missing
 * dependency" behavior.
 *
 * Shared between `src/lib/local-runner.mjs` and `src/lib/review-plan.mjs`
 * (#802 Phase 3 silent-skip follow-up).
 *
 * @param {string[] | null | undefined} inputDependencies
 * @returns {string[] | null}
 */
export function resolveAvailableDependencies(inputDependencies) {
  const envDeps = parseList(process.env.RIVER_AVAILABLE_DEPENDENCIES);
  const stubEnabled =
    typeof process.env.RIVER_DEPENDENCY_STUBS === 'string' &&
    ['1', 'true', 'yes', 'stub'].includes(process.env.RIVER_DEPENDENCY_STUBS.toLowerCase());
  if (inputDependencies?.length) return [...new Set(inputDependencies)];
  if (envDeps.length) return [...new Set(envDeps)];
  if (stubEnabled) return [...dependencyStubs];
  return null; // null disables dependency-based skipping
}
