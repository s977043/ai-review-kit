/**
 * Deterministic command executor — execFile launch + exit-code classification
 * (#1401 §11.8 (b), the RCE surface).
 *
 * SINGLE RESPONSIBILITY: receive one already-validated allowlist entry, launch
 * it in a caller-prepared clean cwd with a caller-prepared scrubbed env, and
 * classify the exit code into one of three states (§11.1 / §11.5.1):
 *   - `pass`       exit 0                → gate adds nothing
 *   - `fail`       exit non-zero         → STRICT_BLOCK (NO_GO), carries exitCode
 *   - `unrunnable` spawn error / timeout / invalid entry → DETERMINISTIC_UNRUNNABLE (ESCALATE)
 *
 * HARDENING / RCE surface notes:
 *
 * - **`execFile` is the ONLY execution point.** `node:child_process`'s `execFile`
 *   is imported once and called once. `exec` (shell string), `spawn`, and any
 *   template-string command are deliberately NOT used. `execFile` does not spawn
 *   a shell (equivalent to `{ shell: false }`), so argv elements are passed
 *   verbatim to the executable — `;`, `&&`, `$()`, `|` in an argument are inert
 *   text, never shell metacharacters.
 * - **stdout / stderr are never returned** (§10.3.2 (B)). Judgement reduces to
 *   the exit code only. Captured output is discarded; at most its byte length is
 *   recorded. No captured bytes reach the return value, a finding body, or a PR
 *   comment, so an attacker cannot steer a finding through stdout.
 * - **Entry is re-validated at the launch site** with `validateAllowlistEntry`
 *   (§11.1.2 multi-layer defense). An entry that fails re-validation is NOT
 *   executed and returns `unrunnable` (`invalid-entry`).
 * - **DoS limits** (§3.6): `timeout` (default 60s) with `killSignal: 'SIGKILL'`
 *   and `maxBuffer` (default 1 MiB). Descendant-process containment: `execFile`
 *   offers limited process-group control, so timeout enforcement relies on
 *   `killSignal` killing the direct child. Full process-group kill
 *   (`detached` + negative-PID `kill`) is intentionally NOT implemented here to
 *   avoid over-engineering; the design accepts this as a Linux-first residual
 *   (§3.6 / §6.8). CI runs on `ubuntu-latest`.
 *
 * DEFAULT OFF / INERT: this module ONLY exports functions. It does not read any
 * opt-in flag, does not import or touch the gate (`deriveGateDecision`) or CI
 * (`action.yml`), and nothing runs until a caller explicitly invokes
 * `executeDeterministicCommand`. Importing this module starts no process.
 */

import { execFile } from 'node:child_process';

import { validateAllowlistEntry } from './deterministic-command-allowlist.mjs';

/** reasonCode for a clean pass (exit 0). */
export const DETERMINISTIC_PASS = 'DETERMINISTIC_PASS';

/** reasonCode for a violation: the command ran and exited non-zero (§11.5.1). */
export const STRICT_BLOCK = 'STRICT_BLOCK';

/** reasonCode for "could not run" (spawn error / timeout / invalid entry). */
export const DETERMINISTIC_UNRUNNABLE = 'DETERMINISTIC_UNRUNNABLE';

/** Default DoS limits (§3.6). Host-overridable via the `limits` argument. */
export const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_BUFFER = 1 << 20; // 1 MiB

/**
 * Run `execFile` and resolve with a normalized `{ error, stdout, stderr }`
 * shape (never rejects). Callback → Promise adapter over the ONE execFile call.
 * `stdout`/`stderr` are captured only so the length can be recorded; they are
 * dropped by the caller and never returned to the pipeline.
 *
 * @param {string} command absolute path to the executable
 * @param {string[]} args argv (passed verbatim; no shell)
 * @param {object} options execFile options ({ cwd, env, timeout, maxBuffer, killSignal })
 * @returns {Promise<{ error: (Error & { code?: number | string, signal?: string, killed?: boolean }) | null, stdout: string, stderr: string }>}
 */
function runExecFile(command, args, options) {
  return new Promise((resolve) => {
    // execFile — NO shell. This is the sole process-execution call in the module.
    // execFile can throw SYNCHRONOUSLY on malformed options (bad cwd/env); catch
    // so runExecFile never rejects (gemini #1431). A sync throw is a setup error.
    try {
      execFile(command, args, options, (error, stdout, stderr) => {
        resolve({
          error: error ?? null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
      });
    } catch (syncError) {
      resolve({ error: syncError, stdout: '', stderr: '' });
    }
  });
}

/**
 * Execute one validated deterministic-allowlist entry and classify the result.
 *
 * The caller MUST supply:
 *   - `entry`      — the valid entry from `matchCommand` (absolute-path command,
 *                    argv `args`, `selfContained: true`). Re-validated here.
 *   - `sandboxDir` — the clean cwd prepared by the sandbox layer
 *                    (`makeSandboxTempDir` + `copyReviewTargetToSandbox`).
 *   - `env`        — the scrubbed child env from `buildSandboxEnv` (SAFE_ENV
 *                    allowlist only; no secrets, no NODE_OPTIONS).
 *   - `limits`     — `{ timeoutMs?, maxBuffer? }` (defaults 60000 / 1 MiB).
 *
 * @param {{
 *   entry: { command?: string, args?: string[], selfContained?: boolean, id?: string },
 *   sandboxDir: string,
 *   env: Record<string, string>,
 *   limits?: { timeoutMs?: number, maxBuffer?: number },
 * }} args
 * @returns {Promise<{
 *   status: 'pass' | 'fail' | 'unrunnable',
 *   exitCode?: number,
 *   reasonCode: string,
 *   durationMs: number,
 *   stdoutBytes?: number,
 *   unrunnableCause?: 'spawn-error' | 'timeout' | 'invalid-entry',
 * }>}
 */
export async function executeDeterministicCommand({ entry, sandboxDir, env, limits } = {}) {
  const startedAt = Date.now();
  const durationSince = () => Date.now() - startedAt;

  // Multi-layer defense (§11.1.2): re-validate the entry at the launch site. An
  // entry that fails re-validation is never executed.
  const validation = validateAllowlistEntry(entry);
  if (!validation.valid) {
    return {
      status: 'unrunnable',
      reasonCode: DETERMINISTIC_UNRUNNABLE,
      durationMs: durationSince(),
      unrunnableCause: 'invalid-entry',
    };
  }

  if (typeof sandboxDir !== 'string' || sandboxDir.length === 0) {
    // No clean cwd — do not fall back to process.cwd(); treat as unrunnable.
    return {
      status: 'unrunnable',
      reasonCode: DETERMINISTIC_UNRUNNABLE,
      durationMs: durationSince(),
      unrunnableCause: 'invalid-entry',
    };
  }

  const timeoutMs =
    typeof limits?.timeoutMs === 'number' && limits.timeoutMs > 0
      ? limits.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const maxBuffer =
    typeof limits?.maxBuffer === 'number' && limits.maxBuffer > 0
      ? limits.maxBuffer
      : DEFAULT_MAX_BUFFER;

  const options = {
    cwd: sandboxDir,
    // Scrubbed env ONLY — do not merge process.env (would re-introduce secrets).
    env: env && typeof env === 'object' ? env : {},
    timeout: timeoutMs,
    maxBuffer,
    killSignal: 'SIGKILL',
    windowsHide: true,
  };

  const { error, stdout } = await runExecFile(entry.command, entry.args ?? [], options);
  // Record only the byte length; the captured stdout itself is dropped here.
  const stdoutBytes = Buffer.byteLength(stdout);
  const durationMs = durationSince();

  // (1) No error → clean exit 0 → pass. Gate adds nothing.
  if (error == null) {
    return { status: 'pass', reasonCode: DETERMINISTIC_PASS, durationMs, exitCode: 0, stdoutBytes };
  }

  // (2) Killed by a signal → unrunnable (ESCALATE). `error.killed` is true when
  //     the runtime SIGKILLs the child for exceeding `timeout` (or `maxBuffer`
  //     overflow). An EXTERNAL signal (SIGKILL/SIGTERM/SIGSEGV crash) instead
  //     sets `error.signal` (a string) but NOT `error.killed` (gemini #1431), so
  //     check both. A signal-terminated process produced no clean verdict →
  //     "cannot judge", not a violation. Checked BEFORE the numeric-exit-code
  //     branch because a killed process has no meaningful exit code.
  if (
    error.killed === true ||
    typeof error.signal === 'string' ||
    error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
  ) {
    return {
      status: 'unrunnable',
      reasonCode: DETERMINISTIC_UNRUNNABLE,
      durationMs,
      unrunnableCause: 'timeout',
      stdoutBytes,
    };
  }

  // (3) Process ran and exited non-zero → violation → STRICT_BLOCK (NO_GO).
  //     On a real exit, execFile sets `error.code` to the numeric exit code.
  if (typeof error.code === 'number') {
    return {
      status: 'fail',
      exitCode: error.code,
      reasonCode: STRICT_BLOCK,
      durationMs,
      stdoutBytes,
    };
  }

  // (4) Everything else — spawn failure (ENOENT / EACCES, `error.code` is a
  //     string errno) — → unrunnable (ESCALATE). The command could not start.
  return {
    status: 'unrunnable',
    reasonCode: DETERMINISTIC_UNRUNNABLE,
    durationMs,
    unrunnableCause: 'spawn-error',
    stdoutBytes,
  };
}
