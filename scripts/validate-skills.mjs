#!/usr/bin/env node
import path from 'path';
import fs from 'fs/promises';
import * as yaml from 'js-yaml';
import {
  defaultPaths,
  createSkillValidator,
  loadSchema,
  loadSkillFile,
  parseSkillFile,
  listSkillFiles,
  loadPacks,
  loadRecommendationSets,
} from '../runners/core/skill-loader.mjs';
import { isDirectRun } from './lib/is-direct-run.mjs';

// #1231: 既存の eval 未整備 recommended skill。新規追加分はこの集合に足さず
// eval を用意すること（recommended skill は eval/ または fixtures/ を持つこと
// を validateRecommendedEvalCoverage() で前向きに強制する）。
const GRANDFATHERED_WITHOUT_EVAL = new Set([
  'secret-credential-scan',
  'doc-hygiene',
  'review-automation-boundary',
  'design-source-conformance',
  'component-variants-states',
  'test-existence',
  'coverage-gap',
  'pre-mortem',
  'war-game',
  'logic-torturing',
  'self-contradiction',
  'refactor-claim-audit',
  'cross-file-leakage',
  'e2e-wiring',
  'existing-pattern-conformance',
  'migration-safety',
  'adr-decision-quality',
  'api-design',
  'api-versioning-compat',
  'architecture-boundaries',
  'architecture-risk-register',
  'architecture-traceability',
  'availability-architecture',
  'capacity-cost-design',
  'data-flow-state-ownership',
  'data-model-db-design',
  'event-driven-semantics',
  'external-dependencies',
  'failure-modes-observability',
  'integration-contracts',
  'migration-rollout-rollback',
  'openapi-contract',
  'operability-slo',
  'requirements-acceptance',
  'trust-boundaries-authz',
]);

function hasSection(text, patterns) {
  return patterns.some((re) => re.test(text));
}

// Single-alternative brace, e.g. `*.{sql}` — no comma inside the braces.
// Such globs are non-portable across glob parsers and have caused skill-manifest
// freshness mismatches in CI (#1196 S4). Multi-alternative braces (`*.{js,ts}`)
// are legitimate and allowed.
const RE_SINGLE_BRACE = /\{[^,}]*\}/;

/**
 * Return the non-portable single-extension brace globs found in a skill's
 * path patterns (applyTo / files / path_patterns). Empty array = OK.
 * Pure and exported for unit testing.
 *
 * @param {object} metadata - skill frontmatter
 * @returns {string[]}
 */
export function findBadGlobs(metadata) {
  const meta = metadata ?? {};
  // Frontmatter may give a single string instead of an array before schema
  // normalization — accept both so a scalar pattern is not silently skipped.
  const toArray = (val) => (Array.isArray(val) ? val : typeof val === 'string' ? [val] : []);
  const globs = [...toArray(meta.applyTo), ...toArray(meta.files), ...toArray(meta.path_patterns)];
  return globs.filter((g) => typeof g === 'string' && RE_SINGLE_BRACE.test(g));
}

// True when a repoRoot-relative path lives under the new Agent Skills tree
// (skills/agent-skills/, validated separately by npm run agent-skills:validate).
// Segment-wise match so a directory merely containing the substring
// (e.g. my-agent-skills-bridge) is not skipped by accident.
export function isAgentSkillsPath(relativePath) {
  return relativePath.split(path.sep).includes('agent-skills');
}

function warnMissingGuardsAndNonGoals(skill, relativePath) {
  const tags = skill?.metadata?.tags ?? [];
  const excludedTags = ['sample', 'hello', 'policy', 'process'];
  if (Array.isArray(tags) && tags.some((t) => excludedTags.includes(t))) return;
  const body = skill.body ?? '';
  const hasNonGoals = hasSection(body, [/^##\s+Non-goals\b/m, /^##\s+非目的\b/m, /扱わないこと/m]);
  const hasGuards = hasSection(body, [
    /^##\s+False-positive guards\b/m,
    /抑制条件/m,
    /誤検知ガード/m,
  ]);
  if (hasNonGoals && hasGuards) return;
  const missing = [];
  if (!hasNonGoals) missing.push('Non-goals');
  if (!hasGuards) missing.push('False-positive guards');
  console.warn(`⚠️  ${relativePath}: Missing section(s): ${missing.join(', ')}`);
}

async function validateSkills() {
  const schema = await loadSchema(defaultPaths.schemaPath);
  const validator = createSkillValidator(schema);
  let files = [];
  try {
    files = await listSkillFiles(defaultPaths.skillsDir);
  } catch (err) {
    console.error(`❌ Failed to list skills: ${err.message}`);
    throw err;
  }

  if (!files.length) {
    console.warn('⚠️  No skill files found under skills/.');
    return true;
  }

  let success = true;
  for (const filePath of files) {
    const relativePath = path.relative(defaultPaths.repoRoot, filePath);

    // Skip Registry format skill.yaml files
    const basename = path.basename(filePath);
    if (basename === 'skill.yaml' || basename === 'skill.yml') {
      console.log(
        `ℹ️  ${relativePath} (skipped - registry format, use npm run validate:skill-yaml)`
      );
      continue;
    }

    // Skip new Agent Skills format (validated by npm run agent-skills:validate).
    if (isAgentSkillsPath(relativePath)) {
      console.log(`ℹ️  ${relativePath} (skipped - agent skill)`);
      continue;
    }

    try {
      const skill = await loadSkillFile(filePath, { validator });
      const badGlobs = findBadGlobs(skill?.metadata);
      if (badGlobs.length > 0) {
        console.error(`❌ ${relativePath}`);
        console.error(`  - non-portable single-extension brace glob(s): ${badGlobs.join(', ')}`);
        console.error(
          '  - use a plain pattern (e.g. "**/*.sql") or multi-alternative braces ("**/*.{js,ts}")'
        );
        success = false;
        continue;
      }
      console.log(`✅ ${relativePath}`);
      warnMissingGuardsAndNonGoals(skill, relativePath);
    } catch (err) {
      console.error(`❌ ${relativePath}`);
      if (err.details && Array.isArray(err.details)) {
        for (const detail of err.details) {
          const instance = detail.instancePath || '/';
          console.error(`  - ${instance}: ${detail.message}`);
        }
      } else {
        console.error(`  - ${err.message}`);
      }
      success = false;
    }
  }

  return success;
}

/**
 * Validate the `packs:` section of skills/registry.yaml against
 * schemas/pack.schema.json plus referential rules from
 * docs/development/skill-pack-design.md:
 * - every referenced skill id must exist as a loadable skill file
 * - a pack id colliding with a recommendation-set name is a warning
 *   (becomes an error in Phase D)
 * - `tier: official` requires each member skill directory to carry
 *   fixtures/ or eval/ assets (the mechanical part of the quality gate)
 */
export async function validatePacks({
  skillsDir = defaultPaths.skillsDir,
  repoRoot = defaultPaths.repoRoot,
} = {}) {
  const packs = await loadPacks({ skillsDir });
  if (!packs.length) return true;

  const packSchemaPath = path.join(repoRoot, 'schemas', 'pack.schema.json');
  const packSchema = await loadSchema(packSchemaPath);
  const validate = createSkillValidator(packSchema);
  let success = true;

  if (!validate(packs)) {
    success = false;
    console.error('❌ packs: schema validation failed');
    for (const detail of validate.errors ?? []) {
      console.error(`  - ${detail.instancePath || '/'}: ${detail.message}`);
    }
  }

  const knownIds = new Map();
  const schema = await loadSchema(defaultPaths.schemaPath);
  const skillValidator = createSkillValidator(schema);
  for (const filePath of await listSkillFiles(skillsDir)) {
    const basename = path.basename(filePath);
    if (basename === 'skill.yaml' || basename === 'skill.yml') continue;
    if (isAgentSkillsPath(path.relative(repoRoot, filePath))) continue;
    try {
      const skill = await loadSkillFile(filePath, { validator: skillValidator });
      if (skill?.metadata?.id) knownIds.set(skill.metadata.id, filePath);
    } catch {
      // skill file errors are reported by validateSkills(); skip here
    }
  }

  const recommendations = await loadRecommendationSets({ skillsDir });
  for (const pack of packs) {
    if (recommendations[pack.id]) {
      console.warn(
        `⚠️  pack "${pack.id}" collides with a recommendation set of the same name; ` +
          'the pack wins at resolution time. Remove the recommendation entry by Phase D.'
      );
    }
    for (const id of pack.skills ?? []) {
      if (!knownIds.has(id)) {
        console.error(`❌ pack "${pack.id}": unknown skill id "${id}"`);
        success = false;
      }
    }
    if (pack.tier === 'official') {
      for (const id of pack.skills ?? []) {
        const skillFile = knownIds.get(id);
        if (!skillFile) continue;
        const skillDir = path.dirname(skillFile);
        const entries = await fs.readdir(skillDir).catch(() => []);
        const hasAssets = entries.some((e) => e === 'fixtures' || e === 'eval');
        if (!hasAssets) {
          console.error(
            `❌ pack "${pack.id}" is tier: official but skill "${id}" has no fixtures/ or eval/ assets`
          );
          success = false;
        }
      }
    }
  }

  if (success) console.log(`✅ packs: ${packs.length} pack(s) valid`);
  return success;
}

/**
 * Read and parse skills/registry.yaml once. Returns `{ ok: true, parsed }` on
 * success (`parsed` is `{}` for an empty file), or `{ ok: false, phase, message }`
 * where `phase` is 'read' or 'parse'. Callers keep their own error wording so the
 * existing console messages stay byte-identical.
 *
 * @param {string} registryPath absolute/relative path to registry.yaml
 * @returns {Promise<{ ok: true, parsed: unknown } | { ok: false, phase: 'read' | 'parse', message: string }>}
 */
async function loadSkillRegistry(registryPath) {
  let raw;
  try {
    raw = await fs.readFile(registryPath, 'utf8');
  } catch (err) {
    return { ok: false, phase: 'read', message: err.message };
  }
  try {
    return { ok: true, parsed: yaml.load(raw) ?? {} };
  } catch (err) {
    return { ok: false, phase: 'parse', message: err.message };
  }
}

/**
 * Forward-gate: every `recommended: true` skill in skills/registry.yaml must
 * carry quality evidence — an `eval/` or `fixtures/` directory alongside its
 * SKILL.md (#1231). Skills already shipped without such assets are exempted via
 * {@link GRANDFATHERED_WITHOUT_EVAL}; new recommended skills must supply assets
 * rather than be added to that set.
 *
 * @param {{ skillsDir?: string, repoRoot?: string }} [options]
 * @returns {Promise<boolean>} false (→ exitCode 1) if any non-grandfathered
 *   recommended skill lacks eval/ and fixtures/.
 */
export async function validateRecommendedEvalCoverage({
  skillsDir = defaultPaths.skillsDir,
  repoRoot = defaultPaths.repoRoot,
} = {}) {
  const registryPath = path.join(skillsDir, 'registry.yaml');
  const registry = await loadSkillRegistry(registryPath);
  if (!registry.ok) {
    console.error(
      `❌ Failed to ${registry.phase} skill registry at ${registryPath}: ${registry.message}`
    );
    return false;
  }
  const parsed = registry.parsed;

  const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
  const recommended = skills.filter((s) => s && s.recommended === true);
  let success = true;
  let okCount = 0;
  let grandfatheredCount = 0;

  for (const skill of recommended) {
    const { id, path: skillPath } = skill;
    // Malformed entry (missing id or non-string path) must not silently bypass the
    // gate — treat it as a failure so typos in registry.yaml are caught.
    if (!id || typeof skillPath !== 'string') {
      console.error(
        `❌ recommended skill entry is malformed (missing id or non-string path): ${JSON.stringify(skill)}`
      );
      success = false;
      continue;
    }

    const skillDir = path.dirname(path.resolve(repoRoot, skillPath));
    const entries = await fs.readdir(skillDir).catch(() => []);
    const hasAssets = entries.some((e) => e === 'eval' || e === 'fixtures');
    if (hasAssets) {
      okCount += 1;
      continue;
    }
    if (GRANDFATHERED_WITHOUT_EVAL.has(id)) {
      okCount += 1;
      grandfatheredCount += 1;
      continue;
    }
    console.error(
      `❌ recommended skill "${id}" has no eval/ or fixtures/ directory; ` +
        'add quality evidence (see #1231) or, only for already-shipped skills, ' +
        'GRANDFATHERED_WITHOUT_EVAL in scripts/validate-skills.mjs'
    );
    success = false;
  }

  if (success) {
    console.log(
      `✅ recommended eval coverage: ${okCount}/${recommended.length} recommended skill(s) ` +
        `satisfied (incl. ${grandfatheredCount} grandfathered)`
    );
  }
  return success;
}

/**
 * Registry/filesystem drift gate: every `skills[].path` in skills/registry.yaml
 * must point to an existing file, so renames (e.g. #1320) cannot leave dangling
 * catalog entries behind. The reverse direction — a SKILL.md on disk that is
 * not listed in the registry — is reported as a warning only, because some
 * directories (skills/agent-skills/, validated by npm run agent-skills:validate)
 * are intentionally kept out of the catalog.
 *
 * @param {{ skillsDir?: string, repoRoot?: string }} [options]
 * @returns {Promise<boolean>} false (→ exitCode 1) if any registry path is
 *   missing or a registry entry is malformed.
 */
export async function validateRegistryPaths({
  skillsDir = defaultPaths.skillsDir,
  repoRoot = defaultPaths.repoRoot,
} = {}) {
  const registryPath = path.join(skillsDir, 'registry.yaml');
  const registry = await loadSkillRegistry(registryPath);
  if (!registry.ok) {
    console.error(
      `❌ Failed to ${registry.phase} skill registry at ${registryPath}: ${registry.message}`
    );
    return false;
  }
  const parsed = registry.parsed;

  const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
  let success = true;
  const registeredPaths = new Set();

  for (const skill of skills) {
    const { id, path: skillPath } = skill ?? {};
    if (!id || typeof skillPath !== 'string') {
      console.error(
        `❌ registry entry is malformed (missing id or non-string path): ${JSON.stringify(skill)}`
      );
      success = false;
      continue;
    }
    const resolved = path.resolve(repoRoot, skillPath);
    registeredPaths.add(resolved);
    try {
      await fs.access(resolved);
    } catch {
      console.error(`❌ registry skill "${id}": path does not exist: ${skillPath}`);
      success = false;
    }
  }

  // Reverse direction (warning only): SKILL.md files present on disk but
  // missing from the catalog. agent-skills/ is intentionally uncataloged.
  let skillFiles = [];
  try {
    skillFiles = await listSkillFiles(skillsDir);
  } catch (err) {
    console.error(`❌ Failed to list skills: ${err.message}`);
    return false;
  }
  for (const filePath of skillFiles) {
    if (path.basename(filePath) !== 'SKILL.md') continue;
    const relativePath = path.relative(repoRoot, filePath);
    if (isAgentSkillsPath(relativePath)) continue;
    // Resolve against repoRoot (not process.cwd()) so the comparison with
    // registeredPaths (repoRoot-based) holds regardless of the caller's cwd.
    if (!registeredPaths.has(path.resolve(repoRoot, relativePath))) {
      console.warn(
        `⚠️  ${relativePath}: SKILL.md exists but is not listed in skills/registry.yaml`
      );
    }
  }

  if (success) {
    console.log(`✅ registry paths: ${skills.length} entry path(s) resolve to existing files`);
  }
  return success;
}

/**
 * Registry/frontmatter id drift gate: every `skills[].id` in
 * skills/registry.yaml must equal the `id` declared in the frontmatter of the
 * SKILL.md its `path` points to. The runtime (runners/core/skill-loader.mjs /
 * src/lib/selection.mjs) keys skills by the frontmatter id, so a diverging
 * registry id silently fails to resolve (e.g. the former `test-code-*` ids
 * made examples/selection/tdd.yaml's include list a no-op).
 *
 * Entries whose path does not exist or whose SKILL.md fails to parse are
 * skipped here — validateRegistryPaths() and validateSkills() already report
 * those failures.
 *
 * @param {{ skillsDir?: string, repoRoot?: string }} [options]
 * @returns {Promise<boolean>} false (→ exitCode 1) if any registry id differs
 *   from its SKILL.md frontmatter id.
 */
export async function validateRegistryIdMatch({
  skillsDir = defaultPaths.skillsDir,
  repoRoot = defaultPaths.repoRoot,
} = {}) {
  const registryPath = path.join(skillsDir, 'registry.yaml');
  const registry = await loadSkillRegistry(registryPath);
  if (!registry.ok) {
    console.error(
      `❌ Failed to ${registry.phase} skill registry at ${registryPath}: ${registry.message}`
    );
    return false;
  }
  const parsed = registry.parsed;

  const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
  let success = true;
  let checkedCount = 0;

  for (const skill of skills) {
    const { id, path: skillPath } = skill ?? {};
    // Malformed entries are reported by validateRegistryPaths(); skip here.
    if (!id || typeof skillPath !== 'string') continue;
    const resolved = path.resolve(repoRoot, skillPath);
    let parsedSkill;
    try {
      parsedSkill = await parseSkillFile(resolved);
    } catch {
      // Missing/unparseable files are reported by validateRegistryPaths() /
      // validateSkills(); skip here.
      continue;
    }
    checkedCount += 1;
    const frontmatterId = parsedSkill?.metadata?.id;
    if (frontmatterId !== id) {
      console.error(
        `❌ registry skill "${id}": id does not match SKILL.md frontmatter id ` +
          `"${frontmatterId}" (path: ${skillPath}) — the runtime resolves skills by the ` +
          'frontmatter id, so align the registry entry with it'
      );
      success = false;
    }
  }

  if (success) {
    console.log(`✅ registry ids: ${checkedCount} entry id(s) match their SKILL.md frontmatter id`);
  }
  return success;
}

// ---------------------------------------------------------------------------
// Fixture / description drift validation (CLAUDE.md guard
// "Skill-check fixture/description drift", mechanized)
// ---------------------------------------------------------------------------

/** Matches `<!-- expected: ... -->` blocks embedded in fixture files. */
const RE_EXPECTED_BLOCK = /<!--\s*expected:\s*\n?([\s\S]*?)-->/g;

/** Matches `## Check N — Title / 日本語` style headings in a SKILL.md body. */
const RE_CHECK_HEADING = /^#{2,4}\s+Check\s+(\d+)\b[\s]*(?:[—–-]\s*(.*))?$/gm;

/** Words too generic to serve as evidence that a description covers a Check. */
const DESCRIPTION_STOPWORDS = new Set([
  'check',
  'checks',
  'with',
  'without',
  'that',
  'this',
  'when',
  'then',
  'from',
  'into',
  'only',
  'must',
  'should',
  'before',
  'after',
  'work',
]);

/**
 * Extract the numbered Check headings from a SKILL.md body.
 * Pure and exported for unit testing.
 *
 * @param {string} body - SKILL.md markdown body (without frontmatter)
 * @returns {Array<{ id: number, title: string|null }>} title is the English
 *   part of the heading (text after the dash, before an optional ` / ` that
 *   separates the Japanese title), or null when absent.
 */
export function extractCheckHeadings(body) {
  const headings = [];
  for (const match of (body ?? '').matchAll(RE_CHECK_HEADING)) {
    const id = Number(match[1]);
    let title = match[2]?.trim() ?? '';
    if (title.includes('/')) title = title.split('/')[0].trim();
    headings.push({ id, title: title || null });
  }
  return headings;
}

/**
 * Extract the raw YAML payloads of every `<!-- expected: -->` block in a
 * fixture file. Pure and exported for unit testing.
 *
 * @param {string} text - fixture file content
 * @returns {string[]}
 */
export function extractExpectedBlocks(text) {
  return [...(text ?? '').matchAll(RE_EXPECTED_BLOCK)].map((m) => m[1]);
}

/**
 * Deterministic proxy for "the frontmatter description enumerates this
 * Check": at least one significant word (>= 4 latin letters, not a stopword)
 * of the Check's English title must appear as a case-insensitive substring of
 * the description. Substring matching keeps morphological variants covered
 * (e.g. title "knowledge access" ↔ description "accessible context").
 * Returns true (skip) when the title yields no usable tokens (e.g. a
 * Japanese-only title), because no deterministic judgment is possible.
 *
 * @param {string} description - skill frontmatter description
 * @param {string|null} title - English Check title
 * @returns {boolean}
 */
export function descriptionCoversCheck(description, title) {
  if (!title) return true;
  const tokens = (title.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
    (t) => !DESCRIPTION_STOPWORDS.has(t)
  );
  if (!tokens.length) return true;
  const haystack = String(description ?? '').toLowerCase();
  return tokens.some((t) => haystack.includes(t));
}

/**
 * Drift gate between a skill's Check sections, its fixtures' embedded
 * `<!-- expected: -->` blocks, and its frontmatter description (mechanizes the
 * CLAUDE.md guard "Skill-check fixture/description drift"). All rules are
 * deterministic and opt-in by structure — skills without expected blocks or
 * without `Check N` headings are untouched:
 *
 * - every expected block must parse as YAML (error otherwise);
 * - every `findings[].check` number referenced by a fixture must exist as a
 *   `Check N` heading in the sibling SKILL.md (error: dangling expectation);
 * - when a skill has >= 2 Check headings AND at least one fixture references
 *   checks by number, the frontmatter description must cover every Check
 *   (see {@link descriptionCoversCheck}; error: enumeration drift);
 * - a Check never referenced by any fixture is a warning only, and is
 *   suppressed when an all-pass fixture (`findings: []`) exists, since that
 *   fixture implicitly exercises every Check.
 *
 * Out of scope (needs semantic judgment, kept with the AI-review side per
 * .claude/rules/review-core.md): whether a `findings: []` fixture actually
 * satisfies every Check's conditions.
 *
 * @param {{ skillsDir?: string, repoRoot?: string }} [options]
 * @returns {Promise<boolean>} false (→ exitCode 1) on any drift error.
 */
export async function validateFixtureDrift({
  skillsDir = defaultPaths.skillsDir,
  repoRoot = defaultPaths.repoRoot,
} = {}) {
  let files = [];
  try {
    files = await listSkillFiles(skillsDir);
  } catch (err) {
    console.error(`❌ Failed to list skills: ${err.message}`);
    return false;
  }

  let success = true;
  let skillsWithExpectations = 0;

  for (const filePath of files) {
    const basename = path.basename(filePath);
    if (basename !== 'SKILL.md') continue;
    const relativePath = path.relative(repoRoot, filePath);
    if (isAgentSkillsPath(relativePath)) continue;

    const skillDir = path.dirname(filePath);
    const fixturesDir = path.join(skillDir, 'fixtures');
    const fixtureNames = (await fs.readdir(fixturesDir).catch(() => [])).filter((f) =>
      f.endsWith('.md')
    );
    if (!fixtureNames.length) continue;

    let skill;
    try {
      skill = await parseSkillFile(filePath);
    } catch {
      // Unparseable SKILL.md files are reported by validateSkills(); skip here.
      continue;
    }
    const checkHeadings = extractCheckHeadings(skill.body);
    const checkIds = new Set(checkHeadings.map((h) => h.id));

    const referencedChecks = new Set();
    let hasCheckExpectations = false;
    let hasEmptyFindingsFixture = false;
    let hasAnyExpectedBlock = false;

    for (const name of fixtureNames.sort()) {
      const fixturePath = path.join(fixturesDir, name);
      const fixtureRel = path.relative(repoRoot, fixturePath);
      const content = await fs.readFile(fixturePath, 'utf8');
      for (const block of extractExpectedBlocks(content)) {
        hasAnyExpectedBlock = true;
        let parsed;
        try {
          parsed = yaml.load(block);
        } catch (err) {
          console.error(`❌ ${fixtureRel}: expected block is not valid YAML: ${err.message}`);
          success = false;
          continue;
        }
        const findings = parsed?.findings;
        if (!Array.isArray(findings)) continue;
        if (findings.length === 0) {
          hasEmptyFindingsFixture = true;
          continue;
        }
        for (const finding of findings) {
          const check = finding?.check;
          if (!Number.isInteger(check)) continue;
          hasCheckExpectations = true;
          referencedChecks.add(check);
          if (!checkIds.has(check)) {
            console.error(
              `❌ ${fixtureRel}: expected block references Check ${check}, ` +
                `but ${relativePath} has no "Check ${check}" heading (dangling expectation)`
            );
            success = false;
          }
        }
      }
    }

    if (!hasAnyExpectedBlock) continue;
    skillsWithExpectations += 1;

    // Description enumeration gate — only for skills whose fixtures reference
    // Checks by number (the drift contract of the CLAUDE.md guard).
    if (hasCheckExpectations && checkHeadings.length >= 2) {
      const description = skill.metadata?.description ?? '';
      for (const { id, title } of checkHeadings) {
        if (!descriptionCoversCheck(description, title)) {
          console.error(
            `❌ ${relativePath}: frontmatter description does not mention Check ${id}` +
              ` ("${title}") — update the description to enumerate all current Checks`
          );
          success = false;
        }
      }
    }

    // Coverage is advisory: an uncovered Check is fine when an all-pass
    // fixture (findings: []) exists, since it implicitly exercises every Check.
    if (hasCheckExpectations && !hasEmptyFindingsFixture) {
      for (const id of checkIds) {
        if (!referencedChecks.has(id)) {
          console.warn(
            `⚠️  ${relativePath}: Check ${id} is not referenced by any fixture expected block`
          );
        }
      }
    }
  }

  if (success) {
    console.log(
      `✅ fixture drift: ${skillsWithExpectations} skill(s) with expected blocks consistent`
    );
  }
  return success;
}

/**
 * Detect hyphen-variant collisions across a labeled set of identifiers: two
 * DISTINCT labels that become equal after stripping hyphens (e.g. `foo-bar` vs
 * `foobar`, or `foo-bar` in the registry vs `foobar` as an agent-skill) are a
 * naming collision (skills/README.md § "Common prohibitions and consistency":
 * no names that differ only by hyphenation). A label repeated with the same
 * kind is de-duplicated so it does not self-collide. The SAME label across
 * DIFFERENT kinds (e.g. a registry id equal to an agent-skill name) IS a
 * collision: it is just as ambiguous at resolution time, and no such pair
 * exists in the current data (verified against skills/registry.yaml and
 * skills/agent-skills/ for #1468 review), so erroring is forward-protective
 * without grandfathering (gemini review on PR #1468). Pure and exported for
 * unit testing.
 *
 * @param {Array<{ label: string, kind: string }>} entries
 * @returns {Array<{ normalized: string, entries: Array<{ label: string, kind: string }> }>}
 */
export function findRegistryNamingCollisions(entries) {
  const byNorm = new Map();
  for (const entry of entries ?? []) {
    const label = typeof entry?.label === 'string' ? entry.label : '';
    const norm = label.toLowerCase().replace(/-/g, '');
    if (!norm) continue;
    if (!byNorm.has(norm)) byNorm.set(norm, new Map());
    // Key by label AND kind: the same label listed twice under one kind is not
    // a self-collision, but the same label under two kinds is reported.
    byNorm.get(norm).set(`${label}|${entry.kind}`, { label, kind: entry.kind });
  }
  const collisions = [];
  for (const [normalized, map] of byNorm) {
    if (map.size > 1) collisions.push({ normalized, entries: [...map.values()] });
  }
  return collisions;
}

/**
 * Registry naming-collision gate: every registry `id` and every agent-skill
 * directory name must stay unique after hyphen-normalization, so a new entry
 * cannot shadow an existing identifier by merely adding/removing a hyphen
 * (skills/README.md § Naming; issue #1463). agent-skill directory names are
 * folded in because a registry id colliding with an agent-skill name is just as
 * ambiguous at resolution time.
 *
 * @param {{ skillsDir?: string, repoRoot?: string }} [options]
 * @returns {Promise<boolean>} false (→ exitCode 1) on any collision.
 */
export async function validateNamingCollisions({ skillsDir = defaultPaths.skillsDir } = {}) {
  const registryPath = path.join(skillsDir, 'registry.yaml');
  const registry = await loadSkillRegistry(registryPath);
  if (!registry.ok) {
    console.error(`❌ Failed to read/parse skill registry at ${registryPath}: ${registry.message}`);
    return false;
  }
  const parsed = registry.parsed;

  const ids = (Array.isArray(parsed?.skills) ? parsed.skills : [])
    .map((s) => s?.id)
    .filter((id) => typeof id === 'string');

  // agent-skill directory names (top-level dirs under skills/agent-skills/).
  const agentSkillsDir = path.join(skillsDir, 'agent-skills');
  let agentNames = [];
  try {
    const dirents = await fs.readdir(agentSkillsDir, { withFileTypes: true });
    agentNames = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    // agent-skills dir absent: skip that side.
  }

  const entries = [
    ...ids.map((label) => ({ label, kind: 'registry id' })),
    ...agentNames.map((label) => ({ label, kind: 'agent-skill' })),
  ];
  const collisions = findRegistryNamingCollisions(entries);

  let success = true;
  for (const { normalized, entries: colliding } of collisions) {
    const desc = colliding.map((e) => `${e.label} (${e.kind})`).join(', ');
    console.error(
      `❌ naming collision by hyphenation only: ${desc} — all normalize to "${normalized}"`
    );
    success = false;
  }

  if (success) {
    console.log(
      `✅ naming collisions: ${entries.length} identifier(s) unique after hyphen-normalization`
    );
  }
  return success;
}

if (isDirectRun(import.meta.url)) {
  const skillsOk = await validateSkills();
  const packsOk = await validatePacks();
  const evalCoverageOk = await validateRecommendedEvalCoverage();
  const registryPathsOk = await validateRegistryPaths();
  const registryIdsOk = await validateRegistryIdMatch();
  const fixtureDriftOk = await validateFixtureDrift();
  const namingCollisionsOk = await validateNamingCollisions();
  const ok =
    skillsOk &&
    packsOk &&
    evalCoverageOk &&
    registryPathsOk &&
    registryIdsOk &&
    fixtureDriftOk &&
    namingCollisionsOk;
  if (!ok) {
    process.exitCode = 1;
  }
}
