import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkillsCached, clearSkillCache, skillCacheSize } from '../runners/core/skill-cache.mjs';

const SKILL_YAML = `---
id: cache-test-skill
name: Cache Test Skill
description: Used by skill-cache tests
phase: midstream
applyTo:
  - 'src/**/*.ts'
inputContext:
  - diff
outputKind:
  - findings
modelHint: cheap
severity: minor
---
Review the diff for cache test issues.
`;

function makeSkillDir() {
  const root = mkdtempSync(join(tmpdir(), 'skill-cache-test-'));
  const skillDir = join(root, 'skills', 'midstream', 'cache-test-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), SKILL_YAML);
  return { root, skillsDir: join(root, 'skills') };
}

describe('skill-cache', () => {
  let skillsDir;
  let root;

  before(() => {
    ({ root, skillsDir } = makeSkillDir());
    clearSkillCache();
  });

  after(() => {
    clearSkillCache();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns skills on first call', async () => {
    const skills = await loadSkillsCached({ skillsDir, excludedTags: [] });
    assert.ok(Array.isArray(skills), 'returns array');
    assert.ok(skills.length > 0, 'at least one skill loaded');
    assert.ok(
      skills.some((s) => s.metadata.id === 'cache-test-skill'),
      'test skill present'
    );
  });

  it('second call with same options returns cached result (same array reference)', async () => {
    const first = await loadSkillsCached({ skillsDir, excludedTags: [] });
    const second = await loadSkillsCached({ skillsDir, excludedTags: [] });
    assert.strictEqual(first, second, 'same array reference returned from cache');
  });

  it('cache size reflects distinct option sets', async () => {
    clearSkillCache();
    assert.equal(skillCacheSize(), 0, 'starts empty after clear');
    await loadSkillsCached({ skillsDir, excludedTags: [] });
    assert.equal(skillCacheSize(), 1, 'one entry after first load');
    await loadSkillsCached({ skillsDir, excludedTags: [] });
    assert.equal(skillCacheSize(), 1, 'still one entry on repeat call');
  });

  it('different excludedTags produces separate cache entries', async () => {
    clearSkillCache();
    await loadSkillsCached({ skillsDir, excludedTags: [] });
    await loadSkillsCached({ skillsDir, excludedTags: ['agent'] });
    assert.equal(skillCacheSize(), 2, 'two entries for different excludedTags');
  });

  it('clearSkillCache evicts all entries', async () => {
    await loadSkillsCached({ skillsDir, excludedTags: [] });
    assert.ok(skillCacheSize() > 0, 'cache has entries before clear');
    clearSkillCache();
    assert.equal(skillCacheSize(), 0, 'cache empty after clear');
  });

  it('custom validator bypasses cache (no entry added)', async () => {
    clearSkillCache();
    const customValidator = () => true;
    await loadSkillsCached({ skillsDir, excludedTags: [], validator: customValidator });
    assert.equal(skillCacheSize(), 0, 'validator bypass must not pollute the cache');
  });

  it('rejected load removes the cache entry so the next call retries', async () => {
    clearSkillCache();
    const nonExistentDir = join(root, '__nonexistent_skills_subdir__');
    await assert.rejects(
      () => loadSkillsCached({ skillsDir: nonExistentDir, excludedTags: [] }),
      'rejected load should throw'
    );
    assert.equal(skillCacheSize(), 0, 'rejected entry must be evicted from cache');
    await assert.rejects(
      () => loadSkillsCached({ skillsDir: nonExistentDir, excludedTags: [] }),
      'second call should also reject (not return stale rejected promise)'
    );
  });
});
