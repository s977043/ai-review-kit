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
  { pattern: /destructive\s+(command|operation|action|step)s?/i, name: 'destructive-command' },
  { pattern: /\bcredentials?\b/i, name: 'credential' },
  { pattern: /\bsecrets?\b/i, name: 'secret' },
  { pattern: /config\s+overwrite/i, name: 'config-overwrite' },
  {
    pattern: /external\s+post(ing)?|\bslack\b|\bwebhook\b|\bemail\b|\bnotification\b/i,
    name: 'external-posting',
  },
  { pattern: /\bdeploy(ment|ing)?s?\b/i, name: 'deployment' },
  { pattern: /\bcron\b/i, name: 'cron' },
  { pattern: /memory\s+write/i, name: 'memory-write' },
  { pattern: /\bbilling\b/i, name: 'billing' },
  {
    pattern: /\bproviders?\s+(change|update|switch)s?\b|\b(change|update|switch)s?\s+providers?\b/i,
    name: 'provider-change',
  },
  { pattern: /\bauth(enticat(e|ion)|oriz(e|ation))?s?\b/i, name: 'auth' },
  {
    pattern:
      /\bpermissions?\s+(change|update|modify|grant|revoke)s?\b|\b(change|update|modify|grant|revoke)s?\s+permissions?\b/i,
    name: 'permission-change',
  },
  { pattern: /\buser\s+data\b/i, name: 'user-data' },
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
