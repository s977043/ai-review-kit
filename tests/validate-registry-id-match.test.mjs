/**
 * Tests for validateRegistryIdMatch in scripts/validate-skills.mjs and the
 * strict-schema drift guard validateStrictSchemaDrift in
 * scripts/validate-agent-skills.mjs. Reuses the temp-dir harness pattern from
 * tests/validate-registry-paths.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';

import { validateRegistryIdMatch } from '../scripts/validate-skills.mjs';
import { validateStrictSchemaDrift } from '../scripts/validate-agent-skills.mjs';
import { createTempDirAsync } from './helpers/temp-dir.mjs';

const TMP_PREFIX = 'validate-registry-id-match-';

const SKILL_MD = (id, extraFrontmatter = '') => `---
id: ${id}
name: Skill ${id}
description: test skill
category: midstream
phase: midstream
applyTo:
  - 'src/**/*.ts'
tags: [test, midstream]
severity: minor
inputContext: [diff]
outputKind: [findings]
${extraFrontmatter}---

## Guidance

- test
`;

const registryEntry = (id, skillPath) => `  - id: ${id}
    version: '0.1.0'
    name: 'Skill ${id}'
    path: ${skillPath}
    category: midstream
    phase: midstream
    tags: [test, midstream]
    severity: minor
    recommended: false
    description: 'test skill'
`;

async function buildSkillsDir({ registryYaml, skills = [] }) {
  const dir = await createTempDirAsync({ prefix: TMP_PREFIX });
  for (const { dirName, frontmatterId } of skills) {
    const skillDir = path.join(dir, 'midstream', dirName);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), SKILL_MD(frontmatterId), 'utf8');
  }
  await fs.writeFile(path.join(dir, 'registry.yaml'), registryYaml, 'utf8');
  return dir;
}

test('validateRegistryIdMatch passes when registry id matches the frontmatter id', async () => {
  const dir = await buildSkillsDir({
    registryYaml: `skills:\n${registryEntry('skill-a', 'midstream/skill-a/SKILL.md')}`,
    skills: [{ dirName: 'skill-a', frontmatterId: 'skill-a' }],
  });
  const ok = await validateRegistryIdMatch({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, true);
});

test('validateRegistryIdMatch fails on id mismatch and names both ids and the path', async () => {
  const dir = await buildSkillsDir({
    registryYaml: `skills:\n${registryEntry('skill-a', 'midstream/skill-a/SKILL.md')}`,
    skills: [{ dirName: 'skill-a', frontmatterId: 'skill-renamed' }],
  });
  const errors = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(String(msg));
  let ok;
  try {
    ok = await validateRegistryIdMatch({ skillsDir: dir, repoRoot: dir });
  } finally {
    console.error = originalError;
  }
  assert.equal(ok, false);
  assert.ok(
    errors.some(
      (e) =>
        e.includes('skill-a') &&
        e.includes('skill-renamed') &&
        e.includes('midstream/skill-a/SKILL.md')
    ),
    `expected an error naming the registry id, frontmatter id, and path; got: ${errors.join('\n')}`
  );
});

test('validateRegistryIdMatch skips entries missing id or path', async () => {
  const dir = await buildSkillsDir({
    // First entry has no path, second has no id — both are skipped here
    // (validateRegistryPaths owns malformed-entry reporting).
    registryYaml: `skills:\n  - id: skill-a\n  - path: midstream/skill-a/SKILL.md\n`,
    skills: [{ dirName: 'skill-a', frontmatterId: 'skill-a' }],
  });
  const ok = await validateRegistryIdMatch({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, true);
});

// --- validateStrictSchemaDrift (scripts/validate-agent-skills.mjs) ---

async function writeAgentSkill(frontmatterId, extraFrontmatter) {
  const dir = await createTempDirAsync({ prefix: `${TMP_PREFIX}strict-` });
  const skillDir = path.join(dir, frontmatterId);
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  await fs.writeFile(skillPath, SKILL_MD(frontmatterId, extraFrontmatter), 'utf8');
  return skillPath;
}

test('validateStrictSchemaDrift fails a frontmatter that only the loose schema accepts', async () => {
  // `undeclaredField` passes the loose bridge schema (additionalProperties:
  // true) but is rejected by the strict runtime schema — the drift this guard
  // exists to block.
  const skillPath = await writeAgentSkill('drifting-skill', 'undeclaredField: true\n');
  const errors = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(String(msg));
  let ok;
  try {
    ok = await validateStrictSchemaDrift([skillPath]);
  } finally {
    console.error = originalError;
  }
  assert.equal(ok, false);
  assert.ok(
    errors.some((e) => e.includes('loadAllSkillMetadata()') && e.includes('silently drop')),
    `expected a silent-drop drift error; got: ${errors.join('\n')}`
  );
});

test('validateStrictSchemaDrift passes a strict-schema-conformant skill', async () => {
  const skillPath = await writeAgentSkill('conformant-skill', '');
  const ok = await validateStrictSchemaDrift([skillPath]);
  assert.equal(ok, true);
});

test('validateStrictSchemaDrift skips agent-tagged skills (runtime drops them by tag, not drift)', async () => {
  const dir = await createTempDirAsync({ prefix: `${TMP_PREFIX}agent-tag-` });
  const skillDir = path.join(dir, 'agent-tagged');
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  // tags include `agent` AND the frontmatter would fail the strict schema —
  // the tag skip must win so the drop is not misattributed to schema drift.
  await fs.writeFile(
    skillPath,
    `---
id: agent-tagged
name: Agent tagged
description: test skill
category: midstream
applyTo:
  - 'src/**/*.ts'
tags: [agent]
undeclaredField: true
---

body
`,
    'utf8'
  );
  const ok = await validateStrictSchemaDrift([skillPath]);
  assert.equal(ok, true);
});
