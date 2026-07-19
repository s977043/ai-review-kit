import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createSkillValidator,
  defaultPaths,
  loadSchema,
  loadSkillFile,
  loadSkills,
  loadSkillMetadata,
  loadAllSkillMetadata,
  loadRegistry,
  loadRecommendationSets,
  resolveRecommendationSet,
  selectPacks,
  selectRecommendationSets,
  SkillLoaderError,
} from '../runners/core/skill-loader.mjs';
import { withTempDir, createTempDirAsync } from './helpers/temp-dir.mjs';

const TMP_PREFIX = 'skill-loader-';

async function buildValidator(schemaPath = defaultPaths.schemaPath) {
  const schema = await loadSchema(schemaPath);
  return createSkillValidator(schema);
}

async function createTempSkillDir() {
  return createTempDirAsync({ prefix: TMP_PREFIX });
}

test('loads existing sample skill with declared outputKind', async () => {
  const validator = await buildValidator();
  const skillPath = path.join(defaultPaths.skillsDir, 'midstream/hello-skill/SKILL.md');
  const loaded = await loadSkillFile(skillPath, { validator });

  assert.equal(loaded.metadata.id, 'hello-skill');
  assert.equal(loaded.metadata.category, 'midstream');
  assert.deepEqual(loaded.metadata.outputKind, ['findings', 'summary']);
  assert.ok(loaded.body.trim().length > 0);
});

test('loads skill with extended metadata fields', async () => {
  const validator = await buildValidator();
  const tmpDir = await createTempSkillDir();
  const skillPath = path.join(tmpDir, 'with-extensions.md');
  const content = `---
id: newmeta
name: 'Extended Metadata Skill'
description: 'Uses new metadata fields for loader'
category: downstream
phase: downstream
applyTo:
  - 'src/**/*.ts'
inputContext:
  - diff
  - commitMessage
outputKind:
  - summary
  - actions
modelHint: high-accuracy
dependencies:
  - code_search
  - custom:embedding
---
Body content
`;
  await writeFile(skillPath, content, 'utf8');

  const loaded = await loadSkillFile(skillPath, { validator });
  assert.equal(loaded.metadata.category, 'downstream');
  assert.deepEqual(loaded.metadata.inputContext, ['diff', 'commitMessage']);
  assert.deepEqual(loaded.metadata.outputKind, ['summary', 'actions']);
  assert.equal(loaded.metadata.modelHint, 'high-accuracy');
  assert.deepEqual(loaded.metadata.dependencies, ['code_search', 'custom:embedding']);
});

test('loads skill with trigger container and normalizes phase/applyTo', async () => {
  const validator = await buildValidator();
  const tmpDir = await createTempSkillDir();
  const skillPath = path.join(tmpDir, 'with-trigger.md');
  const content = `---
id: trigger
name: 'Trigger Skill'
description: 'Uses trigger container for activation'
category: midstream
trigger:
  phase: midstream
  files:
    - 'src/**/*.ts'
---
Body content
`;
  await writeFile(skillPath, content, 'utf8');

  const loaded = await loadSkillFile(skillPath, { validator });
  assert.equal(loaded.metadata.phase, 'midstream');
  assert.deepEqual(loaded.metadata.applyTo, ['src/**/*.ts']);
});

test('trigger does not override top-level phase/applyTo', async () => {
  const validator = await buildValidator();
  const tmpDir = await createTempSkillDir();
  const skillPath = path.join(tmpDir, 'with-trigger-precedence.md');
  const content = `---
id: trigger
name: 'Trigger Precedence Skill'
description: 'Top-level values win over trigger'
category: midstream
phase: midstream
applyTo:
  - 'src/**/*.ts'
trigger:
  phase: upstream
  applyTo:
    - 'should-not-win/**'
---
Body content
`;
  await writeFile(skillPath, content, 'utf8');

  const loaded = await loadSkillFile(skillPath, { validator });
  assert.equal(loaded.metadata.phase, 'midstream');
  assert.deepEqual(loaded.metadata.applyTo, ['src/**/*.ts']);
  assert.strictEqual(loaded.metadata.trigger, undefined);
});

test('normalizes path_patterns aliases and prefers category for phase resolution', async () => {
  const validator = await buildValidator();
  await withTempDir(async (tmpDir) => {
    const skillPath = path.join(tmpDir, 'with-path-patterns.md');
    const content = `---
id: path-patterns
name: 'Path Pattern Skill'
description: 'Uses path_patterns aliases'
category: midstream
path_patterns:
  - 'src/**/*'
trigger:
  phase: upstream
  path_patterns:
    - 'docs/**/*.md'
---
Body content
`;
    await writeFile(skillPath, content, 'utf8');

    const loaded = await loadSkillFile(skillPath, { validator });
    assert.equal(loaded.metadata.category, 'midstream');
    assert.equal(loaded.metadata.phase, 'midstream');
    assert.deepEqual(loaded.metadata.applyTo, ['src/**/*']);
  });
});

test('derives category from phase and trigger paths when category is missing', async () => {
  const validator = await buildValidator();
  await withTempDir(async (tmpDir) => {
    const skillPath = path.join(tmpDir, 'derive-category.md');
    const content = `---
id: derived
name: 'Derived Category Skill'
description: 'Relies on trigger for applyTo'
phase:
  - upstream
  - midstream
  - downstream
trigger:
  phase: downstream
  path_patterns:
    - 'tests/**/*.ts'
---
Body content
`;
    await writeFile(skillPath, content, 'utf8');

    const loaded = await loadSkillFile(skillPath, { validator });
    assert.equal(loaded.metadata.category, 'core');
    assert.deepEqual(loaded.metadata.phase, ['upstream', 'midstream', 'downstream']);
    assert.deepEqual(loaded.metadata.applyTo, ['tests/**/*.ts']);
  });
});

test('fails when dependencies contain unsupported values', async () => {
  const validator = await buildValidator();
  const tmpDir = await createTempSkillDir();
  const skillPath = path.join(tmpDir, 'invalid-deps.md');
  const content = `---
id: invalid-deps
name: 'Invalid deps'
description: 'Contains unsupported dependency'
phase: upstream
applyTo:
  - 'src/**/*.ts'
dependencies:
  - unknown_tool
---
`;
  await writeFile(skillPath, content, 'utf8');

  await assert.rejects(loadSkillFile(skillPath, { validator }), (err) => {
    assert.match(err.message, /validation failed/i);
    return true;
  });
});

test('fails validation when required fields are missing', async () => {
  const validator = await buildValidator();
  const tmpDir = await createTempSkillDir();
  const skillPath = path.join(tmpDir, 'invalid-skill.md');
  const content = `---
id: missing-applyto
name: 'Invalid Skill'
description: 'Missing applyTo field'
phase: upstream
---
Body
`;
  await writeFile(skillPath, content, 'utf8');

  await assert.rejects(loadSkillFile(skillPath, { validator }), (err) => {
    assert.match(err.message, /applyTo/i);
    return true;
  });
});

test('loadSkills skips files that fail validation and continues', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const validPath = path.join(tmpDir, 'valid.md');
    const invalidPath = path.join(tmpDir, 'invalid.md');
    await writeFile(
      validPath,
      `---
id: valid
name: Valid Skill
description: Valid metadata
phase: upstream
applyTo:
  - 'src/**/*.ts'
---
Valid body
`
    );
    await writeFile(
      invalidPath,
      `---
id: invalid
name: Invalid Skill
description: Missing applyTo
phase: upstream
---
Body
`
    );

    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const loaded = await loadSkills({ skillsDir: tmpDir, validator });
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].metadata.id, 'valid');
      assert.ok(errors.some((line) => line.includes('Failed to load skill')));
    } finally {
      console.error = originalError;
    }
  });
});

test('loadSkills prefers the first file when duplicate ids are found', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const firstPath = path.join(tmpDir, 'a-first.md');
    const secondPath = path.join(tmpDir, 'b-second.md');
    await writeFile(
      firstPath,
      `---
id: dup
name: First copy
description: First version
phase: midstream
applyTo:
  - 'src/**/*.ts'
---
First body
`
    );
    await writeFile(
      secondPath,
      `---
id: dup
name: Second copy
description: Second version
phase: midstream
applyTo:
  - 'src/**/*.ts'
---
Second body
`
    );

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const loaded = await loadSkills({ skillsDir: tmpDir, validator });
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].metadata.name, 'First copy');
      assert.ok(warnings.some((line) => line.includes('Duplicate skill id "dup"')));
    } finally {
      console.warn = originalWarn;
    }
  });
});

test('loadSkills excludes skills with filtered tags by default', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const keptPath = path.join(tmpDir, 'kept.md');
    const agentPath = path.join(tmpDir, 'agent.md');
    await writeFile(
      keptPath,
      `---
id: keep
name: Kept Skill
description: Visible skill
phase: midstream
applyTo:
  - 'src/**/*.ts'
---
Body
`
    );
    await writeFile(
      agentPath,
      `---
id: agent
name: Agent Skill
description: Should be excluded by default
phase: midstream
applyTo:
  - 'src/**/*.ts'
tags: [agent]
---
Agent body
`
    );

    const defaultLoaded = await loadSkills({ skillsDir: tmpDir, validator });
    assert.equal(defaultLoaded.length, 1);
    assert.equal(defaultLoaded[0].metadata.id, 'keep');

    const allLoaded = await loadSkills({ skillsDir: tmpDir, validator, excludedTags: [] });
    const ids = allLoaded.map((s) => s.metadata.id);
    assert.deepEqual(ids.sort(), ['agent', 'keep']);
  });
});

test('loadSkills loads all skill files under default directory', async () => {
  const validator = await buildValidator();
  const loaded = await loadSkills({ validator });
  assert.ok(loaded.length >= 3);
  for (const skill of loaded) {
    assert.ok(Array.isArray(skill.metadata.outputKind));
    assert.ok(skill.metadata.outputKind.length >= 1);
  }
});

test('loadSkillMetadata returns only {metadata, path} without body', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const skillPath = path.join(tmpDir, 'metadata-only.md');
    await writeFile(
      skillPath,
      `---
id: metadata-only
name: Metadata Only Skill
description: Progressive disclosure stage 1 target
phase: midstream
applyTo:
  - 'src/**/*.ts'
---
This body text should not be returned
`
    );

    const loaded = await loadSkillMetadata(skillPath, { validator });
    assert.deepEqual(Object.keys(loaded).sort(), ['metadata', 'path']);
    assert.equal(loaded.metadata.id, 'metadata-only');
    assert.equal(loaded.path, skillPath);
    assert.ok(!('body' in loaded), 'body property must not be present');
  });
});

test('loadAllSkillMetadata excludes skills tagged "agent" by default', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const keptPath = path.join(tmpDir, 'kept.md');
    const agentPath = path.join(tmpDir, 'agent.md');
    await writeFile(
      keptPath,
      `---
id: meta-keep
name: Kept Skill
description: Visible skill
phase: midstream
applyTo:
  - 'src/**/*.ts'
---
Body
`
    );
    await writeFile(
      agentPath,
      `---
id: meta-agent
name: Agent Skill
description: Should be excluded by default
phase: midstream
applyTo:
  - 'src/**/*.ts'
tags: [agent]
---
Agent body
`
    );

    const defaultLoaded = await loadAllSkillMetadata({ skillsDir: tmpDir, validator });
    assert.equal(defaultLoaded.length, 1);
    assert.equal(defaultLoaded[0].metadata.id, 'meta-keep');
    assert.ok(!('body' in defaultLoaded[0]));

    const allLoaded = await loadAllSkillMetadata({
      skillsDir: tmpDir,
      validator,
      excludedTags: [],
    });
    const ids = allLoaded.map((s) => s.metadata.id).sort();
    assert.deepEqual(ids, ['meta-agent', 'meta-keep']);
  });
});

test('loadSkillMetadata and loadAllSkillMetadata skip duplicate ids with a warning', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const firstPath = path.join(tmpDir, 'a-first.md');
    const secondPath = path.join(tmpDir, 'b-second.md');
    const body = (name) => `---
id: meta-dup
name: ${name}
description: Duplicate id check
phase: midstream
applyTo:
  - 'src/**/*.ts'
---
Body
`;
    await writeFile(firstPath, body('First copy'));
    await writeFile(secondPath, body('Second copy'));

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const loaded = await loadAllSkillMetadata({ skillsDir: tmpDir, validator });
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].metadata.name, 'First copy');
      assert.ok(
        warnings.some((line) => line.includes('Duplicate skill id "meta-dup"')),
        'duplicate warning must be emitted'
      );
    } finally {
      console.warn = originalWarn;
    }

    // loadSkillMetadata (single file) succeeds independently and has no body.
    const singleFirst = await loadSkillMetadata(firstPath, { validator });
    const singleSecond = await loadSkillMetadata(secondPath, { validator });
    assert.equal(singleFirst.metadata.id, 'meta-dup');
    assert.equal(singleSecond.metadata.id, 'meta-dup');
    assert.ok(!('body' in singleFirst));
    assert.ok(!('body' in singleSecond));
  });
});

test('loadRecommendationSets exposes named bundles from the registry', async () => {
  const sets = await loadRecommendationSets();
  assert.ok(sets.basic, 'basic set must exist');
  assert.ok(Array.isArray(sets.basic.skills));
  assert.ok(sets.basic.skills.includes('security-basic'));
});

test('resolveRecommendationSet returns the skill ids for a known set', async () => {
  const ids = await resolveRecommendationSet('basic');
  assert.deepEqual(ids, ['security-basic', 'logging-observability']);
});

test('resolveRecommendationSet resolves the pre-exec gate set (#976)', async () => {
  const ids = await resolveRecommendationSet('pre-exec');
  assert.deepEqual(ids, [
    'requirements-acceptance',
    'architecture-validation-plan',
    'plangate-plan-integrity',
  ]);
});

test('resolveRecommendationSet throws SkillLoaderError for an unknown set', async () => {
  await assert.rejects(
    () => resolveRecommendationSet('does-not-exist'),
    (err) => {
      assert.ok(err instanceof SkillLoaderError);
      assert.match(err.message, /Unknown skill set "does-not-exist"/);
      assert.match(err.message, /Available sets:/);
      return true;
    }
  );
});

test('loadRecommendationSets returns {} when registry is absent', async () => {
  await withTempDir(
    async (tmpDir) => {
      const sets = await loadRecommendationSets({ skillsDir: tmpDir });
      assert.deepEqual(sets, {});
    },
    { prefix: TMP_PREFIX }
  );
});

test('loadRegistry returns the parsed document for the real registry', async () => {
  const result = await loadRegistry();
  assert.equal(result.ok, true);
  assert.ok(result.parsed && typeof result.parsed === 'object');
  assert.ok(Array.isArray(result.parsed.skills), 'skills: must be an array');
  assert.ok(result.registryPath.endsWith(path.join('skills', 'registry.yaml')));
});

test('loadRegistry reports a read failure when registry.yaml is absent', async () => {
  await withTempDir(
    async (tmpDir) => {
      const result = await loadRegistry({ skillsDir: tmpDir });
      assert.equal(result.ok, false);
      assert.equal(result.phase, 'read');
      assert.ok(result.registryPath.endsWith('registry.yaml'));
    },
    { prefix: TMP_PREFIX }
  );
});

test('loadRegistry reports a parse failure on malformed YAML', async () => {
  await withTempDir(
    async (tmpDir) => {
      await writeFile(path.join(tmpDir, 'registry.yaml'), 'skills: [\n', 'utf8');
      const result = await loadRegistry({ skillsDir: tmpDir });
      assert.equal(result.ok, false);
      assert.equal(result.phase, 'parse');
      assert.ok(typeof result.message === 'string' && result.message.length > 0);
    },
    { prefix: TMP_PREFIX }
  );
});

test('loadRegistry normalizes a null document to an empty object', async () => {
  await withTempDir(
    async (tmpDir) => {
      // An explicit YAML null document (`~`) parses to null; loadRegistry
      // normalizes it to {} via `?? {}`. (A zero-byte/comment-only file is a
      // js-yaml parse error, reported as phase: 'parse' — the historical
      // behavior of loadPacks/loadRecommendationSets.)
      await writeFile(path.join(tmpDir, 'registry.yaml'), '~\n', 'utf8');
      const result = await loadRegistry({ skillsDir: tmpDir });
      assert.equal(result.ok, true);
      assert.deepEqual(result.parsed, {});
    },
    { prefix: TMP_PREFIX }
  );
});

test('selectPacks / selectRecommendationSets project registry sections', async () => {
  const parsed = {
    packs: [{ id: 'p1', skills: ['a'] }, { notId: true }, 'bogus'],
    recommendations: { basic: { skills: ['a'] } },
  };
  assert.deepEqual(
    selectPacks(parsed).map((p) => p.id),
    ['p1']
  );
  assert.deepEqual(selectRecommendationSets(parsed), { basic: { skills: ['a'] } });
  // Defensive defaults for missing / malformed sections.
  assert.deepEqual(selectPacks({}), []);
  assert.deepEqual(selectRecommendationSets({}), {});
  assert.deepEqual(selectPacks(null), []);
  assert.deepEqual(selectRecommendationSets(null), {});
});

test('respects explicit multi-phase array when category is a stream value', async () => {
  await withTempDir(async (tmpDir) => {
    const validator = await buildValidator();
    const skillPath = path.join(tmpDir, 'multi-phase.md');
    const content = `---
id: multi-phase
name: 'Multi Phase Skill'
description: 'Active in upstream and midstream'
category: upstream
phase:
  - upstream
  - midstream
applyTo:
  - 'docs/**/*'
---
Body
`;
    await writeFile(skillPath, content, 'utf8');
    const loaded = await loadSkillFile(skillPath, { validator });
    assert.deepEqual(loaded.metadata.phase, ['upstream', 'midstream']);
    assert.equal(loaded.metadata.category, 'upstream');
  });
});
