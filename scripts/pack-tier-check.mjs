#!/usr/bin/env node
// Mechanical tier assessment for skill packs (Phase C of
// docs/development/skill-pack-design.md §4).
//
// For each pack in skills/registry.yaml, checks the machine-verifiable tier
// conditions (per-skill fixtures/eval assets) and reports:
// - promotion candidates (declared tier lower than the assets justify)
// - demotion mismatches (declared tier higher than the assets justify)
// Tier changes themselves stay a maintainer decision — official additionally
// requires maintainer review, so this script never edits the registry.
//
// Usage: node scripts/pack-tier-check.mjs [--strict]
//   --strict  exit 1 when a declared tier exceeds its mechanical assessment
import path from 'path';
import { promises as fs, realpathSync } from 'fs';
import { pathToFileURL } from 'url';
import {
  defaultPaths,
  createSkillValidator,
  loadSchema,
  loadSkillFile,
  listSkillFiles,
  loadPacks,
} from '../runners/core/skill-loader.mjs';

const TIER_RANK = { experimental: 0, community: 1, official: 2 };

async function buildSkillAssetIndex({ skillsDir, repoRoot }) {
  const schema = await loadSchema(path.join(repoRoot, 'schemas', 'skill.schema.json'));
  const validator = createSkillValidator(schema);
  const index = new Map();
  for (const filePath of await listSkillFiles(skillsDir)) {
    const basename = path.basename(filePath);
    if (basename === 'skill.yaml' || basename === 'skill.yml') continue;
    if (path.relative(repoRoot, filePath).includes('agent-skills')) continue;
    try {
      const skill = await loadSkillFile(filePath, { validator });
      if (!skill?.metadata?.id) continue;
      const entries = await fs.readdir(path.dirname(filePath)).catch(() => []);
      index.set(skill.metadata.id, {
        hasAssets: entries.includes('fixtures') || entries.includes('eval'),
      });
    } catch {
      // invalid skill files are reported by skills:validate
    }
  }
  return index;
}

/**
 * Mechanical assessment: official requires all member skills to carry
 * fixtures/eval assets; community requires at least one; otherwise
 * experimental. (Content sufficiency is judged by maintainers.)
 */
export function assessTier(pack, assetIndex) {
  const skills = pack.skills ?? [];
  const withAssets = skills.filter((id) => assetIndex.get(id)?.hasAssets).length;
  if (skills.length > 0 && withAssets === skills.length) return 'official';
  if (withAssets > 0) return 'community';
  return 'experimental';
}

export async function checkPackTiers({
  skillsDir = defaultPaths.skillsDir,
  repoRoot = defaultPaths.repoRoot,
  log = console.log,
} = {}) {
  const packs = await loadPacks({ skillsDir });
  if (!packs.length) {
    log('No packs declared in skills/registry.yaml.');
    return { packs: 0, overDeclared: [], promotable: [] };
  }
  const assetIndex = await buildSkillAssetIndex({ skillsDir, repoRoot });
  const overDeclared = [];
  const promotable = [];
  for (const pack of packs) {
    const assessed = assessTier(pack, assetIndex);
    const declared = pack.tier ?? 'experimental';
    if (TIER_RANK[declared] > TIER_RANK[assessed]) {
      overDeclared.push({ id: pack.id, declared, assessed });
      log(
        `❌ pack "${pack.id}": declared tier "${declared}" exceeds mechanical assessment "${assessed}"`
      );
    } else if (TIER_RANK[declared] < TIER_RANK[assessed]) {
      promotable.push({ id: pack.id, declared, assessed });
      log(
        `⬆️  pack "${pack.id}": assets would support "${assessed}" (declared "${declared}") — ` +
          'promotion still requires maintainer review'
      );
    } else {
      log(`✅ pack "${pack.id}": tier "${declared}" matches mechanical assessment`);
    }
  }
  return { packs: packs.length, overDeclared, promotable };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isDirectRun) {
  const strict = process.argv.includes('--strict');
  const result = await checkPackTiers({});
  if (strict && result.overDeclared.length > 0) {
    process.exitCode = 1;
  }
}
