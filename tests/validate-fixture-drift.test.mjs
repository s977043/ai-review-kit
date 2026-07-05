/**
 * Tests for validateFixtureDrift in scripts/validate-skills.mjs.
 * Mechanizes the CLAUDE.md guard "Skill-check fixture/description drift":
 * fixtures' `<!-- expected: -->` blocks and the frontmatter description must
 * stay consistent with the SKILL.md `Check N` headings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';

import {
  validateFixtureDrift,
  extractCheckHeadings,
  extractExpectedBlocks,
  descriptionCoversCheck,
} from '../scripts/validate-skills.mjs';
import { createTempDirAsync } from './helpers/temp-dir.mjs';

const TMP_PREFIX = 'validate-fixture-drift-';

const SKILL_MD = ({
  description = 'Checks review criteria definition and feedback capture design.',
  checks = [
    'Check 1 — Review criteria before work / 作業前レビュー基準の定義',
    'Check 2 — Feedback capture / フィードバック再利用の設計',
  ],
} = {}) => `---
id: drift-skill
name: Drift Skill
description: '${description}'
category: upstream
phase: upstream
applyTo:
  - 'docs/**/*.md'
tags: [test, upstream]
severity: major
inputContext: [diff]
outputKind: [findings]
---

## Rule / ルール

${checks.map((c) => `### ${c}\n\ncondition body\n`).join('\n')}
`;

const FIXTURE = (expectedYaml) => `# Fixture doc

Some AI delegation task body.

<!-- expected:
${expectedYaml}
-->
`;

async function buildSkill({ skillMd, fixtures }) {
  const dir = await createTempDirAsync({ prefix: TMP_PREFIX });
  const skillDir = path.join(dir, 'upstream', 'drift-skill');
  const fixturesDir = path.join(skillDir, 'fixtures');
  await fs.mkdir(fixturesDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMd, 'utf8');
  for (const [name, content] of Object.entries(fixtures)) {
    await fs.writeFile(path.join(fixturesDir, name), content, 'utf8');
  }
  return dir;
}

async function captureWarnings(fn) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

test('passes when fixture checks exist and description covers all checks', async () => {
  const dir = await buildSkill({
    skillMd: SKILL_MD(),
    fixtures: {
      '01-missing.md': FIXTURE('findings:\n  - check: 1\n    severity: major\n  - check: 2'),
      '02-complete.md': FIXTURE('findings: []'),
    },
  });
  const ok = await validateFixtureDrift({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, true);
});

test('fails on a dangling expectation (fixture references a removed Check)', async () => {
  const dir = await buildSkill({
    skillMd: SKILL_MD(),
    fixtures: {
      '01-missing.md': FIXTURE('findings:\n  - check: 1\n  - check: 9'),
    },
  });
  const ok = await validateFixtureDrift({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, false);
});

test('fails when the description does not enumerate a Check', async () => {
  const dir = await buildSkill({
    skillMd: SKILL_MD({
      description: 'Checks review criteria definition only.',
      checks: [
        'Check 1 — Review criteria before work / 作業前レビュー基準の定義',
        'Check 2 — Rollback safety / ロールバック安全性',
      ],
    }),
    fixtures: {
      '01-missing.md': FIXTURE('findings:\n  - check: 1\n  - check: 2'),
    },
  });
  const ok = await validateFixtureDrift({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, false);
});

test('fails when an expected block is not valid YAML', async () => {
  const dir = await buildSkill({
    skillMd: SKILL_MD(),
    fixtures: {
      '01-bad.md': FIXTURE('findings: [unclosed'),
    },
  });
  const ok = await validateFixtureDrift({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, false);
});

test('skips skills whose expected blocks do not reference checks (plan-review-gate style)', async () => {
  const dir = await buildSkill({
    skillMd: SKILL_MD({ checks: [] }),
    fixtures: {
      '01-adversarial.md': FIXTURE(
        'humanApproval:\n  regexOnly: required\n  triggersInclude:\n    - ja-recursive-cleanup-euphemism'
      ),
    },
  });
  const ok = await validateFixtureDrift({ skillsDir: dir, repoRoot: dir });
  assert.equal(ok, true);
});

test('warns (still passes) on an uncovered Check when no findings:[] fixture exists', async () => {
  const dir = await buildSkill({
    skillMd: SKILL_MD(),
    fixtures: {
      '01-missing.md': FIXTURE('findings:\n  - check: 1'),
    },
  });
  const { result: ok, warnings } = await captureWarnings(() =>
    validateFixtureDrift({ skillsDir: dir, repoRoot: dir })
  );
  assert.equal(ok, true);
  assert.ok(warnings.some((w) => w.includes('Check 2') && w.includes('not referenced')));
});

test('suppresses the coverage warning when a findings:[] fixture exists', async () => {
  const dir = await buildSkill({
    skillMd: SKILL_MD(),
    fixtures: {
      '01-missing.md': FIXTURE('findings:\n  - check: 1'),
      '02-complete.md': FIXTURE('findings: []'),
    },
  });
  const { result: ok, warnings } = await captureWarnings(() =>
    validateFixtureDrift({ skillsDir: dir, repoRoot: dir })
  );
  assert.equal(ok, true);
  assert.deepEqual(
    warnings.filter((w) => w.includes('not referenced')),
    []
  );
});

test('extractCheckHeadings parses ids and English titles', () => {
  const body = [
    '## Rule',
    '',
    '### Check 1 — Review criteria before work / 作業前レビュー基準の定義',
    '',
    '### Check 2 — Feedback capture',
    '',
    '### Check 12',
    '',
    '### Checklist — not a numbered check',
  ].join('\n');
  assert.deepEqual(extractCheckHeadings(body), [
    { id: 1, title: 'Review criteria before work' },
    { id: 2, title: 'Feedback capture' },
    { id: 12, title: null },
  ]);
});

test('extractExpectedBlocks returns every embedded block payload', () => {
  const text = 'a\n<!-- expected:\nfindings: []\n-->\nb\n<!-- expected:\nfoo: bar\n-->\n';
  assert.deepEqual(extractExpectedBlocks(text), ['findings: []\n', 'foo: bar\n']);
});

test('descriptionCoversCheck matches morphological variants and skips unusable titles', () => {
  const description =
    'Checks whether AI-assisted work defines review criteria and accessible context.';
  assert.equal(descriptionCoversCheck(description, 'Required knowledge access'), true);
  assert.equal(descriptionCoversCheck(description, 'Rollback safety'), false);
  // Japanese-only titles give no latin tokens — skip, not fail.
  assert.equal(descriptionCoversCheck(description, '日本語のみ'), true);
  assert.equal(descriptionCoversCheck(description, null), true);
});
