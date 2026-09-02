import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
  discoverAgentSkillPaths,
  parseAgentSkill,
  generateAgentSkillId,
  convertAgentSkillToRR,
  importAgentSkills,
  serializeToSkillMd,
  exportSkillToAgentFormat,
  listAllSkills,
  sanitizeSkillId,
} from '../src/lib/agent-skill-bridge.mjs';
import { parseFrontMatter, defaultPaths } from '../runners/core/skill-loader.mjs';

const fixturesDir = path.join(defaultPaths.repoRoot, 'tests', 'fixtures', 'agent-skills');

async function withTempDir(fn) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'as-bridge-'));
  try {
    return await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// parseAgentSkill
// ---------------------------------------------------------------------------

test('parseAgentSkill parses minimal SKILL.md correctly', async () => {
  const skillPath = path.join(fixturesDir, 'minimal-skill', 'SKILL.md');
  const parsed = await parseAgentSkill(skillPath);

  assert.equal(parsed.metadata.name, 'minimal-skill');
  assert.equal(parsed.metadata.description, 'A minimal agent skill without id or category');
  assert.ok(parsed.body.includes('Minimal Skill'));
  assert.equal(parsed.dirPath, path.join(fixturesDir, 'minimal-skill'));
});

test('parseAgentSkill parses rich SKILL.md with extra metadata', async () => {
  const skillPath = path.join(fixturesDir, 'rich-skill', 'SKILL.md');
  const parsed = await parseAgentSkill(skillPath);

  assert.equal(parsed.metadata.name, 'rich-skill');
  assert.equal(parsed.metadata.description, 'A rich agent skill with extra metadata');
  assert.ok(parsed.body.includes('Rich Skill'));
  assert.ok(parsed.assets.references, 'should detect references/ directory');
});

// ---------------------------------------------------------------------------
// generateAgentSkillId
// ---------------------------------------------------------------------------

test('generates id from directory name when no id exists', () => {
  const id = generateAgentSkillId('my-skill', new Set());
  assert.equal(id, 'as-my-skill');
});

test('appends suffix on id collision', () => {
  const existing = new Set(['as-my-skill']);
  const id = generateAgentSkillId('my-skill', existing);
  assert.equal(id, 'as-my-skill-2');
});

test('increments suffix on repeated collisions', () => {
  const existing = new Set(['as-my-skill', 'as-my-skill-2', 'as-my-skill-3']);
  const id = generateAgentSkillId('my-skill', existing);
  assert.equal(id, 'as-my-skill-4');
});

// ---------------------------------------------------------------------------
// convertAgentSkillToRR
// ---------------------------------------------------------------------------

test('converts minimal agent skill – fills id, category, phase, applyTo', async () => {
  const skillPath = path.join(fixturesDir, 'minimal-skill', 'SKILL.md');
  const parsed = await parseAgentSkill(skillPath);
  const converted = convertAgentSkillToRR(parsed);

  assert.equal(converted.metadata.id, 'as-minimal-skill');
  assert.equal(converted.metadata.category, 'core');
  assert.deepEqual(converted.metadata.phase, ['upstream', 'midstream', 'downstream']);
  assert.deepEqual(converted.metadata.applyTo, ['**/*']);
  assert.equal(converted.metadata.metadata.source, 'agent');
  assert.ok(converted.body.includes('Minimal Skill'));
});

test('converts rich agent skill – preserves extra metadata', async () => {
  const skillPath = path.join(fixturesDir, 'rich-skill', 'SKILL.md');
  const parsed = await parseAgentSkill(skillPath);
  const converted = convertAgentSkillToRR(parsed);

  assert.equal(converted.metadata.id, 'as-rich-skill');
  assert.equal(converted.metadata.metadata.source, 'agent');
  // version is a known RR field – stays at top level
  assert.equal(converted.metadata.version, '1.2.0');
  // Non-RR fields moved to metadata
  assert.equal(converted.metadata.metadata.author, 'Test Author');
  assert.equal(converted.metadata.metadata.license, 'MIT');
  // Tags remain at top level (known RR field)
  assert.deepEqual(converted.metadata.tags, ['security', 'review']);
});

test('preserves explicitly provided category, phase, and applyTo', async () => {
  await withTempDir(async (tmpDir) => {
    const skillDir = path.join(tmpDir, 'explicit-fields');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: explicit-fields
description: Skill with explicit fields
category: downstream
phase: downstream
applyTo:
  - 'src/**/*.ts'
---
Body
`
    );
    const parsed = await parseAgentSkill(path.join(skillDir, 'SKILL.md'));
    const converted = convertAgentSkillToRR(parsed);
    assert.equal(converted.metadata.category, 'downstream');
    assert.equal(converted.metadata.phase, 'downstream');
    assert.deepEqual(converted.metadata.applyTo, ['src/**/*.ts']);
  });
});

test('uses existing id from frontmatter when present', async () => {
  await withTempDir(async (tmpDir) => {
    const skillDir = path.join(tmpDir, 'custom-id');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: custom-id
description: Has its own id
id: my-custom-id
---
Body content
`
    );
    const parsed = await parseAgentSkill(path.join(skillDir, 'SKILL.md'));
    const converted = convertAgentSkillToRR(parsed);
    assert.equal(converted.metadata.id, 'my-custom-id');
  });
});

// ---------------------------------------------------------------------------
// discoverAgentSkillPaths
// ---------------------------------------------------------------------------

test('discovers SKILL.md from .agents/skills directory', async () => {
  await withTempDir(async (tmpDir) => {
    const skillDir = path.join(tmpDir, '.agents', 'skills', 'test-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: Test skill
---
Body
`
    );

    const paths = await discoverAgentSkillPaths(tmpDir);
    assert.equal(paths.length, 1);
    assert.ok(paths[0].endsWith('SKILL.md'));
  });
});

test('discovers SKILL.md from explicit --from path', async () => {
  const paths = await discoverAgentSkillPaths('/nonexistent', fixturesDir);
  assert.ok(paths.length >= 2, `Expected >= 2 SKILL.md files, got ${paths.length}`);
});

test('returns empty array when no skills found', async () => {
  await withTempDir(async (tmpDir) => {
    const paths = await discoverAgentSkillPaths(tmpDir);
    assert.equal(paths.length, 0);
  });
});

// ---------------------------------------------------------------------------
// importAgentSkills
// ---------------------------------------------------------------------------

test('imports agent skills in loose mode with auto-fill warnings', async () => {
  await withTempDir(async (tmpDir) => {
    const result = await importAgentSkills(tmpDir, {
      fromPath: fixturesDir,
      strict: false,
      outputDir: path.join(tmpDir, 'output'),
    });

    assert.ok(result.imported.length >= 2, `Expected >= 2 imported, got ${result.imported.length}`);
    assert.equal(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
    assert.ok(result.warnings.length > 0, 'Expected auto-fill warnings');
  });
});

test('imports agent skills in strict mode (after auto-fill, should pass)', async () => {
  await withTempDir(async (tmpDir) => {
    const result = await importAgentSkills(tmpDir, {
      fromPath: fixturesDir,
      strict: true,
      outputDir: path.join(tmpDir, 'output'),
    });

    assert.ok(result.imported.length >= 2, `Expected >= 2 imported, got ${result.imported.length}`);
    assert.equal(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
  });
});

test('import writes SKILL.md files to output directory', async () => {
  await withTempDir(async (tmpDir) => {
    const outputDir = path.join(tmpDir, 'output');
    await importAgentSkills(tmpDir, {
      fromPath: fixturesDir,
      strict: false,
      outputDir,
    });

    // Check that at least one SKILL.md was written
    const entries = await readdir(outputDir);
    assert.ok(entries.length >= 2, `Expected >= 2 skill dirs, got ${entries.length}`);

    // Verify one of them is readable
    const firstSkillMd = path.join(outputDir, entries[0], 'SKILL.md');
    const content = await readFile(firstSkillMd, 'utf8');
    assert.ok(content.includes('---'), 'Should contain frontmatter');
  });
});

// ---------------------------------------------------------------------------
// serializeToSkillMd (Export)
// ---------------------------------------------------------------------------

test('serializes RR skill to Agent Skills SKILL.md format', () => {
  const skill = {
    metadata: {
      id: 'example',
      name: 'Example Skill',
      description: 'An example skill',
      category: 'midstream',
      phase: 'midstream',
      applyTo: ['src/**/*.ts'],
      severity: 'minor',
    },
    body: '# Example\n\nReview instructions here.',
    path: '/some/path/example.md',
  };

  const output = serializeToSkillMd(skill);

  assert.ok(output.startsWith('---\n'));
  assert.ok(output.includes('name:'));
  assert.ok(output.includes('description:'));
  assert.ok(output.includes('metadata:'));
  assert.ok(output.includes('rr:'));
  assert.ok(output.includes('Review instructions here.'));
  // RR-specific fields should be under metadata.rr, not top-level
  const { metadata: fm } = parseFrontMatter(output);
  assert.equal(fm.name, 'Example Skill');
  assert.equal(fm.description, 'An example skill');
  assert.ok(fm.metadata?.rr?.id === 'example');
});

// ---------------------------------------------------------------------------
// exportSkillToAgentFormat
// ---------------------------------------------------------------------------

test('exports RR skill to directory with SKILL.md', async () => {
  await withTempDir(async (tmpDir) => {
    const skill = {
      metadata: {
        id: 'export',
        name: 'Export Test',
        description: 'A test for export',
        category: 'midstream',
        phase: 'midstream',
        applyTo: ['**/*.js'],
      },
      body: '# Export Test\n\nInstructions.',
      path: path.join(os.tmpdir(), 'fake.md'),
    };

    const result = await exportSkillToAgentFormat(skill, tmpDir);
    assert.ok(result.path.endsWith('SKILL.md'));

    const content = await readFile(result.path, 'utf8');
    assert.ok(content.includes('Export Test'));
    assert.ok(content.includes('Instructions.'));
  });
});

// ---------------------------------------------------------------------------
// Round-trip: export → re-import
// ---------------------------------------------------------------------------

test('round-trip: export then re-import preserves name, description, body', async () => {
  await withTempDir(async (tmpDir) => {
    const original = {
      metadata: {
        id: 'rr-roundtrip-001',
        name: 'Round Trip Skill',
        description: 'Verify round-trip fidelity',
        category: 'downstream',
        phase: 'downstream',
        applyTo: ['tests/**/*.ts'],
        severity: 'major',
      },
      body: '# Round Trip\n\nThis body must survive the round trip.',
      path: path.join(os.tmpdir(), 'roundtrip.md'),
    };

    // Export
    const exportDir = path.join(tmpDir, 'exported');
    await exportSkillToAgentFormat(original, exportDir);

    // Re-import
    const reimported = await parseAgentSkill(path.join(exportDir, 'rr-roundtrip-001', 'SKILL.md'));

    assert.equal(reimported.metadata.name, original.metadata.name);
    assert.equal(reimported.metadata.description, original.metadata.description);
    assert.ok(reimported.body.includes('This body must survive the round trip.'));
  });
});

// ---------------------------------------------------------------------------
// listAllSkills
// ---------------------------------------------------------------------------

test('listAllSkills returns RR skills with source=rr', async () => {
  const result = await listAllSkills(defaultPaths.repoRoot, { source: 'rr' });
  assert.ok(result.skills.length > 0);
  for (const s of result.skills) {
    assert.equal(s.source, 'rr');
  }
});

// ---------------------------------------------------------------------------
// sanitizeSkillId
// ---------------------------------------------------------------------------

test('sanitizeSkillId passes through valid ids unchanged', () => {
  assert.equal(sanitizeSkillId('my-skill'), 'my-skill');
  assert.equal(sanitizeSkillId('as-test.v2'), 'as-test.v2');
  assert.equal(sanitizeSkillId('Skill_001'), 'Skill_001');
});

test('sanitizeSkillId strips shell expansion characters', () => {
  assert.equal(sanitizeSkillId('skill$(whoami)'), 'skillwhoami');
  assert.equal(sanitizeSkillId('skill`id`'), 'skillid');
  assert.equal(sanitizeSkillId('skill;rm -rf /'), 'skillrm-rf');
});

test('sanitizeSkillId strips path separators', () => {
  assert.equal(sanitizeSkillId('skill/name'), 'skillname');
  assert.equal(sanitizeSkillId('skill\\name'), 'skillname');
});

test('sanitizeSkillId strips NUL and control characters', () => {
  assert.equal(sanitizeSkillId('skill\x00name'), 'skillname');
  assert.equal(sanitizeSkillId('skill\x01\x02'), 'skill');
});

test('sanitizeSkillId returns unnamed-skill for empty/invalid input', () => {
  assert.equal(sanitizeSkillId(''), 'unnamed-skill');
  assert.equal(sanitizeSkillId(null), 'unnamed-skill');
  assert.equal(sanitizeSkillId(undefined), 'unnamed-skill');
  assert.equal(sanitizeSkillId('$()'), 'unnamed-skill');
});

test('sanitizeSkillId strips leading dots/dashes', () => {
  assert.equal(sanitizeSkillId('..hidden'), 'hidden');
  assert.equal(sanitizeSkillId('---dashed'), 'dashed');
  assert.equal(sanitizeSkillId('..-mixed'), 'mixed');
});

test('convertAgentSkillToRR sanitizes malicious id from frontmatter', async () => {
  await withTempDir(async (tmpDir) => {
    const skillDir = path.join(tmpDir, 'evil-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: evil-skill
description: Skill with malicious id
id: "../../../etc/passwd"
---
Body
`
    );
    const parsed = await parseAgentSkill(path.join(skillDir, 'SKILL.md'));
    const converted = convertAgentSkillToRR(parsed);
    // Path separators and dots at start are stripped
    assert.ok(!converted.metadata.id.includes('/'));
    assert.ok(!converted.metadata.id.includes('..'));
    assert.match(converted.metadata.id, /^[a-zA-Z0-9]/);
  });
});

// ---------------------------------------------------------------------------
// importAgentSkills – error handling
// ---------------------------------------------------------------------------

test('importAgentSkills records malformed SKILL.md in errors and continues', async () => {
  await withTempDir(async (tmpDir) => {
    // One valid skill
    const goodDir = path.join(tmpDir, '.agents', 'skills', 'good-skill');
    await mkdir(goodDir, { recursive: true });
    await writeFile(
      path.join(goodDir, 'SKILL.md'),
      '---\nname: good-skill\ndescription: A valid skill\n---\nBody\n'
    );
    // One malformed skill (no frontmatter)
    const badDir = path.join(tmpDir, '.agents', 'skills', 'bad-skill');
    await mkdir(badDir, { recursive: true });
    await writeFile(path.join(badDir, 'SKILL.md'), 'No frontmatter at all');

    const result = await importAgentSkills(tmpDir, {
      strict: false,
      outputDir: path.join(tmpDir, 'out'),
    });
    assert.equal(
      result.errors.length,
      1,
      `Expected 1 error, got: ${JSON.stringify(result.errors)}`
    );
    assert.equal(result.imported.length, 1, `Expected 1 imported, got: ${result.imported.length}`);
  });
});

// ---------------------------------------------------------------------------
// listAllSkills – deduplication
// ---------------------------------------------------------------------------

test('listAllSkills --source all deduplicates imported agent skills', async () => {
  await withTempDir(async (tmpDir) => {
    // Create a skill in both agent-skills discovery path AND rr skills dir
    const agentDir = path.join(tmpDir, '.agents', 'skills', 'dup-skill');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, 'SKILL.md'),
      '---\nname: dup-skill\ndescription: Duplicate skill\nid: as-dup-skill\n---\nBody\n'
    );

    // Also import it into skills/ (simulating an already-imported state)
    const rrDir = path.join(tmpDir, 'skills', 'agent-skills', 'as-dup-skill');
    await mkdir(rrDir, { recursive: true });
    await writeFile(
      path.join(rrDir, 'SKILL.md'),
      '---\nid: as-dup-skill\nname: dup-skill\ndescription: Duplicate skill\ncategory: core\nphase:\n  - upstream\n  - midstream\n  - downstream\napplyTo:\n  - "**/*"\nmetadata:\n  source: agent\n---\nBody\n'
    );

    const result = await listAllSkills(tmpDir, { source: 'all' });
    const dupEntries = result.skills.filter((s) => s.id === 'as-dup-skill');
    assert.equal(
      dupEntries.length,
      1,
      `Expected 1 entry for as-dup-skill, got ${dupEntries.length}`
    );
    assert.equal(dupEntries[0].source, 'rr', 'RR source should take precedence');
  });
});

test('importAgentSkills detects duplicate explicit ids in the same batch', async () => {
  await withTempDir(async (tmpDir) => {
    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    // Two skills with the same explicit id
    for (const name of ['skill-a', 'skill-b']) {
      const dir = path.join(skillsDir, name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Skill ${name}\nid: same-id\n---\nBody\n`
      );
    }

    const result = await importAgentSkills(tmpDir, {
      strict: false,
      outputDir: path.join(tmpDir, 'out'),
    });
    assert.equal(result.imported.length, 1, 'Only first skill should be imported');
    assert.equal(result.errors.length, 1, 'Second skill should be a duplicate error');
    assert.ok(result.errors[0].message.includes('Duplicate skill id'), result.errors[0].message);
  });
});

test('exportSkillToAgentFormat sanitizes directory name', async () => {
  await withTempDir(async (tmpDir) => {
    const skill = {
      metadata: {
        id: 'safe$(whoami)',
        name: 'Evil Export',
        description: 'Test shell injection in export dir name',
        category: 'core',
        phase: 'midstream',
        applyTo: ['**/*'],
      },
      body: '# Evil Export',
      path: path.join(os.tmpdir(), 'fake.md'),
    };

    const result = await exportSkillToAgentFormat(skill, tmpDir);
    // Directory should not contain shell metacharacters
    assert.ok(!result.path.includes('$('));
    assert.ok(result.path.includes('safewhoami'));
  });
});

// ---------------------------------------------------------------------------
// serializeToSkillMd — golden output (js-yaml dump formatting contract)
// ---------------------------------------------------------------------------
//
// The tests above assert structure only (`includes(...)` / re-parse), so a
// change in how js-yaml renders scalars passes them unnoticed. js-yaml 5.4.0
// did change `dump` (scalar style selection, whitespace-only strings), which
// is why these cases pin the exact bytes `serializeToSkillMd` emits under
// `{ lineWidth: 120, quotingType: "'", noCompatMode: true }`.
//
// Measured 5.3.0 -> 5.4.1 differences that these goldens now catch:
//   - a string longer than lineWidth with no foldable space was emitted as a
//     folded block scalar (`>-`) by 5.3.0 and as a plain scalar by 5.4.1
//     (hits Japanese descriptions, which carry no ASCII spaces)
//   - a whitespace-only string was single-quoted by 5.3.0 and is
//     double-quoted by 5.4.1
//
// If a golden fails after a js-yaml bump, confirm the new bytes still round
// trip through parseFrontMatter, then update the literal deliberately.

const GOLDEN_SKILL_MD_CASES = [
  {
    label: 'typical export: tags, version, and metadata.rr nesting',
    skill: {
      metadata: {
        id: 'example',
        name: 'Example Skill',
        description: 'An example skill',
        category: 'midstream',
        phase: 'midstream',
        applyTo: ['src/**/*.ts'],
        severity: 'minor',
        tags: ['review'],
        version: '1.2.0',
      },
      body: '# Example\n\nReview instructions here.',
    },
    expected: `---
name: Example Skill
description: An example skill
tags:
  - review
version: 1.2.0
metadata:
  rr:
    id: example
    category: midstream
    phase: midstream
    applyTo:
      - src/**/*.ts
    severity: minor
---

# Example

Review instructions here.
`,
  },
  {
    label: 'long Japanese description (no foldable space) stays a plain scalar',
    skill: {
      metadata: {
        id: 'ja-long',
        name: '日本語スキル',
        description: 'これはテストです。'.repeat(20),
        category: 'midstream',
        phase: 'midstream',
      },
      body: '本文',
    },
    expected: `---
name: 日本語スキル
description: これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。これはテストです。
metadata:
  rr:
    id: ja-long
    category: midstream
    phase: midstream
---

本文
`,
  },
  {
    label: 'whitespace-only description is double-quoted',
    skill: {
      metadata: {
        id: 'ws',
        name: 'ws',
        description: '   ',
        category: 'core',
        phase: 'core',
      },
      body: 'B',
    },
    expected: `---
name: ws
description: "   "
metadata:
  rr:
    id: ws
    category: core
    phase: core
---

B
`,
  },
  {
    label: 'long spaced description still folds at lineWidth 120',
    skill: {
      metadata: {
        id: 'fold',
        name: 'fold',
        description: 'lorem ipsum dolor '.repeat(12).trim(),
        category: 'core',
        phase: 'core',
      },
      body: 'B',
    },
    expected: `---
name: fold
description: >-
  lorem ipsum dolor lorem ipsum dolor lorem ipsum dolor lorem ipsum dolor lorem ipsum dolor lorem ipsum dolor lorem
  ipsum dolor lorem ipsum dolor lorem ipsum dolor lorem ipsum dolor lorem ipsum dolor lorem ipsum dolor
metadata:
  rr:
    id: fold
    category: core
    phase: core
---

B
`,
  },
];

for (const { label, skill, expected } of GOLDEN_SKILL_MD_CASES) {
  test(`serializeToSkillMd golden — ${label}`, () => {
    assert.equal(serializeToSkillMd(skill), expected);
    // The golden must also stay semantically loadable, not just byte-stable.
    const { metadata: fm } = parseFrontMatter(expected);
    assert.equal(fm.name, skill.metadata.name);
    assert.equal(fm.description, skill.metadata.description);
  });
}
