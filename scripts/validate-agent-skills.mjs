#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFrontMatter, listSkillPackageDirs } from '../runners/core/skill-loader.mjs';
import { isDirectRun } from './lib/is-direct-run.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const agentSkillsDir = path.join(repoRoot, 'skills', 'agent-skills');

function isKebabCaseName(name) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

// ---------------------------------------------------------------------------
// Naming rules (SSoT: skills/README.md § "Naming"; issue #1463 PR-3).
// The semantic Q0–Q5 import framework stays with human PR review; only the
// deterministic parts are mechanized here (repo principle #1070).
// ---------------------------------------------------------------------------

// Organizational nouns forbidden as a hyphen-delimited word in a skill name
// (skills/README.md § "Common prohibitions and consistency"). Warning-level:
// this is advisory to avoid false positives, and existing names are
// grandfathered via PROHIBITED_NOUN_EXEMPT.
export const PROHIBITED_NAME_NOUNS = ['team', 'manager', 'helper', 'util'];

// Grandfathered names exempt from the prohibited-noun warning
// (skills/README.md § "Grandfathered names").
export const PROHIBITED_NOUN_EXEMPT = new Set(['setup-team', 'review-team']);

// Anthropic-derived hard constraints (skills/README.md § "Anthropic-derived
// constraints"): max name length and reserved words. Error-level.
export const NAME_MAX_LENGTH = 64;
export const RESERVED_NAME_WORDS = ['anthropic', 'claude'];

/**
 * Return the prohibited organizational noun used as a hyphen-delimited word in
 * `name`, or null. Case-insensitive so an uppercase variant (e.g. `Foo-Team`)
 * cannot slip past the check (gemini review on PR #1468).
 */
export function findProhibitedNoun(name) {
  const words = String(name ?? '')
    .toLowerCase()
    .split('-');
  return PROHIBITED_NAME_NOUNS.find((noun) => words.includes(noun)) ?? null;
}

/**
 * True when `name` is on the grandfathered exemption list, compared
 * case-insensitively for robustness (gemini review on PR #1468).
 */
export function isProhibitedNounExempt(name) {
  return PROHIBITED_NOUN_EXEMPT.has(String(name ?? '').toLowerCase());
}

/** Return the reserved word contained in `name` (case-insensitive), or null. */
export function findReservedWord(name) {
  const lower = String(name ?? '').toLowerCase();
  return RESERVED_NAME_WORDS.find((word) => lower.includes(word)) ?? null;
}

/** Normalize a name for hyphen-variant collision detection: drop hyphens, lowercase. */
export function normalizeHyphenVariant(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/-/g, '');
}

/**
 * Given a list of names, return groups where two or more DISTINCT names share a
 * hyphen-stripped normalized form (e.g. `river-review` vs `riverreview`). A name
 * repeated verbatim is not a collision. Pure and exported for unit testing.
 *
 * @param {string[]} names
 * @returns {Array<{ normalized: string, names: string[] }>}
 */
export function findHyphenVariantCollisions(names) {
  const byNorm = new Map();
  for (const name of names) {
    const norm = normalizeHyphenVariant(name);
    if (!norm) continue;
    if (!byNorm.has(norm)) byNorm.set(norm, new Set());
    byNorm.get(norm).add(name);
  }
  const collisions = [];
  for (const [normalized, set] of byNorm) {
    if (set.size > 1) collisions.push({ normalized, names: [...set].sort() });
  }
  return collisions;
}

async function hasReferencesDir(dirPath) {
  try {
    const stat = await fs.stat(path.join(dirPath, 'references'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * List every `SKILL.md` under `dirPath`, sorted. The root itself is a container
 * (never a package), so discovery starts at its child directories — hence
 * `includeRoot: false`. Delegates the SKILL.md-non-descent walk to the shared
 * {@link listSkillPackageDirs} (skill-loader) and sorts the resulting SKILL.md
 * paths (sorting the paths, not their parent dirs, preserves the original order
 * when a sibling name is a prefix of another).
 */
async function listSkillPackages(dirPath) {
  const dirs = await listSkillPackageDirs(dirPath, { includeRoot: false });
  return dirs.map((dir) => path.join(dir, 'SKILL.md')).sort();
}

async function validateSkill(skillPath) {
  const relativePath = path.relative(repoRoot, skillPath);
  const dirName = path.basename(path.dirname(skillPath));
  const errors = [];

  let metadata;
  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const parsed = parseFrontMatter(content);
    metadata = parsed.metadata ?? {};
  } catch (err) {
    errors.push(`frontmatter parse failed: ${err.message}`);
  }

  // Imported agent skills have metadata.source === 'agent' and may use a
  // generated id (e.g. as-<name>) as directory name while preserving the
  // original name field. Skip kebab-case and name-match checks for those.
  const isImported = metadata?.metadata?.source === 'agent';

  if (!isImported && !isKebabCaseName(dirName)) {
    errors.push('dir name must be lowercase kebab-case');
  }

  if (!metadata?.name || typeof metadata.name !== 'string') {
    errors.push('missing metadata.name');
  } else if (!isImported && metadata.name !== dirName) {
    errors.push(`metadata.name must match directory name (${dirName})`);
  }

  if (!metadata?.description || typeof metadata.description !== 'string') {
    errors.push('missing metadata.description');
  }

  // Anthropic-derived hard constraints on the name (error-level; applies to all
  // skills including imported ones, since these are platform limits). See
  // skills/README.md § "Anthropic-derived constraints".
  const name = typeof metadata?.name === 'string' ? metadata.name : null;
  if (name) {
    if (name.length > NAME_MAX_LENGTH) {
      errors.push(`name exceeds ${NAME_MAX_LENGTH} characters (${name.length})`);
    }
    const reserved = findReservedWord(name);
    if (reserved) {
      errors.push(`name must not contain the reserved word "${reserved}" (Anthropic constraint)`);
    }
  }

  if (errors.length) {
    console.error(`❌ ${relativePath}`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    return false;
  }

  // Warn about missing recommended fields (non-blocking).
  const missingRecommended = [];
  if (!metadata?.version) missingRecommended.push('version');
  if (!metadata?.tags) missingRecommended.push('tags');
  if (!metadata?.severity && !metadata?.outputKind)
    missingRecommended.push('severity or outputKind');
  if (missingRecommended.length) {
    console.warn(
      `⚠  ${relativePath} — missing recommended fields: ${missingRecommended.join(', ')}`
    );
  }

  // Advisory: organizational noun in the name (warning-level, grandfathered
  // names exempt). See skills/README.md § "Common prohibitions and consistency".
  const nounTarget = name ?? dirName;
  if (!isProhibitedNounExempt(nounTarget) && !isProhibitedNounExempt(dirName)) {
    const noun = findProhibitedNoun(nounTarget);
    if (noun) {
      console.warn(
        `⚠️  ${relativePath}: name contains organizational noun "${noun}" — ` +
          'prefer a name that states the value (skills/README.md § Naming)'
      );
    }
  }

  console.log(`✅ ${relativePath}`);
  const hasRefs = await hasReferencesDir(path.dirname(skillPath));
  if (!hasRefs) {
    console.warn(`⚠️  ${relativePath}: references/ directory is missing`);
  }
  return true;
}

async function validateAgentSkills() {
  try {
    await fs.access(agentSkillsDir);
  } catch {
    console.warn('⚠️  No skills/agent-skills directory found.');
    return true;
  }

  const packages = await listSkillPackages(agentSkillsDir);
  if (!packages.length) {
    console.warn('⚠️  No Agent Skills packages found under skills/agent-skills/.');
    return true;
  }

  let success = true;
  for (const skillPath of packages) {
    const ok = await validateSkill(skillPath);
    if (!ok) success = false;
  }

  // Cross-skill: two agent-skill directory names that differ only by
  // hyphenation collide when resolved (skills/README.md § "Common prohibitions
  // and consistency"). Error-level.
  const dirNames = packages.map((p) => path.basename(path.dirname(p)));
  for (const { normalized, names } of findHyphenVariantCollisions(dirNames)) {
    console.error(
      `❌ agent-skill names differ only by hyphenation: ${names.join(', ')} ` +
        `(both normalize to "${normalized}")`
    );
    success = false;
  }

  return success;
}

if (isDirectRun(import.meta.url)) {
  const ok = await validateAgentSkills();
  if (!ok) {
    process.exitCode = 1;
  }
}
