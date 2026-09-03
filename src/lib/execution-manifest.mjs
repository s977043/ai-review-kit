// Execution Manifest (#2015, Epic #2011 Phase 4).
//
// Pins "what River Review used to judge" for ONE review run into a single
// content-addressed document: the River Review version, the plugin host, the
// flow, the agents, the skills, the input artifacts, the policy, the runtime
// and the effective config. A later reader re-derives the digests with
// `verifyExecutionManifest` to detect a rewrite, and asks
// `assessReplayability` whether the manifest is complete enough to replay at
// all.
//
// Scope boundary (fixed by #2015 "Non-goals" and its "やること" list): this
// module is the MANIFEST CONTRACT and the RESOLVER. It never executes a
// replay, never invokes a reviewer, an LLM or a provider, and never writes a
// file. Everything it returns is a plain object built from its arguments.
//
// Why this is NOT an extension of `buildExperimentManifest`
// (src/lib/paired-replay.mjs:614): that manifest pins an EXPERIMENT — two
// configurations (baseline / candidate), a dataset of already-produced run
// records, acceptance profiles, trial counts. Its required subject is a pair
// of run sets, so every block it owns (`baseline`, `candidate`, `dataset`,
// `acceptance`, `trials`, `verifier`) is meaningless for a single review run,
// and every block #2015 requires (`plugin`, `flow`, `agents`, `skills`,
// `policy`, `config`) is absent from it. Generalizing one document to cover
// both subjects would make roughly a dozen fields conditionally required on a
// `kind` discriminator, which is a weaker contract than two documents that are
// each `additionalProperties: false`. What IS shared is the DERIVATION, and
// that is imported rather than re-typed — see the import block below.
//
// Explicit non-goals (#2015): hidden chain-of-thought, raw tool output, raw
// sensitive context, and byte-for-byte LLM replay. The manifest carries ids,
// versions and hashes only; `assertNoRawContext` below is the mechanical guard
// that keeps it that way.

import {
  // Key-sorted serialization — the SSoT for every content hash in this repo.
  canonicalJson,
  // The ONE trim+NFC normalizer every content-addressed surface shares.
  nonEmptyNfcString as nonEmptyString,
  nfc,
} from './promotion-candidates.mjs';
import {
  // The canonical review_run_id resolver (契約2). A fourth run-id derivation
  // is exactly what this module must not add.
  deriveReviewRunId,
  // The single sha256 helper, exported in the same change (#2015) so this
  // module does not become the third private copy.
  sha256Hex,
} from './shadow-aggregate.mjs';
import { redactText } from './secret-redactor.mjs';

/** Schema version of the manifest document. */
export const EXECUTION_MANIFEST_SCHEMA_VERSION = 1;

/**
 * Prefix of the manifest id. Deliberately distinct from `RR-PC-`
 * (promotion candidate) and `RR-EXP-` (experiment manifest): three
 * content-addressed namespaces already exist, and an id whose namespace is
 * ambiguous cannot be looked up.
 */
export const EXECUTION_MANIFEST_ID_PREFIX = 'RR-EXM-';

const MANIFEST_ID_HASH_LENGTH = 12;

/**
 * Resolution status of one provenance block.
 *
 * The vocabulary is closed because the whole point of #2015 AC 3 is that a
 * missing block must not read as a present one. `unavailable` and `missing`
 * are kept apart on purpose: `unavailable` means this deployment has no such
 * source at all (there is no flow definition to pin), while `missing` means
 * the source exists but this run did not record it.
 */
export const PROVENANCE_STATUS = Object.freeze(['resolved', 'missing', 'unavailable']);

/**
 * Replay classes #2015 distinguishes.
 *
 * `deterministic` covers routing / refs / coverage / hashes / gate derivation
 * — same inputs must give the same result. `judgment` covers agentic output,
 * compared semantically (critical-finding recall, taxonomy, severity,
 * criterion coverage, completion state), never byte-for-byte.
 */
export const REPLAY_CLASSES = Object.freeze(['deterministic', 'judgment']);

/**
 * Blocks each replay class requires.
 *
 * Deterministic replay reproduces routing and hash derivation, so it needs
 * whatever decides the route: the flow, the skills, the input artifacts, the
 * policy and the config. Judgment replay additionally needs the runtime and
 * the agent roster, because the same flow under a different model is a
 * different judgment.
 */
export const REPLAY_REQUIREMENTS = Object.freeze({
  deterministic: Object.freeze(['flow', 'skills', 'artifacts', 'policy', 'config']),
  judgment: Object.freeze(['flow', 'skills', 'artifacts', 'policy', 'config', 'agents', 'runtime']),
});

/** Provenance blocks the manifest carries, in document order. */
export const PROVENANCE_BLOCKS = Object.freeze([
  'riverReview',
  'plugin',
  'flow',
  'agents',
  'skills',
  'artifacts',
  'policy',
  'runtime',
  'config',
]);

export class ExecutionManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExecutionManifestError';
  }
}

// ---------------------------------------------------------------------------
// Redaction (#2015 AC 2)
// ---------------------------------------------------------------------------

/**
 * Keys whose VALUE is a free-form string this module refuses to carry.
 *
 * Structural rejection comes first because redaction is pattern-based and
 * therefore incomplete: `redactText` finds tokens that look like secrets, not
 * a pasted diff or a prompt. The manifest has no field that legitimately holds
 * either, so the safe rule is that these names never appear at all.
 */
const FORBIDDEN_KEYS = Object.freeze([
  'prompt',
  'promptPreview',
  'rawLlmOutput',
  'reasoning',
  'thinking',
  'chainOfThought',
  'toolOutput',
  'stdout',
  'stderr',
  'diff',
  'patch',
  'content',
  'body',
  'text',
  'env',
  'environment',
  'secrets',
  'token',
  'apiKey',
]);

const FORBIDDEN_KEY_SET = new Set(FORBIDDEN_KEYS.map((k) => k.toLowerCase()));

/** Containers whose own keys are data labels, not field names. */
const DATA_KEY_PATHS = new Set(['spec.artifacts']);

/**
 * Reject any key that would turn the manifest into a context dump.
 *
 * This runs on the CALLER-SUPPLIED spec before normalization, so a resolver
 * that starts handing through a raw field fails loudly here instead of writing
 * it into a stored artifact. Depth-first with a path so the error names the
 * offending location rather than the document.
 *
 * `dataKeyPaths` names the containers whose OWN keys are data labels rather
 * than field names. `spec.artifacts` is keyed by artifact name, and `diff` is
 * one of the names #2015 itself lists — banning it there would reject the
 * documented manifest. The VALUES under such a container are still checked,
 * and `normalizeArtifacts` reduces each of them to a sha256 regardless.
 *
 * @param {unknown} value
 * @param {string} [path]
 * @param {{ dataKeyPaths?: Set<string> }} [options]
 */
export function assertNoRawContext(value, path = 'spec', { dataKeyPaths = DATA_KEY_PATHS } = {}) {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoRawContext(item, `${path}[${i}]`, { dataKeyPaths }));
    return;
  }
  const keysAreData = dataKeyPaths.has(path);
  for (const [key, child] of Object.entries(value)) {
    if (!keysAreData && FORBIDDEN_KEY_SET.has(key.toLowerCase())) {
      throw new ExecutionManifestError(
        `${path}.${key} is not allowed in an execution manifest: the manifest records ids, versions and hashes only (#2015 non-goals — no hidden CoT, no raw tool output, no raw sensitive context).`
      );
    }
    assertNoRawContext(child, `${path}.${key}`, { dataKeyPaths });
  }
}

/**
 * Redact every string leaf, counting the hits.
 *
 * Defense in depth behind `assertNoRawContext`: the structural check owns the
 * fields that must not exist, and this owns the values that slipped into a
 * field that may exist (a model name typed as `gpt-4o?key=sk-...`, a profile
 * label carrying a token). Redaction happens BEFORE the digests are computed,
 * so a stored manifest and its recomputed hash agree — redacting afterwards
 * would make every manifest fail `verifyExecutionManifest`.
 *
 * @param {unknown} value
 * @param {{ hits: Map<string, number> }} acc
 * @returns {unknown} the same shape with redacted string leaves
 */
function redactDeep(value, acc) {
  if (typeof value === 'string') {
    const { text, hits } = redactText(value);
    for (const hit of hits)
      acc.hits.set(hit.category, (acc.hits.get(hit.category) ?? 0) + hit.count);
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, acc));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = redactDeep(value[key], acc);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Block normalization
// ---------------------------------------------------------------------------

function compareStrings(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Normalize a sha256 to bare lowercase hex, accepting the `sha256:` prefix
 * `docs/data/skill-manifest.json` stores its checksums with.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeSha256(value) {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  const bare = (raw.startsWith('sha256:') ? raw.slice('sha256:'.length) : raw).toLowerCase();
  return SHA256_PATTERN.test(bare) ? bare : null;
}

/**
 * Wrap a resolved block value with its resolution status (#2015 AC 3).
 *
 * `null` never stands alone in this document. A block that is simply absent
 * and a block that resolved to nothing are indistinguishable once both are
 * `null`, and that ambiguity is precisely how a run gets misread as
 * replayable.
 */
function block(status, value) {
  if (!PROVENANCE_STATUS.includes(status)) {
    throw new ExecutionManifestError(
      `Unknown provenance status "${status}". Expected one of: ${PROVENANCE_STATUS.join(', ')}.`
    );
  }
  return { status, ...value };
}

function statusOf(present, { unavailable = false } = {}) {
  if (present) return 'resolved';
  return unavailable ? 'unavailable' : 'missing';
}

function normalizeRiverReview(spec) {
  const version = nonEmptyString(spec?.riverReview?.version);
  return block(statusOf(version != null), { version: version ?? null });
}

function normalizePlugin(spec) {
  const host = nonEmptyString(spec?.plugin?.host);
  const pluginVersion = nonEmptyString(spec?.plugin?.pluginVersion);
  return block(statusOf(host != null && pluginVersion != null), {
    host: host ?? null,
    pluginVersion: pluginVersion ?? null,
  });
}

function normalizeFlow(spec) {
  const flow = spec?.flow;
  const id = nonEmptyString(flow?.id);
  return block(statusOf(id != null), {
    id: id ?? null,
    version: nonEmptyString(flow?.version) ?? null,
    sha256: normalizeSha256(flow?.sha256),
  });
}

function normalizeAgents(spec) {
  const agents = spec?.agents;
  if (agents == null) return block('missing', { entries: [] });
  if (!Array.isArray(agents)) {
    throw new ExecutionManifestError('agents must be an array or null.');
  }
  const entries = agents
    .map((agent) => ({
      id: nonEmptyString(agent?.id),
      version: nonEmptyString(agent?.version) ?? null,
      sha256: normalizeSha256(agent?.sha256),
    }))
    .filter((agent) => agent.id != null)
    .sort((a, b) => compareStrings(a.id, b.id));
  // An empty roster is `unavailable`, not `resolved`: "no agents ran" and "we
  // failed to record which agents ran" would otherwise both serialize as [].
  return block(statusOf(entries.length > 0, { unavailable: agents.length === 0 }), { entries });
}

function normalizeSkills(spec) {
  const skills = spec?.skills;
  if (skills == null) return block('missing', { entries: [], skillSetHash: null });
  if (!Array.isArray(skills)) {
    throw new ExecutionManifestError('skills must be an array or null.');
  }
  const entries = skills
    .map((skill) => ({
      id: nonEmptyString(skill?.id),
      version: nonEmptyString(skill?.version) ?? null,
      sha256: normalizeSha256(skill?.sha256),
    }))
    .filter((skill) => skill.id != null)
    .sort((a, b) => compareStrings(a.id, b.id));
  // A skill selected but not checksummed is a partial resolution: the id alone
  // cannot detect that the skill's text changed between run and replay.
  const complete = entries.length > 0 && entries.every((s) => s.sha256 != null);
  return block(statusOf(complete, { unavailable: skills.length === 0 }), {
    entries,
    // One digest over the whole selected set, so a consumer can compare two
    // runs' skill selection without walking the array.
    skillSetHash: entries.length ? sha256Hex(canonicalJson(entries)) : null,
  });
}

function normalizeArtifacts(spec) {
  const artifacts = spec?.artifacts;
  if (artifacts == null) return block('missing', { entries: [] });
  if (typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new ExecutionManifestError(
      'artifacts must be an object keyed by artifact name, or null.'
    );
  }
  const entries = Object.keys(artifacts)
    .sort(compareStrings)
    .map((name) => ({
      name: nfc(name),
      sha256: normalizeSha256(artifacts[name]?.sha256 ?? artifacts[name]),
    }));
  const complete = entries.length > 0 && entries.every((a) => a.sha256 != null);
  return block(statusOf(complete, { unavailable: entries.length === 0 }), { entries });
}

function normalizePolicy(spec) {
  const policy = spec?.policy;
  const ref = nonEmptyString(policy?.ref);
  const sha256 = normalizeSha256(policy?.sha256);
  // `riskMapDigest` is a 16-hex TRUNCATION (src/lib/review-plan.mjs:842), not a
  // sha256, so it gets its own field instead of being widened into `sha256` —
  // a consumer comparing digests must not compare two different lengths of the
  // same hash and read the mismatch as tampering.
  const riskMapDigest = nonEmptyString(policy?.riskMapDigest)?.toLowerCase() ?? null;
  return block(statusOf(ref != null && (sha256 != null || riskMapDigest != null)), {
    ref: ref ?? null,
    sha256,
    riskMapDigest,
  });
}

function normalizeRuntime(spec) {
  const runtime = spec?.runtime;
  const provider = nonEmptyString(runtime?.provider);
  const model = nonEmptyString(runtime?.model);
  return block(statusOf(provider != null && model != null), {
    provider: provider ?? null,
    model: model ?? null,
    profile: nonEmptyString(runtime?.profile) ?? null,
  });
}

function normalizeConfig(spec) {
  const sha256 = normalizeSha256(spec?.config?.sha256);
  return block(statusOf(sha256 != null), { sha256 });
}

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

function splitManifest(manifest) {
  const {
    manifestId = null,
    manifestKey = null,
    manifestHash = null,
    createdAt = null,
    ...conditions
  } = manifest ?? {};
  return { manifestId, manifestKey, manifestHash, createdAt, conditions };
}

/**
 * Compute the manifest digests.
 *
 * Same two-level scheme as `computeManifestDigests` in paired-replay.mjs, for
 * the same reason: `manifestKey` hashes the CONDITIONS only, so two runs under
 * an identical execution configuration share a key and are directly
 * comparable, while `manifestHash` additionally covers `createdAt` and the
 * derived ids and is therefore the tamper check over the whole stored record.
 */
function computeManifestDigests({ conditions, createdAt }) {
  const manifestKey = sha256Hex(canonicalJson(conditions));
  const manifestId = `${EXECUTION_MANIFEST_ID_PREFIX}${manifestKey.slice(0, MANIFEST_ID_HASH_LENGTH)}`;
  const manifestHash = sha256Hex(canonicalJson({ conditions, createdAt, manifestKey, manifestId }));
  return { manifestKey, manifestId, manifestHash };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the Execution Manifest for one review run.
 *
 * @param {object} spec see docs/development/2015-execution-manifest.md
 * @param {{ now?: Date }} [options]
 * @returns {object} the manifest document
 */
export function buildExecutionManifest(spec, { now = new Date() } = {}) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new ExecutionManifestError('spec must be an object.');
  }
  assertNoRawContext(spec);

  // Resolved by `resolveExecutionManifestSpec` (which calls `deriveReviewRunId`
  // on the run record) rather than here: passing a whole run record into this
  // function would drag raw finding text through `assertNoRawContext`, and the
  // manifest has no business holding it.
  const reviewRunId = nonEmptyString(spec.reviewRunId) ?? null;

  const conditions = {
    schemaVersion: EXECUTION_MANIFEST_SCHEMA_VERSION,
    kind: 'execution-manifest',
    reviewRunId,
    riverReview: normalizeRiverReview(spec),
    plugin: normalizePlugin(spec),
    flow: normalizeFlow(spec),
    agents: normalizeAgents(spec),
    skills: normalizeSkills(spec),
    artifacts: normalizeArtifacts(spec),
    policy: normalizePolicy(spec),
    runtime: normalizeRuntime(spec),
    config: normalizeConfig(spec),
    // Machine-checkable statement that building a manifest writes nothing.
    writeEffects: [],
  };

  const acc = { hits: new Map() };
  const redacted = redactDeep(conditions, acc);
  redacted.redaction = {
    applied: true,
    hits: [...acc.hits.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => compareStrings(a.category, b.category)),
  };

  const createdAt = now.toISOString();
  const digests = computeManifestDigests({ conditions: redacted, createdAt });
  return {
    manifestId: digests.manifestId,
    manifestKey: digests.manifestKey,
    manifestHash: digests.manifestHash,
    createdAt,
    ...redacted,
  };
}

/**
 * Re-derive a manifest's digests and report whether the stored ones match.
 *
 * The immutability check. A manifest is a plain JSON document, so nothing
 * stops an edit — what the contract guarantees is that the edit is DETECTABLE.
 *
 * @param {object} manifest
 * @returns {{ verified: boolean, mismatches: string[], expected: object, actual: object }}
 */
export function verifyExecutionManifest(manifest) {
  const split = splitManifest(manifest);
  const expected = computeManifestDigests({
    conditions: split.conditions,
    createdAt: split.createdAt,
  });
  const actual = {
    manifestKey: split.manifestKey,
    manifestId: split.manifestId,
    manifestHash: split.manifestHash,
  };
  const mismatches = [];
  for (const field of ['manifestKey', 'manifestId', 'manifestHash']) {
    if (actual[field] !== expected[field]) {
      mismatches.push(
        `${field}: stored ${actual[field] ?? '(none)'}, recomputed ${expected[field]}`
      );
    }
  }
  return { verified: mismatches.length === 0, mismatches, expected, actual };
}

/**
 * Decide what the manifest actually supports replaying (#2015 AC 3).
 *
 * An absent manifest is `not-replayable` with an explicit reason rather than
 * an empty result: the failure mode this AC names is a missing manifest being
 * read as a replayable run, so "no manifest" must be a loud answer.
 *
 * @param {object|null|undefined} manifest
 * @returns {{ deterministic: boolean, judgment: boolean, missingBlocks: Record<string, string[]>, reasons: string[] }}
 */
export function assessReplayability(manifest) {
  if (!manifest || typeof manifest !== 'object' || manifest.kind !== 'execution-manifest') {
    return {
      deterministic: false,
      judgment: false,
      missingBlocks: {
        deterministic: [...REPLAY_REQUIREMENTS.deterministic],
        judgment: [...REPLAY_REQUIREMENTS.judgment],
      },
      reasons: ['No execution manifest is attached, so nothing about this run is replayable.'],
    };
  }
  const unresolved = (names) =>
    names.filter((name) => manifest[name]?.status !== 'resolved').sort(compareStrings);
  const missingBlocks = {
    deterministic: unresolved(REPLAY_REQUIREMENTS.deterministic),
    judgment: unresolved(REPLAY_REQUIREMENTS.judgment),
  };
  const reasons = [];
  for (const cls of REPLAY_CLASSES) {
    for (const name of missingBlocks[cls]) {
      const status = manifest[name]?.status ?? 'missing';
      reasons.push(`${cls} replay needs ${name}, which is ${status}.`);
    }
  }
  return {
    deterministic: missingBlocks.deterministic.length === 0,
    judgment: missingBlocks.judgment.length === 0,
    missingBlocks,
    reasons: [...new Set(reasons)].sort(compareStrings),
  };
}

/**
 * Attach a manifest to a Review Artifact, additively.
 *
 * Returns a NEW artifact object rather than mutating: the artifact is handed
 * around by other pipeline stages, and an in-place write here would be
 * invisible to a caller that kept its own reference. Attaching nothing when
 * the manifest is absent keeps the exact key set older artifacts have, which
 * is what makes this backward compatible (#2015 AC 4).
 *
 * @param {object} artifact
 * @param {object|null|undefined} manifest
 * @returns {object}
 */
export function attachExecutionManifest(artifact, manifest) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new ExecutionManifestError('artifact must be an object.');
  }
  if (manifest == null) return artifact;
  if (manifest.kind !== 'execution-manifest') {
    throw new ExecutionManifestError('manifest must be an execution-manifest document.');
  }
  return { ...artifact, executionManifest: manifest };
}

// ---------------------------------------------------------------------------
// Resolver (#2015 "3. version/hash resolver")
// ---------------------------------------------------------------------------

/**
 * Map the sources this repository actually has onto an Execution Manifest spec.
 *
 * Every argument is injected rather than read from disk, so the resolver stays
 * pure and testable and this module keeps its "no side effects" property. A
 * source the caller cannot supply is passed as `null` and lands as a
 * `missing` / `unavailable` block — never as a fabricated value.
 *
 * Measured source coverage in this repository at the time of writing:
 *   - riverReview.version → package.json `version`
 *   - plugin.pluginVersion → .claude-plugin/plugin.json `version`
 *   - skills[].sha256 → docs/data/skill-manifest.json `skills[].checksum`
 *   - runtime.provider / model → Review Artifact `usage.provider` / `usage.model`
 *   - policy.riskMapDigest → Review Artifact `gate.inputs.riskMapDigest`
 *   - agents → `agents/contracts/*.agent.json` (#2014) carry `id` and
 *     `version`; they carry no checksum, so a caller that wants a `resolved`
 *     agents block hashes the file bytes itself and passes them in
 *   - flow → #2013 landed `schemas/flow.schema.json` but NO flow instance
 *     document exists in this repository (verified: no `flows/` directory and
 *     no `*.flow.json` file), so the block resolves as `missing`
 *   - artifacts / policy.sha256 / config.sha256 → no producer records these
 *     today; they resolve as `missing` until one does
 *
 * @param {object} input
 * @param {object|null} [input.artifact] a Review Artifact
 * @param {object|null} [input.runRecord] a saved run record
 * @param {string|null} [input.riverReviewVersion] package.json version
 * @param {{ host?: string, pluginVersion?: string }|null} [input.plugin]
 * @param {{ skills?: Array<{id: string, checksum?: string, version?: string}> }|null} [input.skillManifest]
 * @param {object|null} [input.flow]
 * @param {Array<object>|null} [input.agents]
 * @param {Record<string, {sha256: string}>|null} [input.artifacts]
 * @param {object|null} [input.policy]
 * @param {string|null} [input.configSha256]
 * @returns {object} a spec for buildExecutionManifest
 */
export function resolveExecutionManifestSpec({
  artifact = null,
  runRecord = null,
  riverReviewVersion = null,
  plugin = null,
  skillManifest = null,
  flow = null,
  agents = null,
  artifacts = null,
  policy = null,
  configSha256 = null,
} = {}) {
  // Checksums are keyed by skill id so the SELECTED skills (which the artifact
  // reports by id only) can be joined to the manifest's hashes. A selected
  // skill absent from the manifest keeps a null sha256 and therefore degrades
  // the block to `missing` — silently dropping it would leave a shorter list
  // that still looked complete.
  const checksumById = new Map();
  for (const entry of skillManifest?.skills ?? []) {
    const id = nonEmptyString(entry?.id);
    if (id) checksumById.set(id, entry);
  }

  const selected = artifact?.plan?.selectedSkills;
  const resolvedSkills = Array.isArray(selected)
    ? selected.map((skill) => {
        const id = nonEmptyString(skill?.id);
        const known = id ? checksumById.get(id) : null;
        return {
          id,
          version: nonEmptyString(skill?.version) ?? nonEmptyString(known?.version) ?? null,
          sha256: normalizeSha256(known?.checksum),
        };
      })
    : null;

  return {
    reviewRunId:
      nonEmptyString(artifact?.trace?.run_id) ?? deriveReviewRunId(runRecord ?? null) ?? null,
    riverReview: { version: riverReviewVersion },
    plugin: {
      host: plugin?.host ?? null,
      pluginVersion: plugin?.pluginVersion ?? null,
    },
    flow,
    agents,
    skills: resolvedSkills,
    artifacts,
    policy: {
      ref: policy?.ref ?? null,
      sha256: policy?.sha256 ?? null,
      riskMapDigest: policy?.riskMapDigest ?? artifact?.gate?.inputs?.riskMapDigest ?? null,
    },
    runtime: {
      provider: artifact?.usage?.provider ?? null,
      model: artifact?.usage?.model ?? null,
      profile: artifact?.plan?.reviewMode ?? null,
    },
    config: { sha256: configSha256 },
  };
}

// ---------------------------------------------------------------------------
// Debug renderer (#2015 "8. debug renderer")
// ---------------------------------------------------------------------------

/**
 * Render a manifest as human-readable Markdown for `--debug` output.
 *
 * The renderer states the replayability verdict FIRST, because the reason this
 * document exists is to stop a reader from assuming a run is replayable.
 *
 * @param {object|null|undefined} manifest
 * @returns {string}
 */
export function formatExecutionManifestMarkdown(manifest) {
  const replay = assessReplayability(manifest);
  const lines = ['## Execution Manifest', ''];
  if (!manifest || manifest.kind !== 'execution-manifest') {
    lines.push('- Manifest: **absent** — this run is NOT replayable.');
    return `${lines.join('\n')}\n`;
  }
  const verification = verifyExecutionManifest(manifest);
  lines.push(`- Manifest id: \`${manifest.manifestId}\``);
  lines.push(`- Manifest key: \`${manifest.manifestKey}\``);
  lines.push(`- Review run id: \`${manifest.reviewRunId ?? '(none)'}\``);
  lines.push(`- Integrity: ${verification.verified ? 'verified' : 'MISMATCH'}`);
  for (const mismatch of verification.mismatches) lines.push(`  - ${mismatch}`);
  lines.push(
    `- Deterministic replay: ${replay.deterministic ? 'possible' : 'NOT possible'}; judgment replay: ${replay.judgment ? 'possible' : 'NOT possible'}`
  );
  for (const reason of replay.reasons) lines.push(`  - ${reason}`);
  lines.push('', '| Block | Status |', '| --- | --- |');
  for (const name of PROVENANCE_BLOCKS) {
    lines.push(`| ${name} | ${manifest[name]?.status ?? 'missing'} |`);
  }
  return `${lines.join('\n')}\n`;
}
