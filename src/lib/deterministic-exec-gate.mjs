/**
 * Deterministic-exec opt-in predicate (#1401 §11.8 (c2)) — the SINGLE source of
 * truth for the double env-var gate that guards the command executor.
 *
 * Kept in its own dependency-free module ON PURPOSE. The review pipeline
 * (local-runner / review-plan) imports THIS statically to decide whether to
 * proceed, then `await import()`s the orchestrator only when this returns true.
 * Importing the predicate from the orchestrator module instead would pull in
 * `child_process` (transitively via the executor) at load time and break the
 * "not even imported when opted out" invariant. This module imports nothing.
 *
 * Both env vars are REQUIRED and checked strictly so no near-miss value
 * (`'true'`, `'0'`, `' 1'`, `''`) can flip the gate on:
 *   - `RIVER_DETERMINISTIC_EXEC` must be exactly the string `'1'`.
 *   - `RIVER_TRUSTED_TREE` must be a non-empty string (the host-trusted base
 *     checkout the allowlist is read from; §11.6 trust boundary).
 *
 * @param {Record<string, string | undefined> | undefined} env process.env-like object
 * @returns {boolean} true only when the host has explicitly opted in with BOTH vars
 */
export function isDeterministicExecEnabled(env) {
  if (env == null) return false;
  return (
    env.RIVER_DETERMINISTIC_EXEC === '1' &&
    typeof env.RIVER_TRUSTED_TREE === 'string' &&
    env.RIVER_TRUSTED_TREE.length > 0
  );
}
