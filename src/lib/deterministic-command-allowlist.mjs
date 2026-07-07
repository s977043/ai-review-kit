/**
 * Deterministic command allowlist — validation layer only (#1401 §10.1).
 *
 * PURE VALIDATION LAYER. This module implements the machine-checkable
 * "self-contained command" gate from the #1401 design (§10.1.2 (A)–(E),
 * §10.1.3 processing order). It parses and validates the host-trusted
 * `.river/deterministic-allowlist.yaml` and matches skill `deterministicGate`
 * definitions against the surviving allowlist entries by exact argv equality.
 *
 * It DOES NOT execute anything. There is deliberately NO import or use of
 * `child_process` / `spawn` / `execFile` / `exec` here — the RCE surface (the
 * actual executor) lands in a separate PR. Reading files is allowed; starting
 * processes is not. Keeping this layer process-free means it has no RCE surface
 * of its own and can be exercised freely by canary tests.
 *
 * reasonCode strings (e.g. DETERMINISTIC_UNRUNNABLE) are returned as human /
 * machine-readable reasons only; wiring them into the gate decision is a
 * separate PR.
 */

import YAML from 'yaml';

/** reasonCode returned for entries/commands that cannot be run (§3.5, §5). */
export const DETERMINISTIC_UNRUNNABLE = 'DETERMINISTIC_UNRUNNABLE';

/**
 * Bare interpreter denylist (§10.1.2 (C)). If the basename of `command`
 * matches one of these, the entry is rejected even when given as an absolute
 * path, because these are designed to run arbitrary code via their arguments
 * and the danger-flag denylist (B) can never be made complete for them.
 */
export const INTERPRETER_DENYLIST = Object.freeze([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'node',
  'nodejs', // Debian/Ubuntu alias for node — same arbitrary-code surface
  'deno',
  'bun',
  'bash',
  'sh',
  'zsh',
  'python',
  'python3',
  'ruby',
  'perl',
  'make',
  'env',
  'xargs',
]);

/**
 * Danger-flag denylist (§10.1.2 (B)). Any arg matching one of these (compared
 * on the token to the LEFT of the first `=` so `--eval=...` is not missed)
 * rejects the entry: these tokens inline-eval code, force-load
 * scripts/modules, delegate to a sub-command/shell, or inject config.
 */
export const DANGER_FLAG_DENYLIST = Object.freeze([
  // inline eval
  '-e',
  '--eval',
  '-c',
  '--command',
  '-p',
  // script / module force-load
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  // indirect subcommand execution
  'run',
  'exec',
  'run-script',
  'dlx',
  '-x',
  // shell delegation
  '-lc',
  '-ic',
  '--rcfile',
  '--init-file',
  // config injection
  '--config',
  '--rc',
]);

/**
 * Return the basename of a POSIX-style absolute path (no fs / path import
 * needed; deliberately simple and platform-neutral for validation).
 * @param {string} p
 * @returns {string}
 */
function basename(p) {
  const s = String(p ?? '');
  const idx = s.lastIndexOf('/');
  return idx === -1 ? s : s.slice(idx + 1);
}

/**
 * True when `command` is an absolute POSIX path (§10.1.2 (A)). Relative paths
 * and bare PATH-lookup names are NOT absolute.
 * @param {string} command
 * @returns {boolean}
 */
function isAbsolutePath(command) {
  return typeof command === 'string' && command.startsWith('/');
}

/**
 * Normalize an arg for danger-flag comparison: take the token left of the
 * first `=` (so `--eval=foo` compares as `--eval`).
 * @param {string} arg
 * @returns {string}
 */
function normalizeFlag(arg) {
  const s = String(arg ?? '');
  const eq = s.indexOf('=');
  return eq === -1 ? s : s.slice(0, eq);
}

/**
 * Parse `.river/deterministic-allowlist.yaml` text into an array of entries.
 *
 * Expected shape:
 *   version: 1
 *   commands:
 *     - id?: string
 *       command: string   # absolute path
 *       args?: string[]
 *       selfContained: boolean
 *
 * Never throws on malformed YAML or shape: returns `{ error }` instead so the
 * caller stays fail-safe (a broken allowlist must not crash the host).
 *
 * @param {string} yamlText
 * @returns {{ version?: unknown, commands: Array<object> } | { error: string }}
 */
export function parseAllowlist(yamlText) {
  let doc;
  try {
    doc = YAML.parse(String(yamlText ?? ''));
  } catch (err) {
    return { error: `invalid YAML: ${err?.message ?? String(err)}` };
  }
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { error: 'allowlist root must be a mapping with a `commands` list' };
  }
  const { version, commands } = doc;
  if (!Array.isArray(commands)) {
    return { error: '`commands` must be a list' };
  }
  // Reject non-object entries early so downstream validators only see objects.
  for (const entry of commands) {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: 'each command entry must be a mapping' };
    }
  }
  return { version, commands };
}

/**
 * Validate a single allowlist entry per §10.1.2 in the §10.1.3 order:
 *   (A) command must be an absolute path
 *   (C) command basename must not be a bare interpreter
 *   (B) no arg may be a danger flag; no arg may start with `@` (gemini #1426)
 *   (A) selfContained must be exactly true (Phase 1)
 *
 * @param {object} entry
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateAllowlistEntry(entry) {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { valid: false, reason: `${DETERMINISTIC_UNRUNNABLE}: entry is not a mapping` };
  }
  const { command, args, selfContained } = entry;

  // (A) absolute path required
  if (typeof command !== 'string' || command.length === 0) {
    return { valid: false, reason: `${DETERMINISTIC_UNRUNNABLE}: command is required` };
  }
  if (!isAbsolutePath(command)) {
    return {
      valid: false,
      reason: `${DETERMINISTIC_UNRUNNABLE}: command must be an absolute path (got "${command}")`,
    };
  }

  // (C) bare interpreter rejection (even for absolute paths)
  const base = basename(command);
  if (INTERPRETER_DENYLIST.includes(base)) {
    return {
      valid: false,
      reason: `${DETERMINISTIC_UNRUNNABLE}: interpreter "${base}" is not allowed (runs arbitrary code via args)`,
    };
  }

  // args must be a string[] when present
  const argv = args === undefined ? [] : args;
  if (!Array.isArray(argv) || !argv.every((a) => typeof a === 'string')) {
    return {
      valid: false,
      reason: `${DETERMINISTIC_UNRUNNABLE}: args must be an array of strings`,
    };
  }

  // (B) danger-flag denylist + `@file` argument-file syntax (gemini #1426)
  for (const arg of argv) {
    if (arg.startsWith('@')) {
      return {
        valid: false,
        reason: `${DETERMINISTIC_UNRUNNABLE}: @-prefixed argument-file syntax is not allowed (denylist bypass)`,
      };
    }
    if (DANGER_FLAG_DENYLIST.includes(normalizeFlag(arg))) {
      return {
        valid: false,
        reason: `${DETERMINISTIC_UNRUNNABLE}: dangerous flag "${arg}" is not allowed`,
      };
    }
  }

  // (A) selfContained must be exactly true in Phase 1
  if (selfContained !== true) {
    return {
      valid: false,
      reason: `${DETERMINISTIC_UNRUNNABLE}: selfContained must be true (Phase 1 executes only self-contained commands)`,
    };
  }

  return { valid: true };
}

/**
 * Parse + validate every entry. Returns the surviving valid entries and the
 * rejected ones with their reasons. On parse failure, returns empty valid set
 * and a single synthetic rejection carrying the parse error.
 *
 * @param {string} yamlText
 * @returns {{ valid: Array<object>, rejected: Array<{ entry: unknown, reason: string }> }}
 */
export function loadValidAllowlist(yamlText) {
  const parsed = parseAllowlist(yamlText);
  if ('error' in parsed) {
    return { valid: [], rejected: [{ entry: null, reason: parsed.error }] };
  }
  const valid = [];
  const rejected = [];
  for (const entry of parsed.commands) {
    const result = validateAllowlistEntry(entry);
    if (result.valid) {
      valid.push(entry);
    } else {
      rejected.push({ entry, reason: result.reason ?? DETERMINISTIC_UNRUNNABLE });
    }
  }
  return { valid, rejected };
}

/**
 * Structural argv equality: same command string AND element-wise identical
 * args (order included). Missing args is treated as an empty array.
 * @param {{ command?: string, args?: Array<string> }} a
 * @param {{ command?: string, args?: Array<string> }} b
 * @returns {boolean}
 */
function argvEqual(a, b) {
  if (a.command !== b.command) return false;
  const aa = Array.isArray(a.args) ? a.args : [];
  const bb = Array.isArray(b.args) ? b.args : [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i += 1) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

/**
 * Match a skill's deterministicGate {command,args} against the surviving valid
 * allowlist entries by EXACT argv equality (§3.2, §10.1.3 step 3). Returns the
 * matching entry or null. No partial / prefix / glob matching.
 *
 * @param {{ command?: string, args?: Array<string> }} gate
 * @param {Array<object>} validEntries - output of loadValidAllowlist().valid
 * @returns {object | null}
 */
export function matchCommand(gate, validEntries) {
  if (gate == null || typeof gate !== 'object') return null;
  const list = Array.isArray(validEntries) ? validEntries : [];
  for (const entry of list) {
    if (argvEqual(gate, entry)) return entry;
  }
  return null;
}
