import { loadSkills as _loadSkills } from './skill-loader.mjs';

// Module-level cache: serialized options key → resolved SkillDefinition[]
// Prevents redundant disk I/O when the same skillsDir is loaded multiple
// times in a single process (e.g. agent-skill-bridge calls loadSkills twice
// with identical options).
const cache = new Map();

function cacheKey(options) {
  const { skillsDir, schemaPath, excludedTags } = options ?? {};
  return JSON.stringify({
    skillsDir: skillsDir ?? null,
    schemaPath: schemaPath ?? null,
    excludedTags: excludedTags ? [...excludedTags].sort() : null,
  });
}

/**
 * Load skills with in-process memoization.
 * Identical calls within the same process return the cached result without
 * re-reading the filesystem. Call {@link clearSkillCache} between test cases
 * or whenever fresh data is needed.
 *
 * @param {import('./skill-loader.mjs').LoadSkillsOptions} [options]
 * @returns {Promise<import('./skill-loader.mjs').SkillDefinition[]>}
 */
export async function loadSkillsCached(options = {}) {
  const key = cacheKey(options);
  if (cache.has(key)) return cache.get(key);
  const skills = await _loadSkills(options);
  cache.set(key, skills);
  return skills;
}

/**
 * Evict all cached entries.
 * Call this in tests or when skill files on disk may have changed.
 */
export function clearSkillCache() {
  cache.clear();
}

/**
 * Number of distinct option sets currently cached.
 * Primarily for testing; not intended for production use.
 */
export function skillCacheSize() {
  return cache.size;
}
