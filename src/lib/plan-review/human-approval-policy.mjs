/**
 * Human-approval policy for plan review gate.
 *
 * Pure function — no I/O, no side effects. Detects keywords in plan text or
 * finding text that require mandatory human approval before execution proceeds.
 *
 * Used by the plan-review-gate skill and scoreReview() via the
 * humanApprovalRequired flag.
 *
 * ## Two-tier confidence model (Epic #1171 item1 / #1170 F1)
 *
 * HIGH confidence  — regex match alone is sufficient to require approval
 *                    (destructive commands, secret material, Japanese danger words).
 * LOW confidence   — regex fires on a word that is often benign; an LLM
 *                    adjudicator (adjudicateHumanApproval) is needed for the
 *                    final verdict. In regex-only mode these do NOT set required=true.
 *
 * Public surface:
 *   detectHumanApprovalCandidates(text)  → { candidates }
 *   adjudicateHumanApproval({ text, candidates, artifactKind, adjudicator })
 *                                        → { required, triggers, evidence, mode }
 *   detectHumanApprovalTriggers(text)    → { required, triggers }   ← backward compat
 */

/**
 * Normalize input before pattern matching:
 *  - NFKC: unify fullwidth/halfwidth and composed forms
 *  - strip zero-width chars that could split a keyword across code units
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeText(raw) {
  // eslint-disable-next-line no-control-regex
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u200b\u200c\u200d\ufeff\u00ad]/g, '');
}

/**
 * HIGH-confidence candidate patterns.
 * A regex match here is sufficient to require human approval without an LLM.
 *
 * @type {Array<{pattern: RegExp, name: string, confidence: 'high'}>}
 */
const HIGH_CONFIDENCE_PATTERNS = [
  // Destructive shell commands
  { pattern: /rm\s+-rf?/i, name: 'rm-rf', confidence: 'high' },
  { pattern: /drop\s+(table|database)/i, name: 'drop-table-db', confidence: 'high' },
  { pattern: /\btruncate\b/i, name: 'truncate', confidence: 'high' },
  { pattern: /git\s+push\s+--force/i, name: 'git-force-push', confidence: 'high' },
  {
    pattern: /kubectl\s+.*\s+(delete|apply)\s+.*prod/i,
    name: 'kubectl-prod',
    confidence: 'high',
  },
  {
    pattern: /kubectl\s+(apply|delete)\b/i,
    name: 'kubectl-apply-delete',
    confidence: 'high',
  },
  // Production deploy — action verb + prod/production/本番 context
  {
    pattern: /deploy(?:ment|ing)?\s+(?:to\s+)?(?:prod(?:uction)?|本番)/i,
    name: 'deploy-to-prod',
    confidence: 'high',
  },
  {
    pattern: /本番.{0,15}(?:デプロイ|反映|リリース)/,
    name: 'ja-prod-deploy',
    confidence: 'high',
  },
  {
    pattern: /(?:デプロイ|反映|リリース).{0,15}本番/,
    name: 'ja-deploy-to-prod',
    confidence: 'high',
  },
  {
    pattern: /本番リリース/,
    name: 'ja-prod-release',
    confidence: 'high',
  },
  {
    pattern: /release\s+to\s+production/i,
    name: 'release-to-production',
    confidence: 'high',
  },
  {
    pattern: /helm\s+(?:install|upgrade)\b.*prod/i,
    name: 'helm-prod',
    confidence: 'high',
  },
  {
    pattern: /terraform\s+apply\b/i,
    name: 'terraform-apply',
    confidence: 'high',
  },
  // Secret material / credentials
  // AKIA + 16 uppercase alnum = AWS access key ID format
  { pattern: /AKIA[0-9A-Z]{16}/, name: 'aws-key', confidence: 'high' },
  { pattern: /sk-(live|test)-\w+/, name: 'stripe-key', confidence: 'high' },
  { pattern: /\.env\b/i, name: 'dotenv-file', confidence: 'high' },
  {
    pattern: /\b(password|token|api[_-]?key)\b/i,
    name: 'secret-material',
    confidence: 'high',
  },
  // Japanese danger words
  {
    pattern: /削除|本番デプロイ|データベース削除|秘密鍵|認証情報|課金|顧客データ/,
    name: 'ja-danger-word',
    confidence: 'high',
  },
  // Existing high-signal patterns (carried forward from original TRIGGER_PATTERNS)
  {
    pattern: /destructive\s+(command|operation|action|step)s?/i,
    name: 'destructive-command',
    confidence: 'high',
  },
  { pattern: /\bcredentials?\b/i, name: 'credential', confidence: 'high' },
  { pattern: /\bsecrets?\b/i, name: 'secret', confidence: 'high' },
  { pattern: /config\s+overwrite/i, name: 'config-overwrite', confidence: 'high' },
  { pattern: /memory\s+write/i, name: 'memory-write', confidence: 'high' },
  { pattern: /\bbilling\b/i, name: 'billing', confidence: 'high' },
  {
    pattern: /\bproviders?\s+(change|update|switch)s?\b|\b(change|update|switch)s?\s+providers?\b/i,
    name: 'provider-change',
    confidence: 'high',
  },
  {
    pattern:
      /\bpermissions?\s+(change|update|modify|grant|revoke)s?\b|\b(change|update|modify|grant|revoke)s?\s+permissions?\b/i,
    name: 'permission-change',
    confidence: 'high',
  },
  { pattern: /\buser\s+data\b/i, name: 'user-data', confidence: 'high' },
];

/**
 * LOW-confidence candidate patterns.
 * These fire on words that are context-dependent and often benign.
 * In regex-only mode they do NOT set required=true; an LLM adjudicator
 * is needed to convert them to a final verdict.
 *
 * @type {Array<{pattern: RegExp, name: string, confidence: 'low'}>}
 */
const LOW_CONFIDENCE_PATTERNS = [
  // deployment / deploy without prod/force context (could be dev deploy)
  { pattern: /\bdeploy(ment|ing)?s?\b/i, name: 'deployment', confidence: 'low' },
  // auth — loose match catches OAuth, Auth0 etc. (no leading \b so 'auth' substring fires)
  { pattern: /auth/i, name: 'auth', confidence: 'low' },
  // scheduling / external I/O that may or may not be risky
  { pattern: /\bcron\b/i, name: 'cron', confidence: 'low' },
  {
    pattern: /external\s+post(ing)?|\bslack\b|\bwebhook\b|\bemail\b|\bnotification\b/i,
    name: 'external-posting',
    confidence: 'low',
  },
  { pattern: /\bpermissions?\b/i, name: 'permission', confidence: 'low' },
];

/**
 * Detect human-approval candidates in the given text using regex patterns.
 * Returns all matching candidates (high AND low confidence) for audit and
 * adjudication. Does NOT make a final required/not-required decision — call
 * adjudicateHumanApproval for that.
 *
 * @param {string} text - Plan text or finding text to scan.
 * @returns {{ candidates: Array<{trigger: string, snippet: string, confidence: 'high'|'low', source: 'regex'}> }}
 */
export function detectHumanApprovalCandidates(text) {
  const input = normalizeText(text);
  const candidates = [];
  const seen = new Set();

  for (const { pattern, name, confidence } of [
    ...HIGH_CONFIDENCE_PATTERNS,
    ...LOW_CONFIDENCE_PATTERNS,
  ]) {
    if (seen.has(name)) continue; // deduplicate by trigger name
    const match = pattern.exec(input);
    if (match) {
      seen.add(name);
      // Extract a short snippet around the match for audit context
      const start = Math.max(0, match.index - 20);
      const end = Math.min(input.length, match.index + match[0].length + 20);
      const snippet = input.slice(start, end).replace(/\n/g, ' ').trim();
      candidates.push({ trigger: name, snippet, confidence, source: 'regex' });
    }
  }

  return { candidates };
}

/**
 * Adjudicate whether human approval is required given a set of candidates.
 *
 * Modes:
 *   'regex-only'       — no adjudicator provided; required = any high-confidence match
 *   'llm-adjudicated'  — adjudicator provided; required = adjudicator's verdict
 *
 * The LLM adjudicator path is intentionally deferred (not wired to any caller
 * yet). The interface is defined here so callers can opt in without changes to
 * this module. See Epic #1171 item1 / #1170 F1.
 *
 * @param {object} opts
 * @param {string} [opts.text] - Original text (passed to adjudicator if provided)
 * @param {Array<{trigger: string, snippet: string, confidence: 'high'|'low', source: 'regex'}>} opts.candidates
 * @param {string} [opts.artifactKind] - e.g. 'pbi-input' | 'plan' (for adjudicator context)
 * @param {((candidates: object[], text: string, artifactKind: string) => Promise<boolean>)|null} [opts.adjudicator]
 *   Optional async function that receives candidates + text + artifactKind and returns a boolean.
 *   When provided the mode becomes 'llm-adjudicated'.
 * @returns {Promise<{ required: boolean, triggers: string[], evidence: object[], mode: string }>}
 */
export async function adjudicateHumanApproval({
  text = '',
  candidates = [],
  artifactKind = '',
  adjudicator = null,
} = {}) {
  const triggers = candidates.map((c) => c.trigger);
  const evidence = candidates; // full candidate list for audit trail

  if (adjudicator) {
    const required = await adjudicator(candidates, text, artifactKind);
    return { required: Boolean(required), triggers, evidence, mode: 'llm-adjudicated' };
  }

  // regex-only: required only when at least one HIGH-confidence candidate fired
  const required = candidates.some((c) => c.confidence === 'high');
  return { required, triggers, evidence, mode: 'regex-only' };
}

/**
 * Detects human-approval triggers in the given text.
 * Backward-compatible wrapper around detectHumanApprovalCandidates +
 * adjudicateHumanApproval (regex-only mode).
 *
 * @param {string} text - Plan text or finding text to scan.
 * @returns {{ required: boolean, triggers: string[] }}
 *   `required` is true when at least one HIGH-confidence trigger matched.
 *   `triggers` lists the stable names of ALL matched patterns (high + low).
 */
export function detectHumanApprovalTriggers(text) {
  const { candidates } = detectHumanApprovalCandidates(text);
  const required = candidates.some((c) => c.confidence === 'high');
  const triggers = candidates.map((c) => c.trigger);
  return { required, triggers };
}
