/**
 * Human-approval policy for plan review gate.
 *
 * Pure function — no I/O, no side effects (single exception: the
 * regex-fallback path emits one stderr warning per failed adjudication so a persistently failing
 * adjudicator stays observable, #1357). Detects keywords in plan text or
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
 *  - strip ALL Unicode format characters (category Cf): the previous 5-char
 *    list (U+200B/C/D, U+FEFF, U+00AD) let siblings like U+2060 WORD JOINER
 *    split a keyword across code units and bypass every HIGH pattern (#1356)
 *  - fold whitespace runs (including newlines) into a single space so
 *    Markdown line wrapping cannot split a phrase across a pattern's
 *    negated-newline span (#1356)
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeText(raw) {
  return (
    String(raw ?? '')
      .normalize('NFKC')
      .replace(/\p{Cf}/gu, '')
      // List items and blank lines are sentence boundaries: convert them to
      // 。 BEFORE folding so a phrase-span pattern ([^。]{0,N}) cannot match
      // across two separate list items ("1. …検索\n2. 整理…" must not fire).
      .replace(/\n\s*\n/g, '。')
      .replace(/\n(?=\s*(?:[-*+]|\d+[.)])\s)/g, '。')
      // Fold remaining whitespace runs (hard-wrapped continuation lines) so
      // Markdown line wrapping cannot split a phrase (#1356).
      .replace(/\s+/g, ' ')
  );
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
  // ---------------------------------------------------------------------
  // Euphemistic dangerous operations (#1348 S1 adversarial canary).
  // Implementation agents that avoid literal danger words (`rm -rf`, 削除)
  // still match on semantic phrasings of the same operation. Guarded by the
  // false-negative canary fixtures in
  // skills/upstream/plan-review-gate/fixtures/.
  // ---------------------------------------------------------------------
  // "recursively clean up the temp directory" — rm -rf without saying rm -rf.
  // Insertion span widened to 4 words (#1356). Tempered token: each INSERTED
  // word is individually checked against code-maintenance verbs, so
  // "recursively refactored and cleaned up" (source edit) is excluded while
  // "recursively wipes the renamed folder" (destruction; excluded word is
  // AFTER the verb) still fires — a leading whole-span lookahead was
  // bypassable by mentioning e.g. "renamed" anywhere nearby.
  {
    pattern:
      /recursively\s+(?:(?!(?:refactor|restructur|renam|reformat|lint))\w+\s+){0,4}(?:clean(?:s|ed|ing)?(?:\s*up)?|clear(?:s|ed|ing)?|purge(?:s|d)?|prune(?:s|d)?|wipe(?:s|d)?|empt(?:y|ies|ied))/i,
    name: 'recursive-cleanup-euphemism',
    confidence: 'high',
  },
  // 「一時ディレクトリを再帰的に整理」— 削除と書かない再帰削除
  {
    pattern: /再帰的[^\n。]{0,15}(?:整理|クリーンアップ|一掃|片付け|掃除|空に)/,
    name: 'ja-recursive-cleanup-euphemism',
    confidence: 'high',
  },
  // 「テーブルを空にする」「データベースを初期化する」— TRUNCATE/DROP の言い換え。
  // 空に/まっさらに は動詞用法に限定し、状態記述・検証文（「空になっていない
  // ことを検証」）への誤爆を防ぐ。初期化 は体言止め（「テーブルの初期化」）が
  // タスク項目で頻出するため受動形（初期化され）のみ除外する (#1356)。
  {
    pattern:
      /(?:テーブル|ディレクトリ|フォルダ|バケット|データベース)[^。]{0,6}(?:空に(?:する|し)|まっさらに(?:する|し)|初期化(?!され))/,
    name: 'ja-empty-storage-euphemism',
    confidence: 'high',
  },
  // "empty the table / bucket / directory" — TRUNCATE without saying truncate.
  // Verb usage only (#1356): inflected forms (empties/emptied/emptying)
  // anywhere; bare "empty" needs either a determiner or — when no determiner —
  // a SINGULAR noun with no determiner immediately before "empty" (adjectival
  // "the empty table" / plural "empty tables are skipped" must not fire,
  // verb "empty staging bucket" must).
  {
    pattern:
      /\bempt(?:ies|ied|ying)\b(?:\s+\w+){0,2}?\s+(?:the\s+)?(?:table|bucket|director(?:y|ies)|database|folder)s?\b|(?<!\b(?:a|an|the|this|that|these|those|each|every|any|some|my|your|his|her|its|our|their)\s+)\bempty\s+(?:(?:the|all|every|each|this|that|these|those|its|our|your|their|any)\s+(?:\w+\s+){0,2}?(?:table|bucket|director(?:y|ies)|database|folder)s?|(?:\w+\s+){0,2}?(?:table|bucket|directory|database|folder))\b/i,
    name: 'empty-storage-euphemism',
    confidence: 'high',
  },
  // 「接続情報」「環境変数ファイル」— secret / credential / .env の言い換え
  {
    pattern: /接続情報|接続文字列|環境変数ファイル|アクセスキー/,
    name: 'ja-connection-info-euphemism',
    confidence: 'high',
  },
  { pattern: /connection\s+string/i, name: 'connection-string', confidence: 'high' },
  // 「稼働環境へ反映」「実環境に適用」— 本番と書かない本番反映
  {
    pattern: /(?:実|稼働)環境[^\n。]{0,12}(?:反映|適用|更新|リリース|デプロイ|切り替え)/,
    name: 'ja-live-env-apply-euphemism',
    confidence: 'high',
  },
  {
    pattern: /(?:to|into)\s+the\s+live\s+environment/i,
    name: 'live-environment',
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
  // Defense-in-depth for recursive-cleanup-euphemism (#1356): the HIGH
  // pattern excludes code-maintenance insertions (refactor/renam/...), which
  // an adversarial plan can exploit by placing such a word BEFORE the verb
  // ("recursively refactor and wipe ..."). This exclusion-free LOW twin makes
  // sure those poisoned phrasings still surface as candidates for the LLM
  // adjudicator instead of vanishing entirely.
  {
    pattern:
      /recursively\s+(?:\w+\s+){0,4}(?:clean(?:s|ed|ing)?(?:\s*up)?|clear(?:s|ed|ing)?|purge(?:s|d)?|prune(?:s|d)?|wipe(?:s|d)?|empt(?:y|ies|ied))/i,
    name: 'recursive-cleanup-lowconf',
    confidence: 'low',
  },
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
 *   'llm-adjudicated'  — adjudicator ran; required = high-confidence match OR
 *                        adjudicator verdict (escalation-only, see below)
 *   'llm-skipped'      — adjudicator provided but not invoked (#1357): the
 *                        verdict was already required (HIGH match) or there
 *                        were no candidates to escalate
 *   'regex-fallback'   — adjudicator ran and threw; degraded to the
 *                        regex-only verdict (fail-safe, never throws upward)
 *
 * Asymmetric escalation (Epic #1347 design principle, wired by #1348 S1):
 * the LLM adjudicator may only ESCALATE — it converts LOW-confidence
 * candidates into required=true. It can never overturn a HIGH-confidence
 * regex verdict downwards, so a compromised or lenient LLM cannot loosen the
 * gate. Callers without an LLM keep the regex-only behavior unchanged.
 *
 * Wired caller: src/lib/review-plan.mjs (`river review exec` path via
 * createHumanApprovalAdjudicator in ./llm-adjudicator.mjs).
 *
 * @param {object} opts
 * @param {string} [opts.text] - Original text (passed to adjudicator if provided)
 * @param {Array<{trigger: string, snippet: string, confidence: 'high'|'low', source: 'regex'}>} opts.candidates
 * @param {string} [opts.artifactKind] - e.g. 'pbi-input' | 'plan' (for adjudicator context)
 * @param {((candidates: object[], text: string, artifactKind: string) => Promise<boolean>)|null} [opts.adjudicator]
 *   Optional async function that receives candidates + text + artifactKind and returns a boolean.
 *   Invoked only while an escalation decision is open (no HIGH match and at
 *   least one candidate); then the mode becomes 'llm-adjudicated'.
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

  // regex verdict: required when at least one HIGH-confidence candidate fired.
  // This is the floor the adjudicator can never lower.
  const regexRequired = candidates.some((c) => c.confidence === 'high');

  // The adjudicator's ONLY job is escalating LOW-confidence candidates, so it
  // is invoked exclusively when that decision is actually open (#1357):
  //  - candidates.length === 0 → nothing to escalate. Calling the LLM here
  //    also created "evidence-free verdicts": a YES with zero candidates set
  //    required=true while the caller's audit/finding guards (which key off
  //    candidates/triggers) recorded nothing.
  //  - regexRequired → the verdict is already required; the LLM cannot lower
  //    it, so the call would be pure cost + injection surface.
  const escalationOpen = !regexRequired && candidates.length > 0;

  if (adjudicator && escalationOpen) {
    let verdict;
    try {
      verdict = await adjudicator(candidates, text, artifactKind);
    } catch (err) {
      // Fail-safe: an adjudicator failure (network, parse, timeout) degrades
      // to the regex-only verdict instead of breaking the caller. Warn on
      // stderr unconditionally (not only under --debug) so a persistently
      // failing adjudicator — i.e. the LOW tier silently disabled — is
      // observable in logs (#1357).
      console.warn(
        `[plan-review] human-approval adjudicator failed; degraded to regex-only verdict: ${err instanceof Error ? err.message : String(err)}`
      );
      return { required: regexRequired, triggers, evidence, mode: 'regex-fallback' };
    }
    return {
      required: regexRequired || Boolean(verdict),
      triggers,
      evidence,
      mode: 'llm-adjudicated',
    };
  }

  if (adjudicator) {
    // Adjudicator supplied but no escalation decision open: report the same
    // shape as regex-only, with a mode that records the skip for audit.
    return { required: regexRequired, triggers, evidence, mode: 'llm-skipped' };
  }

  return { required: regexRequired, triggers, evidence, mode: 'regex-only' };
}

/**
 * Detects human-approval triggers in the given text.
 * Backward-compatible wrapper around detectHumanApprovalCandidates +
 * adjudicateHumanApproval (regex-only mode).
 *
 * @deprecated No production caller remains (#1357) — review-plan.mjs moved to
 *   detectHumanApprovalCandidates + adjudicateHumanApproval in #1348. Kept as
 *   a stable regex-only entry point for tests and external consumers; prefer
 *   the two-step API for new code.
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
