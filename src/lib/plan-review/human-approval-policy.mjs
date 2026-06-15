/**
 * Human-approval policy for plan review gate.
 *
 * Pure function — no I/O, no side effects. Detects keywords in plan text or
 * finding text that require mandatory human approval before execution proceeds.
 *
 * Used by the rr-upstream-plan-review-gate-001 skill and scoreReview() via the
 * humanApprovalRequired flag.
 */

/**
 * Trigger patterns that mandate human approval.
 * Each entry has a regex `pattern` and a stable `name` used in the triggers list.
 *
 * @type {Array<{pattern: RegExp, name: string}>}
 */
const TRIGGER_PATTERNS = [
  { pattern: /destructive\s+command/i, name: 'destructive-command' },
  { pattern: /\bcredential/i, name: 'credential' },
  { pattern: /\bsecret/i, name: 'secret' },
  { pattern: /config\s+overwrite/i, name: 'config-overwrite' },
  { pattern: /external\s+post(ing)?/i, name: 'external-posting' },
  { pattern: /\bdeployment\b/i, name: 'deployment' },
  { pattern: /\bcron\b/i, name: 'cron' },
  { pattern: /memory\s+write/i, name: 'memory-write' },
  { pattern: /billing/i, name: 'billing' },
  { pattern: /provider\s+change/i, name: 'provider-change' },
  { pattern: /\bauth\b/i, name: 'auth' },
  { pattern: /permission\s+change/i, name: 'permission-change' },
  { pattern: /user\s+data/i, name: 'user-data' },
];

/**
 * Detects human-approval triggers in the given text.
 *
 * @param {string} text - Plan text or finding text to scan.
 * @returns {{ required: boolean, triggers: string[] }}
 *   `required` is true when at least one trigger pattern matched.
 *   `triggers` lists the stable names of all matched patterns.
 */
export function detectHumanApprovalTriggers(text) {
  const input = String(text ?? '');
  const triggers = TRIGGER_PATTERNS.filter(({ pattern }) => pattern.test(input)).map(
    ({ name }) => name
  );
  return { required: triggers.length > 0, triggers };
}
