import { loadSkills as _loadSkills } from './skill-loader.mjs';

// Module-level cache: serialized options key → Promise<SkillDefinition[]>
// Caching the promise prevents thundering-herd: concurrent callers with the
// same key await the same in-flight promise rather than launching duplicates.
// Prevents redundant disk I/O when the same skillsDir is loaded multiple
// times in a single process (e.g. agent-skill-bridge calls loadSkills twice
// with identical options).
//
// Safety bound: evict the oldest entry when the cache exceeds MAX_ENTRIES.
// In practice the number of distinct option sets is very small (< 5), so this
// bound is only a safeguard against unbounded growth in unusual scenarios.
const MAX_ENTRIES = 50;
const cache = new Map();

function evictIfNeeded() {
  if (cache.size >= MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

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
 * If a custom `validator` function is supplied, the cache is bypassed because
 * functions cannot be serialised into a stable key.
 *
 * @param {{ skillsDir?: string, schemaPath?: string, excludedTags?: string[], validator?: Function }} [options]
 * @returns {Promise<SkillDefinition[]>}
 */
export async function loadSkillsCached(options = {}) {
  // Bypass cache when a custom validator is provided — functions are not
  // serialisable, so two calls with different validators would collide on
  // the same key even though their results may differ.
  if (options.validator) {
    return _loadSkills(options);
  }

  const key = cacheKey(options);
  if (cache.has(key)) return cache.get(key);

  evictIfNeeded();
  const promise = _loadSkills(options).catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, promise);
  return promise;
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
