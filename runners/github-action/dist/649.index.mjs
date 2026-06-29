export const id = 649;
export const ids = [649];
export const modules = {

/***/ 1649:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  ReviewPlanError: () => (/* binding */ ReviewPlanError),
  evaluateReviewGate: () => (/* binding */ evaluateReviewGate),
  resolveReviewOutputFormat: () => (/* binding */ resolveReviewOutputFormat),
  runReviewExecReplay: () => (/* binding */ runReviewExecReplay),
  runReviewPlan: () => (/* binding */ runReviewPlan)
});

// UNUSED EXPORTS: REVIEW_GATE_SEVERITIES, computeReplayDrift

// EXTERNAL MODULE: external "node:path"
var external_node_path_ = __webpack_require__(6760);
// EXTERNAL MODULE: external "node:fs/promises"
var promises_ = __webpack_require__(1455);
// EXTERNAL MODULE: ./src/config/loader.mjs + 1 modules
var loader = __webpack_require__(3833);
;// CONCATENATED MODULE: ./src/config/artifact-resolver.mjs
/**
 * Artifact Input resolver — #802 Phase 2b
 *
 * Resolution order (per artifact-input-contract.md):
 *   1. CLI arg     – path passed explicitly by the caller
 *   2. config      – artifacts.<id> in river.config.*
 *   3. cwd default – well-known filename in the working directory
 *
 * Pure module: no singleton state; fs is injectable.
 * Scope: resolve path + existence check only.
 * Content reading / skill injection / CLI parsing → Phase 3.
 */




// CWD default filenames (from artifact-input-contract.md)

/** @type {Readonly<Record<string, string>>} */
const CWD_DEFAULTS = Object.freeze({
  'pbi-input': 'pbi-input.md',
  plan: 'plan.md',
  todo: 'todo.md',
  'test-cases': 'test-cases.md',
  'review-self': 'review-self.md',
  'review-external': 'review-external.md',
  diff: 'diff.patch',
  junit: 'junit.xml',
  coverage: 'coverage.xml',
  lint: 'lint.json',
  typecheck: 'typecheck.txt',
  'findings-pool': 'findings-pool.json',
  'tdd-ledger': 'tdd-ledger.json',
});

/**
 * @typedef {'cli'|'config'|'cwd'} ArtifactSource
 * @typedef {object} ArtifactResolution
 * @property {string}              id
 * @property {string|null}         path
 * @property {ArtifactSource|null} source
 * @property {boolean}             exists
 * @property {boolean}             optional
 */

/**
 * Resolve a single artifact path using the three-tier order.
 *
 * Path base: CLI → cwd; config → configDir ?? cwd; cwd-default → cwd.
 *
 * @param {object} opts
 * @param {string} opts.id
 * @param {string|null} [opts.cliArg]
 * @param {string|{path:string,optional?:boolean}|null} [opts.configValue]
 * @param {string} [opts.configDir]
 * @param {string} [opts.cwd]
 * @param {Pick<import('node:fs/promises'),'access'>} [opts.fsImpl]
 * @returns {Promise<ArtifactResolution>}
 */
async function resolveArtifact({
  id,
  cliArg = null,
  configValue = null,
  configDir,
  cwd = process.cwd(),
  fsImpl = promises_,
}) {
  // Tier 1: CLI arg
  if (cliArg != null && cliArg !== '') {
    const resolved = external_node_path_.resolve(cwd, cliArg);
    const exists = await _fileExists(resolved, fsImpl);
    return { id, path: resolved, source: 'cli', exists, optional: false };
  }

  // Tier 2: config value
  if (configValue != null) {
    const base = configDir ?? cwd;
    const { rawPath, optional } = _normalizeConfigValue(configValue);
    if (rawPath) {
      const resolved = external_node_path_.resolve(base, rawPath);
      const exists = await _fileExists(resolved, fsImpl);
      return { id, path: resolved, source: 'config', exists, optional: optional ?? false };
    }
  }

  // Tier 3: cwd default (only if the file exists)
  const defaultName = CWD_DEFAULTS[id];
  if (defaultName) {
    const resolved = external_node_path_.resolve(cwd, defaultName);
    const exists = await _fileExists(resolved, fsImpl);
    if (exists) {
      return { id, path: resolved, source: 'cwd', exists: true, optional: true };
    }
  }

  // Not found
  return { id, path: null, source: null, exists: false, optional: true };
}

/**
 * Resolve all artifact IDs in parallel.
 *
 * The ID set is the union of the contract's known IDs (CWD_DEFAULTS) plus
 * any IDs explicitly named via cliArgs or configArtifacts. Explicitly
 * named IDs are never silently dropped — this keeps the resolver
 * consistent with the Phase 2a schema, which accepts unknown artifact
 * keys via `.catchall` so the contract can add IDs in a
 * backward-compatible minor bump. cwd-default lookup still only applies
 * to known IDs (CWD_DEFAULTS); an unknown ID resolves only if supplied
 * via CLI/config, otherwise it reports path:null/source:null.
 *
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.cliArgs]
 * @param {Record<string,string|{path:string,optional?:boolean}>} [opts.configArtifacts]
 * @param {string} [opts.configDir]
 * @param {string} [opts.cwd]
 * @param {Pick<import('node:fs/promises'),'access'>} [opts.fsImpl]
 * @returns {Promise<Record<string, ArtifactResolution>>}
 */
async function resolveAllArtifacts({
  cliArgs = {},
  configArtifacts = {},
  configDir,
  cwd,
  fsImpl,
} = {}) {
  const ids = new Set([
    ...Object.keys(CWD_DEFAULTS),
    ...Object.keys(cliArgs),
    ...Object.keys(configArtifacts),
  ]);
  const entries = await Promise.all(
    [...ids].map((id) =>
      resolveArtifact({
        id,
        cliArg: cliArgs[id] ?? null,
        configValue: configArtifacts[id] ?? null,
        configDir,
        cwd,
        fsImpl,
      }).then((r) => [id, r])
    )
  );
  return Object.fromEntries(entries);
}

// Internal helpers

function _normalizeConfigValue(value) {
  if (typeof value === 'string') return { rawPath: value || null, optional: false };
  if (value && typeof value === 'object') {
    return { rawPath: value.path || null, optional: value.optional ?? false };
  }
  return { rawPath: null, optional: false };
}

async function _fileExists(filePath, fsImpl) {
  try {
    await fsImpl.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// EXTERNAL MODULE: ./src/lib/diff.mjs
var diff = __webpack_require__(4382);
// EXTERNAL MODULE: ./runners/core/review-runner.mjs + 6 modules
var review_runner = __webpack_require__(980);
// EXTERNAL MODULE: ./src/lib/review-engine.mjs
var review_engine = __webpack_require__(2022);
// EXTERNAL MODULE: ./src/lib/risk-map.mjs + 1 modules
var risk_map = __webpack_require__(572);
// EXTERNAL MODULE: ./src/lib/planner-utils.mjs
var planner_utils = __webpack_require__(1013);
// EXTERNAL MODULE: ./src/lib/utils.mjs
var utils = __webpack_require__(9746);
// EXTERNAL MODULE: ./src/lib/scoring/engine.mjs
var engine = __webpack_require__(9487);
;// CONCATENATED MODULE: ./src/lib/plan-review/human-approval-policy.mjs
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
function detectHumanApprovalCandidates(text) {
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
async function adjudicateHumanApproval({
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
function detectHumanApprovalTriggers(text) {
  const { candidates } = detectHumanApprovalCandidates(text);
  const required = candidates.some((c) => c.confidence === 'high');
  const triggers = candidates.map((c) => c.trigger);
  return { required, triggers };
}

// EXTERNAL MODULE: ./src/lib/loop-signal.mjs
var loop_signal = __webpack_require__(4702);
;// CONCATENATED MODULE: ./src/lib/review-plan.mjs
/**
 * `river review plan` core — #802 Phase 3 (slices 1 + B-1)
 *
 * Scope: the public `river review plan --plan-only` entrypoint resolves
 * input artifacts (slice 1) and now also computes a deterministic skill
 * selection plan from the resolved `diff` artifact (B-1).
 *
 * Out of scope (later slices, design-gated): actual skill EXECUTION
 * (findings stay []), the LLM-backed planner modes (`--planner
 * order/prune`), `exec`/`verify`, the `--output`/`--format` contract
 * unification, the PLANGATE_REVIEW_CLI_READY flag, and a stable
 * `context.artifacts` field (deferred to a v2 schema per the versioning
 * policy embedded in review-artifact.schema.json).
 *
 * The emitted artifact conforms to schemas/review-artifact.schema.json
 * version "1". Resolved artifact paths are only attached under `debug`
 * (free-form) and only when `debug` is set, consistent with
 * cli-review-plan-spec.md.
 *
 * Skill selection reuses parseUnifiedDiff + buildExecutionPlan (the same
 * path tests/planner-dataset eval uses) with planner:undefined /
 * dryRun:true / llmEnabled:false, so no LLM call is ever made here.
 *
 * Pure-ish module: config loader, resolver, buildExecutionPlan and the
 * diff reader are injectable for tests.
 */
















const VALID_PHASES = new Set(planner_utils/* PHASES */.ZG);

/**
 * Default run-id generator for the Review Artifact `trace.run_id`. Mirrors the
 * format used by the result store (timestamp prefix + short random suffix) so
 * ids sort chronologically. Injectable for deterministic tests.
 */
function defaultGenerateRunId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  // padEnd guarantees a fixed 6-char suffix even when Math.random() yields a
  // short hex fraction (e.g. 0 → '', 0.5 → '8'), keeping run_id length stable.
  const rand = Math.random().toString(16).slice(2, 8).padEnd(6, '0');
  return `${ts}-${rand}`;
}

/**
 * Attach the additive Review Artifact fields introduced for #1045 A1
 * (#1139): top-level `decision` (verdict), `trace.run_id`, and `usage`.
 * All are additive over schema v1; artifacts that predate them stay valid.
 *
 * @param {object} artifact - the artifact being finalized (mutated)
 * @param {object} opts
 * @param {() => string} opts.generateRunId
 * @param {{provider?: string, modelName?: string} | null} [opts.modelConfig]
 * @param {boolean} [opts.llmUsed] - whether an LLM actually ran this review
 * @returns {object} the same artifact
 */
function finalizeArtifact(
  artifact,
  { generateRunId, modelConfig = null, llmUsed = false, humanApprovalRequired = false }
) {
  // decision: derive the top-level verdict from the findings present in the
  // artifact. Never let a scoring error break the artifact contract.
  try {
    artifact.decision = (0,engine/* scoreReview */.lS)(artifact.findings ?? [], { humanApprovalRequired }).verdict;
  } catch {
    // leave decision unset on scoring failure
  }

  // suggestedLoopSignal: additive layer-1 signal for agentic fix loops.
  // Derived after decision is set so the two are always consistent.
  // Never let derivation errors break the artifact contract.
  try {
    artifact.suggestedLoopSignal = (0,loop_signal/* deriveLoopSignalFromArtifact */.K)(artifact);
  } catch {
    // leave suggestedLoopSignal unset on derivation failure
  }

  artifact.trace = { run_id: generateRunId() };

  // usage: only when an LLM actually ran and we know the model. Token / cost
  // numbers are surfaced by callers that have them; provider/model are the
  // deterministic minimum available here.
  if (llmUsed && modelConfig && (modelConfig.provider || modelConfig.modelName)) {
    artifact.usage = {};
    if (modelConfig.provider) artifact.usage.provider = modelConfig.provider;
    if (modelConfig.modelName) artifact.usage.model = modelConfig.modelName;
  }

  return artifact;
}
const VALID_PLANNER_MODES = new Set(planner_utils/* PLANNER_MODES */.Er);
const MODEL_HINTS = new Set(['cheap', 'balanced', 'high-accuracy']);

/** Raised for argument/config errors that map to CLI exit code 3. */
class ReviewPlanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReviewPlanError';
  }
}

/**
 * Compute membership drift between the replay-time changed files and the
 * files implied by the source plan's snapshot (#936). The source plan does
 * NOT snapshot diff bytes (a2-3-replay design), so only membership drift
 * (files added/removed) is detectable — content-level "modified" cannot be
 * derived and is intentionally omitted. Returns null when the source plan
 * predates the snapshot (pre-A2-3) so callers can skip the drift block.
 *
 * @param {string[]} currentFiles changed file paths at replay time
 * @param {object|null} sourceSnapshot the carried-over plan snapshot
 * @returns {{ filesAdded: string[], filesRemoved: string[], summary: string }|null}
 */
function computeReplayDrift(currentFiles, sourceSnapshot) {
  const fileTypes = sourceSnapshot?.fileTypes;
  if (!fileTypes || typeof fileTypes !== 'object') return null;
  const notSentinel = (p) => p && p !== '/dev/null';
  const sourceFiles = [...new Set(Object.values(fileTypes).flat().filter(notSentinel))];
  const cur = [...new Set((currentFiles ?? []).filter(notSentinel))];
  const srcSet = new Set(sourceFiles);
  const curSet = new Set(cur);
  const filesAdded = cur.filter((f) => !srcSet.has(f)).sort();
  const filesRemoved = sourceFiles.filter((f) => !curSet.has(f)).sort();
  const drifted = filesAdded.length > 0 || filesRemoved.length > 0;
  const summary = drifted
    ? `${cur.length} changed file(s) at replay vs ${sourceFiles.length} in source plan (+${filesAdded.length}/-${filesRemoved.length}); content-level changes not detectable (plan does not snapshot diff bytes)`
    : `no membership drift (${cur.length} changed file(s), same set as source plan)`;
  return { filesAdded, filesRemoved, summary };
}

/**
 * Replay a previously emitted plan as a Review Artifact (`--plan <path>`).
 *
 * Contract (#802 Phase 3 — replay foundation):
 *   - Input may be either a full Review Artifact (with `plan` and `phase`)
 *     or the bare plan object (must contain `selectedSkills`).
 *   - The source plan's `phase` is authoritative; the CLI `--phase` value
 *     is intentionally ignored to preserve determinism of the replay.
 *   - Artifact resolution and `buildExecutionPlan` are NOT re-run, so the
 *     selectedSkills/skippedSkills are echoed verbatim (subject to schema
 *     normalization). This locks the spec contract: "external plan wins".
 *   - Skill execution is out of scope here; `findings` stays `[]` and
 *     `status` is derived from the plan's selectedSkills emptiness, the
 *     same as `runReviewPlan`'s no-changes branch.
 *
 * @param {object} opts
 * @param {string} opts.planFile  Path to the plan JSON file.
 * @param {boolean} [opts.debug]  Attach replay debug info under `debug`.
 * @param {() => string} [opts.now]
 * @param {(p: string) => Promise<string>} [opts.readFileImpl]
 * @returns {Promise<object>} Review Artifact (schema version "1")
 */
async function runReviewExecReplay({
  planFile,
  debug = false,
  now = () => new Date().toISOString(),
  readFileImpl = (p) => (0,promises_.readFile)(p, 'utf8'),
  // #878 A2-3-impl: execution params. When executeReview is true and a diff
  // artifact resolves, the replay path invokes generateReview with the source
  // plan's selectedSkills and the carried-over snapshot context (no re-plan).
  executeReview = false,
  cwd = process.cwd(),
  cliArtifacts = {},
  artifactsDir,
  loadConfigImpl = loader/* loadConfig */.Z9,
  resolveAllArtifactsImpl = resolveAllArtifacts,
  generateReviewImpl = review_engine/* generateReview */.G1,
  generateRunId = defaultGenerateRunId,
} = {}) {
  if (!planFile || typeof planFile !== 'string') {
    throw new ReviewPlanError('--plan requires a file path.');
  }

  let raw;
  try {
    raw = await readFileImpl(planFile);
  } catch (err) {
    throw new ReviewPlanError(`Failed to read --plan file "${planFile}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ReviewPlanError(`Failed to parse --plan JSON at "${planFile}": ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ReviewPlanError(`--plan JSON at "${planFile}" must be a JSON object.`);
  }

  // Accept either a full Review Artifact (extract .plan) or a bare plan.
  // A full artifact is identified by `version: "1"` (the schema's required
  // const) plus a `plan` object; falling back to `parsed.plan` alone would
  // accept arbitrary wrappers, so require both.
  const looksLikeFullArtifact =
    parsed.version === '1' &&
    parsed.plan &&
    typeof parsed.plan === 'object' &&
    !Array.isArray(parsed.plan);
  const sourcePlan = looksLikeFullArtifact ? parsed.plan : parsed;
  const phaseFromArtifact =
    looksLikeFullArtifact && typeof parsed.phase === 'string' && VALID_PHASES.has(parsed.phase)
      ? parsed.phase
      : null;

  if (!Array.isArray(sourcePlan.selectedSkills)) {
    throw new ReviewPlanError(
      `--plan JSON at "${planFile}" must have plan.selectedSkills (array). ` +
        'Pass a Review Artifact produced by `river review plan` or its bare `plan` object.'
    );
  }

  const plannerMode =
    typeof sourcePlan.plannerMode === 'string' && VALID_PLANNER_MODES.has(sourcePlan.plannerMode)
      ? sourcePlan.plannerMode
      : 'off';

  const selectedSkills = sourcePlan.selectedSkills.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ReviewPlanError(
        `--plan plan.selectedSkills[${index}] must be an object with an id.`
      );
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new ReviewPlanError(
        `--plan plan.selectedSkills[${index}].id must be a non-empty string.`
      );
    }
    const out = { id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id };
    if (VALID_PHASES.has(entry.phase)) out.phase = entry.phase;
    if (MODEL_HINTS.has(entry.modelHint)) out.modelHint = entry.modelHint;
    return out;
  });

  const skippedRaw = Array.isArray(sourcePlan.skippedSkills) ? sourcePlan.skippedSkills : [];
  const skippedSkills = skippedRaw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ReviewPlanError(
        `--plan plan.skippedSkills[${index}] must be an object with id and reasons.`
      );
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new ReviewPlanError(
        `--plan plan.skippedSkills[${index}].id must be a non-empty string.`
      );
    }
    const reasons = Array.isArray(entry.reasons) ? entry.reasons.map(String) : [];
    return { id: entry.id, reasons };
  });

  const phase = phaseFromArtifact ?? 'midstream';

  // #878 A2-3-impl: read the carry-over snapshot the planner wrote (A2-3-runners
  // #933). Contract: replay does NOT re-derive these — it trusts the values
  // captured at plan-creation time, avoiding context-snapshot drift.
  const sourceSnapshot =
    parsed.debug &&
    typeof parsed.debug === 'object' &&
    parsed.debug.execution &&
    typeof parsed.debug.execution === 'object' &&
    parsed.debug.execution.snapshot &&
    typeof parsed.debug.execution.snapshot === 'object'
      ? parsed.debug.execution.snapshot
      : null;

  const artifact = {
    version: '1',
    timestamp: now(),
    phase,
    status: selectedSkills.length > 0 ? 'ok' : 'no-changes',
    findings: [],
    plan: { plannerMode, selectedSkills, skippedSkills },
  };

  let executionTrace = null;
  let replayDrift = null;
  // Captured from config (when loaded for execution) so finalizeArtifact can
  // surface usage.provider / usage.model when an LLM actually runs.
  let modelConfigForUsage = null;
  if (executeReview && selectedSkills.length > 0) {
    // Resolve the diff from the CURRENT working tree (or --artifact), not from
    // the plan. The plan does not snapshot diff bytes (design decision in
    // docs/development/a2-3-replay-execution-design.md). Without a diff there
    // is nothing to execute against, so we fall back to the echo contract.
    let config = {};
    try {
      config = await loadConfigImpl(cwd);
    } catch (err) {
      throw new ReviewPlanError(`Failed to load config: ${err.message}`);
    }
    modelConfigForUsage = config?.model ?? null;
    const configArtifacts =
      config && typeof config.artifacts === 'object' && config.artifacts ? config.artifacts : {};
    const detectionRoot = artifactsDir ? external_node_path_.resolve(cwd, artifactsDir) : cwd;
    const resolved = await resolveAllArtifactsImpl({
      cliArgs: cliArtifacts,
      configArtifacts,
      cwd: detectionRoot,
    });
    const diffRes = resolved?.diff;
    if (diffRes?.exists && diffRes.path) {
      let diffText;
      try {
        diffText = await readFileImpl(diffRes.path);
      } catch (err) {
        throw new ReviewPlanError(`Failed to read diff artifact: ${err.message}`);
      }
      const parsedDiff = (0,diff/* parseUnifiedDiff */.rj)(diffText);
      // #936: report (non-blocking) membership drift between the replay-time
      // diff and the source plan's snapshot. Null when the snapshot predates A2-3.
      replayDrift = computeReplayDrift(
        // Exclude /dev/null (deletion/creation sentinel) so deleted/created
        // files are not reported as literal drift paths, matching the
        // changed-files extraction used elsewhere.
        (parsedDiff.files ?? []).map((f) => f?.path).filter((p) => p && p !== '/dev/null'),
        sourceSnapshot
      );
      let review;
      try {
        review = await generateReviewImpl({
          diff: { diffText, files: parsedDiff.files ?? [] },
          // Replay uses the source plan's selectedSkills verbatim — NO re-plan.
          plan: { selected: selectedSkills },
          phase,
          dryRun: false,
          config,
          // Carry-over from the source plan's snapshot (#933). When the source
          // predates A2-3-runners, these are undefined and generateReview uses
          // its engine defaults — a graceful, not silent, degradation.
          fileTypes: sourceSnapshot?.fileTypes ?? undefined,
          relatedADRs: sourceSnapshot?.relatedADRs ?? undefined,
          reviewMode: sourceSnapshot?.reviewMode ?? undefined,
          riskAssessment: sourceSnapshot?.riskAssessment ?? undefined,
        });
      } catch (err) {
        throw new ReviewPlanError(`Failed to execute replay review skills: ${err.message}`);
      }
      const rawFindings = Array.isArray(review?.findings) ? review.findings : [];
      artifact.findings = rawFindings.map((f, i) => normalizeFindingForArtifact(f, i, phase));
      executionTrace = {
        skillsExecuted: selectedSkills.length,
        findingsCount: artifact.findings.length,
        llmUsed: review?.debug?.llmUsed === true,
        llmSkipped: review?.debug?.llmSkipped ?? null,
        heuristicsUsed: review?.debug?.heuristicsUsed === true,
        replaySnapshotUsed: sourceSnapshot != null,
      };
    }
  }

  if (debug || executionTrace) {
    artifact.debug = artifact.debug ?? {};
    artifact.debug.replay = {
      source: planFile,
      sourcePhase: phaseFromArtifact,
      sourceTimestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
      ...(replayDrift ? { drift: replayDrift } : {}),
    };
    if (executionTrace) artifact.debug.execution = executionTrace;
  }

  finalizeArtifact(artifact, {
    generateRunId,
    modelConfig: modelConfigForUsage,
    llmUsed: executionTrace?.llmUsed === true,
  });

  return artifact;
}

/**
 * Resolve the effective output format for the `river review` namespace
 * from parsed CLI args (#802 Phase 3 PR-2).
 *
 * Contract (per cli-review-plan-spec / plangate-cli-roadmap): canonical
 * is `--output <format>`; `--format` is a compat alias. The unified
 * format set is text|markdown|json. `json` (default) and `markdown`
 * (#976) are honored; `text` is not yet implemented. When neither flag is
 * given the format falls back to `json` for backward compatibility with
 * the slice-1/B-1/B-2 behavior (and the plangate-review workflow).
 *
 * @param {{output?:string, outputExplicit?:boolean, format?:string|null,
 *   formatExplicit?:boolean}} parsed
 * @returns {'json'|'markdown'}
 * @throws {ReviewPlanError} on an unsupported or conflicting combination
 */
function resolveReviewOutputFormat({
  output = 'text',
  outputExplicit = false,
  format = null,
  formatExplicit = false,
} = {}) {
  if (outputExplicit && formatExplicit && output !== format) {
    throw new ReviewPlanError(
      `--output "${output}" conflicts with --format "${format}". ` +
        'Pass only one, or matching values.'
    );
  }
  let effective;
  if (formatExplicit) effective = format;
  else if (outputExplicit) effective = output;
  else effective = 'json'; // backward-compatible default
  if (effective === 'json') return 'json';
  if (effective === 'markdown') return 'markdown'; // #976: human-readable artifact rendering
  if (effective === 'text') {
    throw new ReviewPlanError(
      `Output format "text" is not implemented yet for river review; use "json" or "markdown".`
    );
  }
  throw new ReviewPlanError(
    `Unsupported output format "${effective}" for river review. Expected: json | markdown (text not yet implemented).`
  );
}

const REVIEW_GATE_SEVERITIES = (/* unused pure expression or super */ null && (['info', 'minor', 'major', 'critical']));
const SEVERITY_RANK = { info: 0, minor: 1, major: 2, critical: 3 };

/**
 * Evaluate the review gate exit code from an artifact's findings (#976).
 *
 * Opt-in: gating is only meaningful when `--fail-on` / `--warn-on` are
 * provided by the caller; the CLI keeps exit 0 otherwise (non-breaking).
 * `--advisory-only` forces exit 0 regardless of findings (report-only).
 *
 * @param {object} artifact Review Artifact (schema "1")
 * @param {{ failOn?: string, warnOn?: string, advisoryOnly?: boolean }} [opts]
 * @returns {{ code: 0|1|2, level: 'pass'|'warn'|'fail', maxSeverity: string|null }}
 */
function evaluateReviewGate(
  artifact,
  { failOn = 'critical', warnOn = 'major', advisoryOnly = false } = {}
) {
  const findings = Array.isArray(artifact?.findings) ? artifact.findings : [];
  let maxRank = -1;
  let maxSeverity = null;
  for (const f of findings) {
    const rank = SEVERITY_RANK[f?.severity];
    if (rank !== undefined && rank > maxRank) {
      maxRank = rank;
      maxSeverity = f.severity;
    }
  }
  if (advisoryOnly || maxRank < 0) {
    return { code: 0, level: 'pass', maxSeverity };
  }
  const failRank = SEVERITY_RANK[failOn] ?? SEVERITY_RANK.critical;
  const warnRank = SEVERITY_RANK[warnOn] ?? SEVERITY_RANK.major;
  if (maxRank >= failRank) return { code: 1, level: 'fail', maxSeverity };
  if (maxRank >= warnRank) return { code: 2, level: 'warn', maxSeverity };
  return { code: 0, level: 'pass', maxSeverity };
}

/** skill objects carry their fields under `.metadata` (or inline). */
function meta(skill) {
  return skill?.metadata ?? skill ?? {};
}

/** Project a selected skill onto the schema's selectedSkills item shape. */
function toSelectedView(skill) {
  const m = meta(skill);
  const view = { id: String(m.id ?? ''), name: String(m.name ?? m.id ?? '') };
  if (VALID_PHASES.has(m.phase)) view.phase = m.phase;
  if (MODEL_HINTS.has(m.modelHint)) view.modelHint = m.modelHint;
  return view;
}

/**
 * Run `river review plan --plan-only` and return a schema-valid Review
 * Artifact (version "1").
 *
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {string} [opts.phase]
 * @param {boolean} [opts.planOnly]
 * @param {Record<string,string>} [opts.cliArtifacts]
 * @param {string} [opts.artifactsDir]
 * @param {boolean} [opts.debug]
 * @param {boolean} [opts.executionDeferred] When true, mark the artifact as
 *   "plan-resolved, execution intentionally not performed yet" by adding
 *   `debug.executionDeferred: true`. Used by `river review exec` (no flags)
 *   until A2 wires the skill execution adapter (#802 Phase 3). Has no
 *   effect on `selectedSkills`/`skippedSkills` — the plan path is identical
 *   to `--dry-run`; this flag is the marker so consumers can distinguish
 *   "deferred" from "really did nothing".
 * @param {boolean} [opts.executeReview] When true (#802 Phase 3 A2-1), the
 *   execution plan is built with `llmEnabled: true` so LLM-backed skills
 *   are selectable, and `generateReview` is invoked to populate the
 *   artifact `findings` array. Mutually exclusive with `executionDeferred`.
 * @param {string[]} [opts.availableContexts] Contexts (artifact IDs) that
 *   should satisfy a skill's `inputContext` requirement during selection.
 *   When omitted, defaults to `['diff']` if a diff artifact is resolved.
 *   Extra contexts from `RIVER_AVAILABLE_CONTEXTS` are always merged in
 *   so CI environments can grant additional artifacts (tests, junit, ...)
 *   without code changes. Without this, `buildExecutionPlan` receives an
 *   empty list and every skill that declares `inputContext: ['diff']` is
 *   silently skipped — the dogfood failure mode that motivated A2-fix-1.
 * @param {string[]} [opts.availableDependencies] Optional dependency IDs
 *   (e.g. `code_search`, `test_runner`). When omitted and the env var
 *   `RIVER_AVAILABLE_DEPENDENCIES` is unset, dependency-based skipping is
 *   disabled (backward-compatible). `RIVER_DEPENDENCY_STUBS=1` opts into
 *   the default stub set so all known dependencies appear available.
 * @param {() => string} [opts.now] - timestamp factory (ISO 8601)
 * @param {(repoRoot: string) => Promise<object>} [opts.loadConfigImpl]
 * @param {Function} [opts.resolveAllArtifactsImpl]
 * @param {Function} [opts.buildExecutionPlanImpl]
 * @param {Function} [opts.generateReviewImpl] Injectable for tests so the
 *   adapter wiring can be verified without calling an external LLM.
 * @param {(repoRoot: string) => Promise<object|null>} [opts.loadRiskMapImpl]
 *   Injectable risk map loader. Returns `null` if no risk map is configured
 *   (the default `.river/risk-map.yaml` path is missing), preserving the
 *   backward-compatible "no risk-based action" behaviour.
 * @param {(p: string) => Promise<string>} [opts.readFileImpl]
 * @returns {Promise<object>} Review Artifact (schema version "1")
 */
async function runReviewPlan({
  cwd = process.cwd(),
  phase = 'midstream',
  planOnly = false,
  cliArtifacts = {},
  artifactsDir,
  debug = false,
  executionDeferred = false,
  executeReview = false,
  skillIds = null,
  availableContexts,
  availableDependencies,
  now = () => new Date().toISOString(),
  loadConfigImpl = loader/* loadConfig */.Z9,
  resolveAllArtifactsImpl = resolveAllArtifacts,
  buildExecutionPlanImpl = review_runner.buildExecutionPlan,
  generateReviewImpl = review_engine/* generateReview */.G1,
  loadRiskMapImpl = risk_map/* loadRiskMap */.E$,
  readFileImpl = (p) => (0,promises_.readFile)(p, 'utf8'),
  generateRunId = defaultGenerateRunId,
} = {}) {
  if (executeReview && executionDeferred) {
    throw new ReviewPlanError(
      'executeReview and executionDeferred are mutually exclusive options.'
    );
  }
  if (!planOnly) {
    throw new ReviewPlanError(
      'river review plan currently supports only --plan-only (Phase 3). ' +
        'Skill execution is not yet wired.'
    );
  }
  if (!VALID_PHASES.has(phase)) {
    throw new ReviewPlanError(
      `Invalid --phase "${phase}". Expected one of: upstream, midstream, downstream.`
    );
  }

  let config;
  try {
    config = await loadConfigImpl(cwd);
  } catch (err) {
    throw new ReviewPlanError(`Failed to load config: ${err.message}`);
  }

  // Risk map is optional (loadRiskMap returns null when .river/risk-map.yaml
  // is missing). A malformed risk map is surfaced as a ReviewPlanError so
  // the exec path fails loudly instead of silently dropping the risk
  // signal — see Codex/Gemini multi-perspective review on the silent-skip
  // cleanup epoch.
  let riskMap = null;
  try {
    riskMap = await loadRiskMapImpl(cwd);
  } catch (err) {
    throw new ReviewPlanError(`Failed to load risk map: ${err.message}`);
  }

  const configArtifacts =
    config && typeof config.artifacts === 'object' && config.artifacts ? config.artifacts : {};

  const detectionRoot = artifactsDir ? external_node_path_.resolve(cwd, artifactsDir) : cwd;

  const resolved = await resolveAllArtifactsImpl({
    cliArgs: cliArtifacts,
    configArtifacts,
    cwd: detectionRoot,
  });

  const artifact = {
    version: '1',
    timestamp: now(),
    phase,
    status: 'ok',
    findings: [],
    plan: { plannerMode: 'off', selectedSkills: [], skippedSkills: [] },
  };

  const diffRes = resolved?.diff;
  let executionTrace = null;
  if (diffRes?.exists && diffRes.path) {
    let diffText;
    try {
      diffText = await readFileImpl(diffRes.path);
    } catch (err) {
      throw new ReviewPlanError(`Failed to read diff artifact: ${err.message}`);
    }
    // Parse the diff once and reuse the result. The same parser used to
    // power deriveChangedFiles (planning input) also exposes the per-file
    // structure generateReview needs (execution input).
    const parsedDiff = (0,diff/* parseUnifiedDiff */.rj)(diffText);
    const changedFiles = (parsedDiff.files ?? [])
      .map((f) => f.path)
      .filter((p) => p && p !== '/dev/null');

    // Declare which artifact contexts are actually available so the plan
    // layer's inputContext check doesn't silently skip skills that need a
    // diff. We are in the diff-resolved branch, so `alwaysInclude: ['diff']`
    // guarantees that a CLI override like `--context tests` does NOT drop
    // 'diff' from the set (would re-introduce the A1 silent-skip failure).
    // env var RIVER_AVAILABLE_CONTEXTS is merged in for CI overrides.
    const effectiveAvailableContexts = (0,utils/* resolveAvailableContexts */.ud)(availableContexts, {
      alwaysInclude: ['diff'],
    });

    // Same silent-skip pattern for dependencies. `null` is the documented
    // disabled sentinel — dependency-based skipping is opt-in via env or
    // `--dependency` so legacy invocations stay backward-compatible.
    const effectiveAvailableDependencies = (0,utils/* resolveAvailableDependencies */.TK)(availableDependencies);

    // The plan layer's selection rules differ by exec mode: for
    // plan-only/dry-run/deferred we restrict to heuristic skills, while
    // executeReview must allow LLM-backed skills so the planner can
    // produce a meaningful selectedSkills set for generateReview.
    let plan;
    try {
      plan = await buildExecutionPlanImpl({
        phase,
        changedFiles,
        diffText,
        plannerMode: 'off',
        planner: undefined,
        dryRun: !executeReview,
        llmEnabled: executeReview,
        repoRoot: cwd,
        riskMap,
        // #976/#1027: honor --skill-set in the review namespace, not just
        // `river run`. null/empty = no restriction (all candidates).
        skillIds,
        availableContexts: effectiveAvailableContexts,
        availableDependencies: effectiveAvailableDependencies,
      });
    } catch (err) {
      throw new ReviewPlanError(`Failed to build execution plan: ${err.message}`);
    }

    artifact.plan.selectedSkills = (plan.selected ?? []).map(toSelectedView);
    artifact.plan.skippedSkills = (plan.skipped ?? []).map((s) => ({
      id: String(meta(s.skill).id ?? ''),
      reasons: Array.isArray(s.reasons) ? s.reasons.map(String) : [],
    }));

    if (executeReview) {
      let review;
      try {
        // Pass the loaded config plus the analysis context that
        // buildExecutionPlan already derived (fileTypes / relatedADRs /
        // reviewMode). generateReview uses fileTypes for the verifier's
        // file-phase coherence check and the others for prompt enrichment
        // — when omitted, the prompt loses ADR cross-references and the
        // reviewMode-driven budget preset, which is a quiet quality loss
        // rather than a hard failure (Codex silent-skip taxonomy).
        review = await generateReviewImpl({
          diff: { diffText, files: parsedDiff.files ?? [] },
          plan: { selected: plan.selected ?? [] },
          phase,
          dryRun: false,
          config,
          fileTypes: plan.fileTypes ?? undefined,
          relatedADRs: plan.relatedADRs ?? undefined,
          reviewMode: plan.reviewMode ?? undefined,
          riskAssessment: plan.riskAssessment ?? undefined,
        });
      } catch (err) {
        throw new ReviewPlanError(`Failed to execute review skills: ${err.message}`);
      }
      const rawFindings = Array.isArray(review?.findings) ? review.findings : [];
      artifact.findings = rawFindings.map((f, i) => normalizeFindingForArtifact(f, i, phase));
      executionTrace = {
        skillsExecuted: artifact.plan.selectedSkills.length,
        findingsCount: artifact.findings.length,
        llmUsed: review?.debug?.llmUsed === true,
        llmSkipped: review?.debug?.llmSkipped ?? null,
        heuristicsUsed: review?.debug?.heuristicsUsed === true,
      };
    }
  } else {
    // No diff artifact resolved and no git fallback in this slice:
    // per cli-review-plan-spec.md this is a no-op review, not an error.
    artifact.status = 'no-changes';
  }

  if (debug || executionDeferred || executionTrace) {
    artifact.debug = artifact.debug ?? {};
    if (debug) artifact.debug.resolvedArtifacts = resolved;
    if (executionDeferred) artifact.debug.executionDeferred = true;
    if (executionTrace) artifact.debug.execution = executionTrace;
  }

  // Human-approval policy check: scan pbi-input and plan text for triggers
  // that require human approval before execution. Each file is scanned
  // separately so that the info finding `file` attribute accurately reflects
  // which document contained the trigger (gemini review #1168).
  // Non-blocking — read errors fall back to empty string so the rest of the
  // artifact is unaffected.
  let humanApprovalRequired = false;
  {
    const pbiPath = resolved?.['pbi-input']?.path;
    const planPath = resolved?.plan?.path;

    /**
     * Read filePath (non-blocking) and run detectHumanApprovalTriggers.
     * If triggers are found, push an info finding attributed to that file
     * and set humanApprovalRequired.
     *
     * @param {string} filePath
     */
    // Stable IDs already emitted across both files, keyed by trigger name, to
    // deduplicate when the same trigger fires in both pbi-input and plan
    // (#1170 F5). Each trigger gets one finding (attributed to the FIRST file
    // that contained it); subsequent occurrences of the same trigger in other
    // files are merged into the existing finding's message rather than emitting
    // a duplicate. This preserves the invariant: one finding per trigger.
    const emittedTriggers = new Map(); // trigger → finding object
    const alsoInAppended = new Set(); // `${trigger}:${filePath}` pairs already appended

    const scanFile = async (filePath) => {
      let text = '';
      try {
        text = await readFileImpl(filePath);
      } catch {
        // non-blocking — missing / unreadable file is not an error
      }
      const approval = detectHumanApprovalTriggers(text);
      if (approval.required) {
        humanApprovalRequired = true;
        artifact.findings = artifact.findings ?? [];

        // Determine new triggers not yet emitted (dedup cross-file)
        const newTriggers = approval.triggers.filter((t) => !emittedTriggers.has(t));
        const dupTriggers = approval.triggers.filter((t) => emittedTriggers.has(t));

        // Merge duplicate triggers into the existing finding's message
        for (const t of dupTriggers) {
          const existing = emittedTriggers.get(t);
          const key = `${t}:${filePath}`;
          if (existing && !existing.file.includes(filePath) && !alsoInAppended.has(key)) {
            existing.message += `; also in ${filePath}`;
            alsoInAppended.add(key);
          }
        }

        if (newTriggers.length > 0) {
          // Derive a stable finding ID from the trigger names and file role
          // so the finding ID is deterministic across runs (#1170 F5).
          const fileRole = filePath === pbiPath ? 'pbi' : 'plan';
          const triggerId = newTriggers[0].replace(/[^a-z0-9-]/g, '-');
          const id = `rr-human-approval-${fileRole}-${triggerId}`;
          const finding = {
            id,
            ruleId: 'rr-plan-review-human-approval',
            severity: 'info',
            title: 'Human approval required',
            message: `Plan contains triggers requiring human approval: ${newTriggers.join(', ')}`,
            file: filePath,
          };
          artifact.findings.push(finding);
          for (const t of newTriggers) {
            emittedTriggers.set(t, finding);
          }
        }
      }
    };

    if (pbiPath) await scanFile(pbiPath);
    if (planPath) await scanFile(planPath);
  }

  finalizeArtifact(artifact, {
    generateRunId,
    modelConfig: config?.model ?? null,
    llmUsed: executionTrace?.llmUsed === true,
    humanApprovalRequired,
  });

  return artifact;
}

/**
 * Convert a generateReview finding to the Review Artifact schema shape
 * (#802 Phase 3 A2-1). The internal pipeline uses `lineStart`/`lineEnd`;
 * the schema requires `line`/`lineEnd`. This is the local adapter — the
 * same bridge exists in `formatJsonOutput` (src/cli.mjs) for the
 * `river run .` legacy path.
 */
function normalizeFindingForArtifact(finding, index, phase) {
  const id =
    typeof finding.id === 'string' && finding.id.length > 0 ? finding.id : `rr-${index + 1}`;
  const ruleId =
    typeof finding.ruleId === 'string' && finding.ruleId.length > 0 ? finding.ruleId : 'unknown';
  const title =
    typeof finding.title === 'string' && finding.title.length > 0
      ? finding.title
      : (finding.message ?? '').slice(0, 80) || ruleId;
  const message = typeof finding.message === 'string' ? finding.message : '';
  const severity = ['info', 'minor', 'major', 'critical'].includes(finding.severity)
    ? finding.severity
    : 'major';
  const out = {
    id,
    ruleId,
    title,
    message,
    severity,
    phase: VALID_PHASES.has(finding.phase) ? finding.phase : phase,
    file: typeof finding.file === 'string' ? finding.file : '<unknown>',
  };
  if (finding.lineStart && Number.isInteger(finding.lineStart) && finding.lineStart >= 1) {
    out.line = finding.lineStart;
  } else if (finding.line && Number.isInteger(finding.line) && finding.line >= 1) {
    out.line = finding.line;
  }
  if (
    finding.lineEnd &&
    Number.isInteger(finding.lineEnd) &&
    finding.lineEnd >= 1 &&
    finding.lineEnd !== (finding.lineStart ?? finding.line)
  ) {
    out.lineEnd = finding.lineEnd;
  }
  if (finding.confidence && ['high', 'medium', 'low'].includes(finding.confidence)) {
    out.confidence = finding.confidence;
  }
  if (finding.status && ['open', 'suppressed', 'verified'].includes(finding.status)) {
    out.status = finding.status;
  }
  if (Array.isArray(finding.evidence) && finding.evidence.length > 0) {
    out.evidence = finding.evidence;
  }
  if (typeof finding.suggestion === 'string' && finding.suggestion.length > 0) {
    out.suggestion = finding.suggestion;
  }
  return out;
}


/***/ })

};

//# sourceMappingURL=649.index.mjs.map