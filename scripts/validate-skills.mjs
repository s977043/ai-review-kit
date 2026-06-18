#!/usr/bin/env node
import path from 'path';
import fs from 'fs/promises';
import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';
import {
  defaultPaths,
  createSkillValidator,
  loadSchema,
  loadSkillFile,
  listSkillFiles,
  loadPacks,
  loadRecommendationSets,
} from '../runners/core/skill-loader.mjs';

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

    // Skip new Agent Skills format (validated by npm run agent-skills:validate)
    if (relativePath.includes('agent-skills')) {
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
    if (path.relative(repoRoot, filePath).includes('agent-skills')) continue;
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

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isDirectRun) {
  const skillsOk = await validateSkills();
  const packsOk = await validatePacks();
  const ok = skillsOk && packsOk;
  if (!ok) {
    process.exitCode = 1;
  }
}
