/**
 * Deterministic-exec opt-in predicate (#1401 §11.8 (c2)) — the SINGLE source of
 * truth for the double env-var gate that guards the command executor.
 *
 * Kept in its own module with NO static imports ON PURPOSE. The review pipeline
 * (local-runner / review-plan) imports THIS statically to decide whether to
 * proceed, then `await import()`s the orchestrator only when the gate is on (see
 * runDeterministicExecGateIfEnabled below, which owns that dynamic import).
 * Importing the predicate from the orchestrator module instead would pull in
 * `child_process` (transitively via the executor) at load time and break the
 * "not even imported when opted out" invariant. This module has no static imports.
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

/**
 * Deterministic-exec COMMAND-gate wiring (Epic #1347 §11.8 (c2), #1401) — the
 * SINGLE source of truth for the review-pipeline block that activates the
 * command executor. Both local-runner and review-plan call this; keeping the
 * copy-pasted block here prevents the two from drifting apart (P2 #1434) — the
 * gate guards the RCE path, so an independent drift is a security risk.
 *
 * SECURITY INVARIANTS (why this is double-gated and OFF by default):
 *  - The executor runs ONLY when the host explicitly opts in with BOTH
 *    `RIVER_DETERMINISTIC_EXEC=1` AND a non-empty `RIVER_TRUSTED_TREE` (checked
 *    by isDeterministicExecEnabled). Absent either, this returns
 *    `{ strictBlock: false, deterministicUnrunnable: false }` WITHOUT importing
 *    the orchestrator — so `child_process` (pulled in transitively by the
 *    executor) stays unloaded and behavior is byte-for-byte unchanged. The
 *    dynamic import lives INSIDE this function body precisely so opting out never
 *    even loads the orchestrator module ("not even imported when opted out").
 *  - The allowlist is read ONLY from the host-trusted base tree, never from the
 *    PR head under review (§11.6 trust boundary; enforced by runDeterministicGates).
 *  - Fail-safe (§11.5.2): an infrastructure error while running the gate (temp-dir
 *    creation, staging, spawn setup) means NO verdict was reached — surface that
 *    as `deterministicUnrunnable: true` (rule 5c ESCALATE) rather than crashing
 *    the review or, worse, slipping through as a clean GO. Never GO on an unrun gate.
 *
 * A `fail` verdict folds into `strictBlock` (rule 5b, NO_GO); an `unrunnable`
 * verdict (or any thrown infra error) surfaces as `deterministicUnrunnable`
 * (rule 5c, ESCALATE). Callers OR the returned `strictBlock` into their existing
 * strict_block signal so neither path can be a bypass.
 *
 * @param {object} opts
 * @param {Record<string, string | undefined> | undefined} opts.env process.env-like object
 * @param {Array<object>} [opts.selected] selected skills (metadata.deterministicGate)
 * @param {string} [opts.reviewSourceDir] dir the changed files are copied FROM
 * @param {string[]} [opts.changedFiles] relative paths to stage into the clean cwd
 * @param {() => Promise<{ runDeterministicGates: Function }>} [opts.importOrchestrator]
 *   injected dynamic-import of the orchestrator module (tests only); defaults to
 *   the real `await import('./deterministic-command-orchestrator.mjs')`. Only ever
 *   invoked AFTER the opt-in check passes, preserving the opt-out no-import invariant.
 * @returns {Promise<{ strictBlock: boolean, deterministicUnrunnable: boolean }>}
 */
export async function runDeterministicExecGateIfEnabled({
  env,
  selected,
  reviewSourceDir,
  changedFiles,
  importOrchestrator,
} = {}) {
  if (!isDeterministicExecEnabled(env)) {
    return { strictBlock: false, deterministicUnrunnable: false };
  }
  try {
    const { runDeterministicGates } =
      typeof importOrchestrator === 'function'
        ? await importOrchestrator()
        : await import('./deterministic-command-orchestrator.mjs');
    const gateResult = await runDeterministicGates({
      trustedTree: env.RIVER_TRUSTED_TREE,
      selected: selected ?? [],
      reviewSourceDir,
      changedFiles: changedFiles ?? [],
      processEnv: env,
    });
    return {
      strictBlock: gateResult.strictBlock === true,
      deterministicUnrunnable: gateResult.deterministicUnrunnable === true,
    };
  } catch {
    return { strictBlock: false, deterministicUnrunnable: true };
  }
}
