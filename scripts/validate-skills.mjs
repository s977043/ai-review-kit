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
  loadRegistry,
  loadPacks,
  loadRecommendationSets,
  selectPacks,
  selectRecommendationSets,
  SkillLoaderError,
} from '../runners/core/skill-loader.mjs';
import { isDirectRun } from './lib/is-direct-run.mjs';

// #1231: 既存の eval 未整備 recommended skill。新規追加分はこの集合に足さず
// eval を用意すること（recommended skill は eval/ または fixtures/ を持つこと
// を validateRecommendedEvalCoverage() で前向きに強制する）。
// 空集合を保つのが到達目標であり、S1 fixtures の横展開（docs/development/
// s1-fixture-convention.md）によって現在は空になっている。定数と分岐は残す:
// 既存 skill を新たに recommended: true へ切り替える移行局面で、fixtures が
// 揃うまでの一時的な免除口として再び必要になりうるため（新規 skill は最初から
// fixtures を用意すること）。
const GRANDFATHERED_WITHOUT_EVAL = new Set([]);

// #1598: contexts the default runner path (`river run` → src/lib/local-runner.mjs
// `collectLocalContext`) declares as available for inputContext-based skill
// selection. `diff` is always resolved (resolveAvailableContexts default in
// src/lib/utils.mjs, alwaysInclude ['diff']); `prDescription` is added only when
// a PR body is present; `fullFile` is added only when the runner can honestly
// supply the change set's full source text (#1606 — resolveFullFileSupply gates
// this; content is injected by repo-context.mjs collectRepoContext). Adopters
// can widen this via RIVER_AVAILABLE_CONTEXTS / --context, but a
// `recommended: true` skill whose inputContext requires anything outside this
// set never fires on the default path — the exact silent-skip regression #1598
// documented. Kept in sync with the runner by
// tests/validate-recommended-context.test.mjs.
export const RUNNER_SUPPLIED_CONTEXTS = ['diff', 'prDescription', 'fullFile'];

// #1598: recommended skills that still declare an inputContext outside
// RUNNER_SUPPLIED_CONTEXTS and therefore never fire on the default runner path.
// They are grandfathered so the forward-gate does not break CI, but NEW
// recommended skills must keep inputContext within RUNNER_SUPPLIED_CONTEXTS (or
// the runner must be taught to supply the extra contexts) rather than be added
// here. Shrinking this set — by making a skill diff-centric (#1598 did this for
// behavior-structure-separation / knowledge-to-code-alignment) or by widening
// the runner-supplied set — is the intended migration direction.
const GRANDFATHERED_UNSUPPLIED_CONTEXT = new Set(['coverage-gap', 'test-existence']);
// #1606: adding `fullFile` to RUNNER_SUPPLIED_CONTEXTS makes every skill whose
// inputContext became a subset of {diff, prDescription, fullFile} compliant.
// The stale-grandfather gate (below) therefore FORCES removing those entries in
// this same change — leaving them would fail CI as "stale (compliant)".
//
// Shrink history of this set (36 → 2), for reviewers diffing against an older
// base:
//   - a-1, 14 adr-only skills → removed by #1607 (adr made redundant, diff-centric).
//   - c-tier, 4 skills (pre-mortem, logic-torturing, assumption-resolution-trace,
//     independent-review-synthesis) → un-recommended by #1610.
//   - #1609, 10 fullFile-compliant skills → removed once `fullFile` was supplied:
//     cross-file-leakage, fix-scope-integrity, impact-evidence-coverage,
//     refactor-claim-audit, security-privacy-design, self-contradiction,
//     type-driven-design, typescript-nullcheck, typescript-strict, war-game.
//   - #1606 Wave 2 (a-2/a-4), 6 skills → removed here after re-measuring against
//     the now-supplied {diff, prDescription, fullFile} set: dropping the redundant
//     `adr` alone made them subsets. a-2: api-versioning-compat, data-model-db-design,
//     integration-contracts, openapi-contract (→ [diff, fullFile]),
//     architecture-traceability (→ [diff]; cross-doc drift check degrades to the
//     within-diff/coordinated-change scope — the drift-acknowledgment meta-check and
//     related-file consistency survive). a-4: multitenancy-isolation (→ [fullFile];
//     the `fullFile` supply, not a Gate→diff rewrite, is what makes it fire — its
//     sibling security-privacy-design already landed the same way in #1609).
//
// Remaining (b-tier): coverage-gap / test-existence need the REPO-WIDE test tree
// (existing, unchanged tests) which the coarse `fullFile` token — changed-file
// content only — cannot supply; a wider RIVER_AVAILABLE_CONTEXTS / runner change
// is the follow-up before they can leave this set.

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
  registry,
} = {}) {
  // Derive packs/recommendations from the pre-loaded registry when threaded from
  // the main runner (one read for the whole run); otherwise fall back to the
  // standalone loaders (unchanged for direct/test callers). A parse failure
  // throws exactly as loadPacks did; a read failure resolves to an empty
  // registry (no packs → early return).
  let parsed;
  if (registry) {
    if (!registry.ok) {
      if (registry.phase === 'parse') {
        throw new SkillLoaderError(
          `Failed to parse skill registry at ${path.join(skillsDir, 'registry.yaml')}: ${registry.message}`
        );
      }
      parsed = {};
    } else {
      parsed = registry.parsed;
    }
  }
  const packs = registry ? selectPacks(parsed) : await loadPacks({ skillsDir });
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

  const recommendations = registry
    ? selectRecommendationSets(parsed)
    : await loadRecommendationSets({ skillsDir });
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
  registry,
} = {}) {
  const registryPath = path.join(skillsDir, 'registry.yaml');
  const result = registry ?? (await loadRegistry({ skillsDir }));
  if (!result.ok) {
    console.error(
      `❌ Failed to ${result.phase} skill registry at ${registryPath}: ${result.message}`
    );
    return false;
  }
  const parsed = result.parsed;

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
 * Forward-gate (#1598): every `recommended: true` skill's `inputContext` must be
 * a subset of {@link RUNNER_SUPPLIED_CONTEXTS} — the contexts the default runner
 * path actually declares — otherwise the skill is silently skipped on every run
 * (`missing inputContext: ...`) and never fires despite being recommended.
 * Already-shipped offenders are exempted via
 * {@link GRANDFATHERED_UNSUPPLIED_CONTEXT}; new recommended skills must keep
 * inputContext within the supplied set (or the runner must be widened) rather
 * than be added to that set.
 *
 * @param {{ skillsDir?: string, repoRoot?: string, registry?: object,
 *   grandfathered?: Set<string> }} [options] `grandfathered` is injectable for
 *   tests; production callers use the module-level GRANDFATHERED_UNSUPPLIED_CONTEXT.
 * @returns {Promise<boolean>} false (→ exitCode 1) if any non-grandfathered
 *   recommended skill declares an inputContext outside the supplied set, or if a
 *   grandfather entry has gone stale (compliant or no longer recommended).
 */
export async function validateRecommendedContextAvailability({
  skillsDir = defaultPaths.skillsDir,
  repoRoot = defaultPaths.repoRoot,
  registry,
  grandfathered = GRANDFATHERED_UNSUPPLIED_CONTEXT,
} = {}) {
  const registryPath = path.join(skillsDir, 'registry.yaml');
  const result = registry ?? (await loadRegistry({ skillsDir }));
  if (!result.ok) {
    console.error(
      `❌ Failed to ${result.phase} skill registry at ${registryPath}: ${result.message}`
    );
    return false;
  }
  const supplied = new Set(RUNNER_SUPPLIED_CONTEXTS);
  const skills = Array.isArray(result.parsed?.skills) ? result.parsed.skills : [];
  const recommended = skills.filter((s) => s && s.recommended === true);
  let success = true;
  let okCount = 0;
  let grandfatheredCount = 0;
  // Ids whose grandfather entry actually earned its keep this run (a recommended
  // skill that still requires an unsupplied context). Anything in
  // GRANDFATHERED_UNSUPPLIED_CONTEXT that never lands here is stale — the skill
  // was made compliant or dropped/un-recommended — and must be removed so the
  // list only ever shrinks (gemini review on PR #1605).
  const neededGrandfather = new Set();
  const recommendedIds = new Set();

  for (const skill of recommended) {
    const { id, path: skillPath } = skill;
    // Malformed entries are reported by validateRegistryPaths(); skip here.
    if (!id || typeof skillPath !== 'string') continue;
    recommendedIds.add(id);
    const resolved = path.resolve(repoRoot, skillPath);
    let parsedSkill;
    try {
      parsedSkill = await parseSkillFile(resolved);
    } catch {
      // Missing/unparseable files are reported elsewhere; skip here.
      continue;
    }
    const inputContext = parsedSkill?.metadata?.inputContext;
    // A skill with no inputContext (or an empty list) is never skipped on the
    // context check, so it cannot regress here.
    if (!Array.isArray(inputContext) || inputContext.length === 0) {
      okCount += 1;
      continue;
    }
    const missing = inputContext.filter((ctx) => !supplied.has(ctx));
    if (missing.length === 0) {
      okCount += 1;
      continue;
    }
    if (grandfathered.has(id)) {
      okCount += 1;
      grandfatheredCount += 1;
      neededGrandfather.add(id);
      continue;
    }
    console.error(
      `❌ recommended skill "${id}" requires inputContext [${missing.join(', ')}] ` +
        `that the default runner does not supply (supplied: [${RUNNER_SUPPLIED_CONTEXTS.join(', ')}]); ` +
        'it would be silently skipped on every run (#1598). Make the skill diff-centric, ' +
        'teach the runner to supply the context, or — only for already-shipped skills — ' +
        'add it to GRANDFATHERED_UNSUPPLIED_CONTEXT in scripts/validate-skills.mjs'
    );
    success = false;
  }

  // Stale-grandfather gate: fail loudly for any grandfathered id that no longer
  // needs the exemption, so the list cannot accumulate dead entries that would
  // silence a future regression of the same skill (gemini review on PR #1605).
  for (const id of grandfathered) {
    if (neededGrandfather.has(id)) continue;
    const reason = recommendedIds.has(id)
      ? 'its inputContext is now within the runner-supplied set (it is compliant)'
      : 'it is no longer a recommended skill (removed, renamed, or un-recommended)';
    console.error(
      `❌ grandfathered skill "${id}" is stale: ${reason}. ` +
        'Remove it from GRANDFATHERED_UNSUPPLIED_CONTEXT in scripts/validate-skills.mjs ' +
        'so the exemption list only shrinks and cannot mask a future regression.'
    );
    success = false;
  }

  if (success) {
    console.log(
      `✅ recommended context availability: ${okCount}/${recommended.length} recommended skill(s) ` +
        `have inputContext within the runner-supplied set (incl. ${grandfatheredCount} grandfathered)`
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
  registry,
} = {}) {
  const registryPath = path.join(skillsDir, 'registry.yaml');
  const result = registry ?? (await loadRegistry({ skillsDir }));
  if (!result.ok) {
    console.error(
      `❌ Failed to ${result.phase} skill registry at ${registryPath}: ${result.message}`
    );
    return false;
  }
  const parsed = result.parsed;

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
  registry,
} = {}) {
  const registryPath = path.join(skillsDir, 'registry.yaml');
  const result = registry ?? (await loadRegistry({ skillsDir }));
  if (!result.ok) {
    console.error(
      `❌ Failed to ${result.phase} skill registry at ${registryPath}: ${result.message}`
    );
    return false;
  }
  const parsed = result.parsed;

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

// ---------------------------------------------------------------------------
// Fixture diff-block structural validation (#1852)
// ---------------------------------------------------------------------------

/**
 * Matches a fenced ```diff block. The backreference on the opening run of
 * backticks keeps 4-backtick fences (used when the diff body itself contains a
 * 3-backtick fence, e.g. skills/midstream/self-contradiction/fixtures/01-*.md)
 * from terminating early.
 */
const RE_DIFF_FENCE = /^(`{3,})diff[ \t]*\r?\n([\s\S]*?)^\1[ \t]*$/gm;

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@` unified-diff hunk header. */
const RE_HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Same shape as RE_HUNK_HEADER, global+multiline, for counting hunk headers in a
 * whole fixture file. A header inside a diff body is never at line start (it
 * would carry a ` `, `+` or `-` prefix), so this counts real headers only.
 */
const RE_HUNK_HEADER_LINE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm;

/**
 * Count `@@ ... @@` hunk headers in raw text. Pure and exported for unit testing.
 *
 * @param {string} text
 * @returns {number}
 */
export function countHunkHeaders(text) {
  return [...String(text ?? '').matchAll(RE_HUNK_HEADER_LINE)].length;
}

/** `+++ b/path` (or `+++ path`) new-side file header. */
const RE_NEW_FILE_HEADER = /^\+\+\+ (?:b\/)?(\S+)/;

/** `<file>:<line>` anchor, as emitted in fixture `<!-- expected: -->` blocks. */
const RE_ANCHOR = /^(.*\S):(\d+)$/;

/**
 * Canonical spelling of a diff/anchor path (#1856,残件 3).
 *
 * `./docs/note.md` and `docs/note.md` name the same file, but a raw string
 * compare against the `+++ b/docs/note.md` header misses, and the gate then
 * reports "no `+++ b/./docs/note.md` appears in the fixture's diff blocks" —
 * a message that sends the maintainer looking for a missing diff instead of a
 * redundant `./`. Both sides of the comparison go through this function, so the
 * two spellings resolve to one key.
 *
 * `path.posix` is used deliberately: fixture diffs are unified diffs, whose
 * separator is `/` on every platform. `path.normalize` on Windows would rewrite
 * them to `\` and break the comparison it is meant to fix.
 *
 * @param {string} p
 * @returns {string}
 */
export function normalizeDiffPath(p) {
  return path.posix.normalize(String(p ?? '')).replace(/^\.\//, '');
}

/**
 * True when a ```diff block body carries at least one added/removed content
 * line. `+++ ` / `--- ` file headers and the `\ No newline` marker are not
 * content, and a block made of nothing else (e.g. the intentionally empty diff
 * in skills/upstream/plangate-exec-conformance/fixtures/03-fallback-diff-empty.md)
 * carries no line an anchor could point at.
 *
 * @param {string} blockText
 * @returns {boolean}
 */
function hasDiffContentLines(blockText) {
  return String(blockText ?? '')
    .split('\n')
    .some(
      (line) =>
        (line.startsWith('+') || line.startsWith('-')) &&
        !line.startsWith('+++ ') &&
        !line.startsWith('--- ')
    );
}

/**
 * True when `lines[i]` opens a `--- old` / `+++ new` file-header PAIR.
 *
 * A bare `startsWith('--- ')` test is ambiguous: deleting a line that itself
 * begins with `-- ` (an SQL or Lua comment — fixtures carry SQL, e.g.
 * skills/upstream/data-model-db-design/fixtures/01-*.md) produces the diff line
 * `--- foo`, which is a DELETION, not a header. Mistaking it for a header ends
 * the hunk early and makes the gate report a wrong "expected" hunk header, so a
 * maintainer following the message would break a correct fixture. Unified diff
 * always emits the two headers adjacently, so requiring the pair disambiguates
 * deterministically: a deleted `-- comment` is never followed by a `+++ ` line
 * that starts a file section.
 *
 * @param {string[]} lines
 * @param {number} i
 * @returns {boolean}
 */
function isFileHeaderPairStart(lines, i) {
  return lines[i].startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ');
}

/**
 * Extract the bodies of every fenced ```diff block in a fixture file.
 * Pure and exported for unit testing.
 *
 * @param {string} text - fixture file content
 * @returns {string[]} raw diff bodies (fence lines excluded)
 */
export function extractDiffBlocks(text) {
  return [...(text ?? '').matchAll(RE_DIFF_FENCE)].map((m) => m[2]);
}

/**
 * Parse a unified-diff body and reconstruct the new-side (post-image) line
 * numbering, so that an `<file>:<line>` anchor can be resolved deterministically.
 * Pure and exported for unit testing.
 *
 * Reconstruction rules (standard unified diff):
 * - a ` ` (context) line advances both sides;
 * - a `+` line advances the new side only;
 * - a `-` line advances the old side only;
 * - a `\` line (`\ No newline at end of file`) advances neither.
 *
 * A completely empty line inside a hunk body is treated as a context line whose
 * content is empty — that is how a trailing-whitespace-stripped context line
 * appears in a markdown fixture. The trailing empty element produced by
 * splitting on the final newline is dropped first so it is not miscounted.
 *
 * @param {string} diffText - body of one ```diff block
 * @returns {{
 *   files: Map<string, { lines: Map<number, string> }>,
 *   hunks: Array<{
 *     file: string|null, header: string,
 *     oldStart: number, declaredOld: number, actualOld: number,
 *     newStart: number, declaredNew: number, actualNew: number,
 *   }>,
 *   unknownPrefixLines: string[],
 * }}
 */
export function parseUnifiedDiff(diffText) {
  const files = new Map();
  const hunks = [];
  const unknownPrefixLines = [];
  const lines = String(diffText ?? '').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  let currentFile = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fileMatch = RE_NEW_FILE_HEADER.exec(line);
    if (fileMatch) {
      // `+++ /dev/null` marks a deletion: no new-side lines to reconstruct.
      currentFile = fileMatch[1] === '/dev/null' ? null : normalizeDiffPath(fileMatch[1]);
      if (currentFile && !files.has(currentFile)) files.set(currentFile, { lines: new Map() });
      i += 1;
      continue;
    }

    const hunkMatch = RE_HUNK_HEADER.exec(line);
    if (!hunkMatch) {
      i += 1;
      continue;
    }

    const oldStart = Number(hunkMatch[1]);
    const declaredOld = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
    const newStart = Number(hunkMatch[3]);
    const declaredNew = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
    let actualOld = 0;
    let actualNew = 0;
    let newLine = newStart;
    i += 1;

    while (i < lines.length) {
      const body = lines[i];
      // `+++ ` ends the hunk only as the second half of a header pair; on its
      // own it is an added line whose text starts with `++ ` (mirror of the
      // `--- ` ambiguity documented on isFileHeaderPairStart).
      const isPairedNewHeader = body.startsWith('+++ ') && (lines[i - 1] ?? '').startsWith('--- ');
      if (
        RE_HUNK_HEADER.test(body) ||
        body.startsWith('diff --git ') ||
        isFileHeaderPairStart(lines, i) ||
        isPairedNewHeader
      ) {
        break;
      }
      if (body.startsWith('\\')) {
        i += 1;
        continue;
      }
      if (body.startsWith('+')) {
        actualNew += 1;
        if (currentFile) files.get(currentFile).lines.set(newLine, body.slice(1));
        newLine += 1;
      } else if (body.startsWith('-')) {
        actualOld += 1;
      } else if (body.startsWith(' ') || body === '') {
        actualOld += 1;
        actualNew += 1;
        if (currentFile) files.get(currentFile).lines.set(newLine, body.slice(1));
        newLine += 1;
      } else {
        // Not a unified-diff body line. Record it and stop the hunk here rather
        // than silently swallowing it into a wrong line count.
        unknownPrefixLines.push(body);
        break;
      }
      i += 1;
    }

    hunks.push({
      file: currentFile,
      header: line,
      oldStart,
      declaredOld,
      actualOld,
      newStart,
      declaredNew,
      actualNew,
    });
  }

  return { files, hunks, unknownPrefixLines };
}

/**
 * Merge every ```diff block of one fixture into a single new-side view.
 * Pure and exported for unit testing.
 *
 * Two structural defects are detected here rather than in parseUnifiedDiff,
 * because both are properties of the fixture as a whole (#1856):
 *
 * - `headerlessBlocks`: a ```diff block that carries `+`/`-` content lines but
 *   declares no `@@` header. Its new-side numbering cannot be reconstructed, so
 *   every line it contributes is invisible to the anchor check — and the #1854
 *   surplus-header guard cannot see it either, because that guard compares two
 *   counts that are both 0 here.
 * - `orderIssues`: two hunks of the same file whose new-side ranges overlap, or
 *   that appear out of ascending order. The merge below is last-write-wins, so
 *   an overlap silently replaces the earlier hunk's lines and an anchor into
 *   the earlier hunk is then validated against the later hunk's text.
 *
 * @param {string} text - fixture file content
 * @returns {{
 *   files: Map<string, { lines: Map<number, string> }>,
 *   hunks: Array<object>,
 *   unknownPrefixLines: string[],
 *   headerlessBlocks: number[],
 *   orderIssues: Array<{
 *     file: string, previous: string, current: string, previousRange: string,
 *   }>,
 * }}
 */
export function parseFixtureDiffs(text) {
  const files = new Map();
  const hunks = [];
  const unknownPrefixLines = [];
  const headerlessBlocks = [];
  const blocks = extractDiffBlocks(text);
  for (const [index, block] of blocks.entries()) {
    const parsed = parseUnifiedDiff(block);
    if (parsed.hunks.length === 0 && hasDiffContentLines(block)) headerlessBlocks.push(index);
    for (const [file, entry] of parsed.files) {
      if (!files.has(file)) files.set(file, { lines: new Map() });
      const target = files.get(file);
      for (const [n, content] of entry.lines) target.lines.set(n, content);
    }
    hunks.push(...parsed.hunks);
    unknownPrefixLines.push(...parsed.unknownPrefixLines);
  }

  const orderIssues = [];
  const seenByFile = new Map();
  for (const hunk of hunks) {
    if (!hunk.file) continue;
    const previous = seenByFile.get(hunk.file);
    if (previous) {
      // Half-open new-side range. A pure-deletion hunk has actualNew === 0, so
      // its range is empty and a following hunk starting at the same line is
      // neither an overlap nor out of order.
      //
      // One comparison covers both defects the issue names. `newStart` going
      // backwards always lands inside or before the preceding range, because
      // that range starts at the preceding `newStart`; so "not ascending" is a
      // strict subset of "overlaps", and a separate monotonicity branch would
      // be unreachable.
      const previousEnd = previous.newStart + previous.actualNew;
      if (hunk.newStart < previousEnd) {
        orderIssues.push({
          file: hunk.file,
          previous: previous.header,
          current: hunk.header,
          previousRange: `${previous.newStart}..${previousEnd - 1}`,
        });
      }
    }
    seenByFile.set(hunk.file, hunk);
  }

  return { files, hunks, unknownPrefixLines, headerlessBlocks, orderIssues };
}

/**
 * Collect the `<file>:<line>` anchors declared by a fixture's
 * `<!-- expected: -->` blocks. Pure and exported for unit testing.
 *
 * Only `findings[].anchor` is read — the same field validateFixtureDrift()
 * consumes. Pseudo-anchors that name no file (`(summary):1` and friends, i.e.
 * anything starting with `(`) are skipped: no deterministic judgment is
 * possible for them. Anchors that name a file but are not in `<file>:<line>`
 * form are NOT skipped — extractMalformedAnchors() reports them (#1856).
 *
 * The `file` field is returned in normalizeDiffPath() form so it compares
 * directly against the keys parseFixtureDiffs() produces.
 *
 * @param {string} text - fixture file content
 * @returns {Array<{ raw: string, file: string, line: number }>}
 */
export function extractFixtureAnchors(text) {
  const anchors = [];
  for (const block of extractExpectedBlocks(text)) {
    let parsed;
    try {
      parsed = yaml.load(block);
    } catch {
      // Reported by validateFixtureDrift(); nothing to anchor-check here.
      continue;
    }
    const findings = parsed?.findings;
    if (!Array.isArray(findings)) continue;
    for (const finding of findings) {
      const raw = finding?.anchor;
      if (typeof raw !== 'string') continue;
      const match = RE_ANCHOR.exec(raw.trim());
      if (!match) continue;
      const file = match[1].trim();
      if (file.startsWith('(')) continue; // `(summary):1` and friends
      anchors.push({ raw: raw.trim(), file: normalizeDiffPath(file), line: Number(match[2]) });
    }
  }
  return anchors;
}

/**
 * Collect the `findings[].anchor` strings that name a file but are NOT in
 * `<file>:<line>` form, so the gate can reject them instead of skipping them
 * (#1856,残件 1). The motivating case is the range form `docs/note.md:1-5`:
 * RE_ANCHOR does not match it, extractFixtureAnchors() drops it, and the
 * finding is then never checked against the diff while CI stays green.
 *
 * Pseudo-anchors starting with `(` stay exempt — they intentionally name no
 * file, and extractFixtureAnchors() skips them for the same reason.
 *
 * @param {string} text - fixture file content
 * @returns {string[]} the offending raw anchor strings
 */
export function extractMalformedAnchors(text) {
  const malformed = [];
  for (const block of extractExpectedBlocks(text)) {
    let parsed;
    try {
      parsed = yaml.load(block);
    } catch {
      // Reported by validateFixtureDrift(); nothing to anchor-check here.
      continue;
    }
    const findings = parsed?.findings;
    if (!Array.isArray(findings)) continue;
    for (const finding of findings) {
      const raw = finding?.anchor;
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (trimmed.startsWith('(')) continue;
      if (RE_ANCHOR.test(trimmed)) continue;
      malformed.push(trimmed);
    }
  }
  return malformed;
}

/**
 * Structural gate for the ```diff blocks embedded in skill fixtures (#1852).
 * Everything here is deterministic and opt-in by structure — a fixture with no
 * ```diff block, and a fixture whose expected blocks declare no `<file>:<line>`
 * anchor (e.g. a negative fixture with `findings: []`), is untouched.
 *
 * Errors:
 * - a hunk header's declared line counts must equal the hunk body's actual
 *   counts, on the old side and the new side;
 * - an anchor's file must appear as a `+++ b/<path>` header in one of the
 *   fixture's diff blocks (compared after normalizeDiffPath(), so `./a` and `a`
 *   are one path — #1856,残件 3);
 * - the anchored line must exist in the reconstructed new-side numbering and
 *   must not be blank;
 * - a ```diff block with `+`/`-` content lines must declare a `@@` hunk header
 *   (#1856,残件 1 — the #1854 surplus check is blind here, both counts are 0);
 * - an anchor that names a file must be in `<file>:<line>` form, not a range
 *   like `docs/note.md:1-5` (#1856,残件 1);
 * - two hunks of one file must not overlap on the new side, and must appear in
 *   ascending new-side order (#1856,残件 2).
 *
 * Rationale (#1850 adversarial review): CI was fully green while anchors
 * pointed at blank lines and hunk headers disagreed with their bodies, because
 * validateFixtureDrift() only reads the expected block's YAML. These fixtures
 * are never executed by eval:fixtures, so nothing else would ever catch it.
 *
 * The return value carries the coverage counters, not just the verdict: a gate
 * that inspects NOTHING also returns `ok: true`, so "no error was printed" is
 * not evidence that the gate ran. Every way this gate can lose its real input —
 * a broken RE_DIFF_FENCE, a path filter, a renamed `fixtures/` directory, a
 * changed `.md` filter — collapses the counters while leaving the verdict green.
 * tests/validate-fixture-diff-structure.test.mjs asserts floors on them so that
 * silent coverage loss fails the suite (#1854 review, major 1).
 *
 * @param {{ skillsDir?: string, repoRoot?: string }} [options]
 * @returns {Promise<{ ok: boolean, checkedFixtures: number, checkedHunks: number,
 *   checkedAnchors: number }>} `ok: false` (→ exitCode 1) on any structural error.
 */
export async function validateFixtureDiffStructure({
  skillsDir = defaultPaths.skillsDir,
  repoRoot = defaultPaths.repoRoot,
} = {}) {
  let files = [];
  try {
    files = await listSkillFiles(skillsDir);
  } catch (err) {
    console.error(`❌ Failed to list skills: ${err.message}`);
    return { ok: false, checkedFixtures: 0, checkedHunks: 0, checkedAnchors: 0 };
  }

  let success = true;
  let checkedFixtures = 0;
  let checkedHunks = 0;
  let checkedAnchors = 0;

  for (const filePath of files) {
    if (path.basename(filePath) !== 'SKILL.md') continue;

    const fixturesDir = path.join(path.dirname(filePath), 'fixtures');
    const fixtureNames = (await fs.readdir(fixturesDir).catch(() => [])).filter((f) =>
      f.endsWith('.md')
    );

    for (const name of fixtureNames.sort()) {
      const fixturePath = path.join(fixturesDir, name);
      const fixtureRel = path.relative(repoRoot, fixturePath);
      const content = await fs.readFile(fixturePath, 'utf8');
      const {
        files: diffFiles,
        hunks,
        unknownPrefixLines,
        headerlessBlocks,
        orderIssues,
      } = parseFixtureDiffs(content);

      // Unrecognized-notation guard (#1854 review, major 2 — partial). Every
      // hunk header in the file must sit inside a fence this gate recognizes.
      // A surplus means the fixture carries a diff written in a notation
      // extractDiffBlocks() does not match (` ```Diff `, ` ```diff title="x" `,
      // an indented fence, a bare ``` fence), and that diff would be skipped in
      // silence — the same failure class this gate exists to close, one fixture
      // at a time rather than repo-wide. Measured 0 surplus across all current
      // fixtures, so this is forward-protective without grandfathering.
      const headersInFile = countHunkHeaders(content);
      if (headersInFile > hunks.length) {
        console.error(
          `❌ ${fixtureRel}: ${headersInFile} hunk header(s) in the file but only ` +
            `${hunks.length} inside a recognized diff block — write the diff in a ` +
            'plain ```diff fence at line start (no info string, lowercase) so it is checked'
        );
        success = false;
      }

      // Headerless-notation guard (#1856,残件 1). The surplus-header check above
      // compares two counts that are both 0 for a bare ± excerpt, so it cannot
      // see this shape at all: the block is recognized, contains real changes,
      // and contributes nothing the anchor check can resolve.
      for (const index of headerlessBlocks) {
        console.error(
          `❌ ${fixtureRel}: \`\`\`diff block #${index + 1} has +/- lines but no ` +
            '"@@ -a,b +c,d @@" hunk header — without it the new-side line numbers ' +
            'cannot be reconstructed and the block is skipped by the anchor check'
        );
        success = false;
      }

      if (!hunks.length && !diffFiles.size) continue;
      checkedFixtures += 1;

      // Malformed-anchor guard (#1856,残件 1). `docs/note.md:1-5` names a file
      // but is silently dropped by extractFixtureAnchors(), so the finding it
      // belongs to is never validated against the diff. Kept below the skip
      // above so the gate stays opt-in by structure: a fixture with no diff has
      // nothing to resolve an anchor against in the first place.
      for (const raw of extractMalformedAnchors(content)) {
        console.error(
          `❌ ${fixtureRel}: expected block anchor ${JSON.stringify(raw)} is not in ` +
            '"<file>:<line>" form — a range or suffix makes the anchor unresolvable ' +
            'and it would be skipped without this error'
        );
        success = false;
      }

      // Hunk-ordering guard (#1856,残件 2). Overlapping hunks make the merged
      // new-side view last-write-wins, so an anchor into the earlier hunk is
      // validated against the later hunk's text and passes for the wrong reason.
      for (const issue of orderIssues) {
        console.error(
          `❌ ${fixtureRel}: hunk "${issue.current}" of ${issue.file} overlaps the ` +
            `new-side range ${issue.previousRange} already covered by "${issue.previous}" — ` +
            "the later hunk overwrites the earlier hunk's reconstructed lines, so an " +
            'anchor into the earlier hunk resolves to the wrong text'
        );
        success = false;
      }

      for (const line of unknownPrefixLines) {
        console.error(
          `❌ ${fixtureRel}: unified-diff hunk body contains a line with no ` +
            `' ' / '+' / '-' prefix: ${JSON.stringify(line)}`
        );
        success = false;
      }

      for (const hunk of hunks) {
        checkedHunks += 1;
        if (hunk.declaredOld === hunk.actualOld && hunk.declaredNew === hunk.actualNew) continue;
        console.error(
          `❌ ${fixtureRel}: hunk header "${hunk.header}" declares ` +
            `old=${hunk.declaredOld}, new=${hunk.declaredNew} but the body has ` +
            `old=${hunk.actualOld}, new=${hunk.actualNew} ` +
            `(expected "@@ -${hunk.oldStart},${hunk.actualOld} +${hunk.newStart},${hunk.actualNew} @@")`
        );
        success = false;
      }

      for (const anchor of extractFixtureAnchors(content)) {
        checkedAnchors += 1;
        const entry = diffFiles.get(anchor.file);
        if (!entry) {
          console.error(
            `❌ ${fixtureRel}: expected block anchors "${anchor.raw}" but no ` +
              `"+++ b/${anchor.file}" appears in the fixture's diff blocks ` +
              `(known: ${[...diffFiles.keys()].join(', ') || 'none'})`
          );
          success = false;
          continue;
        }
        if (!entry.lines.has(anchor.line)) {
          const covered = [...entry.lines.keys()].sort((a, b) => a - b);
          console.error(
            `❌ ${fixtureRel}: expected block anchors "${anchor.raw}" but line ` +
              `${anchor.line} is not present on the new side of the diff ` +
              `(reconstructed lines: ${covered[0] ?? '-'}..${covered[covered.length - 1] ?? '-'})`
          );
          success = false;
          continue;
        }
        if (entry.lines.get(anchor.line).trim() === '') {
          console.error(
            `❌ ${fixtureRel}: expected block anchors "${anchor.raw}" but that ` +
              `line is blank — anchor a line that carries the finding's evidence`
          );
          success = false;
        }
      }
    }
  }

  if (success) {
    console.log(
      `✅ fixture diff structure: ${checkedHunks} hunk(s) and ${checkedAnchors} anchor(s) ` +
        `across ${checkedFixtures} fixture(s) consistent`
    );
  }
  return { ok: success, checkedFixtures, checkedHunks, checkedAnchors };
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
export async function validateNamingCollisions({
  skillsDir = defaultPaths.skillsDir,
  registry,
} = {}) {
  const registryPath = path.join(skillsDir, 'registry.yaml');
  const result = registry ?? (await loadRegistry({ skillsDir }));
  if (!result.ok) {
    console.error(`❌ Failed to read/parse skill registry at ${registryPath}: ${result.message}`);
    return false;
  }
  const parsed = result.parsed;

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
  // Read+parse skills/registry.yaml once and thread the result through every
  // registry-consuming gate, instead of each gate re-reading the same file.
  const registry = await loadRegistry({ skillsDir: defaultPaths.skillsDir });
  const skillsOk = await validateSkills();
  const packsOk = await validatePacks({ registry });
  const evalCoverageOk = await validateRecommendedEvalCoverage({ registry });
  const contextAvailabilityOk = await validateRecommendedContextAvailability({ registry });
  const registryPathsOk = await validateRegistryPaths({ registry });
  const registryIdsOk = await validateRegistryIdMatch({ registry });
  const fixtureDriftOk = await validateFixtureDrift();
  // Destructure `.ok` explicitly: the function returns an object (coverage
  // counters ride along), and an object is always truthy.
  const { ok: fixtureDiffStructureOk } = await validateFixtureDiffStructure();
  const namingCollisionsOk = await validateNamingCollisions({ registry });
  const ok =
    skillsOk &&
    packsOk &&
    evalCoverageOk &&
    contextAvailabilityOk &&
    registryPathsOk &&
    registryIdsOk &&
    fixtureDriftOk &&
    fixtureDiffStructureOk &&
    namingCollisionsOk;
  if (!ok) {
    process.exitCode = 1;
  }
}
