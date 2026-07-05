/**
 * Tests for findBadGlobs in scripts/validate-skills.mjs (#1196 retrospective).
 *
 * Guards against non-portable single-extension brace globs (e.g. `*.{sql}`) in
 * skill applyTo / files / path_patterns — which slipped past skills:validate and
 * caused a manifest-freshness CI failure in #1200.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import path from 'path';

import { findBadGlobs, isAgentSkillsPath } from '../scripts/validate-skills.mjs';

describe('findBadGlobs', () => {
  test('flags single-extension brace globs in applyTo', () => {
    assert.deepEqual(findBadGlobs({ applyTo: ['**/*.{sql}'] }), ['**/*.{sql}']);
    assert.deepEqual(findBadGlobs({ applyTo: ['**/*migrate*/**/*.{sql}'] }), [
      '**/*migrate*/**/*.{sql}',
    ]);
  });

  test('allows multi-alternative braces and plain patterns', () => {
    assert.deepEqual(
      findBadGlobs({ applyTo: ['**/*.{js,ts}', '**/*.sql', 'prisma/schema.prisma'] }),
      []
    );
    assert.deepEqual(findBadGlobs({ applyTo: ['**/*schema*.{sql,prisma}'] }), []);
  });

  test('checks files and path_patterns too', () => {
    assert.deepEqual(findBadGlobs({ files: ['db/**/*.{sql}'] }), ['db/**/*.{sql}']);
    assert.deepEqual(findBadGlobs({ path_patterns: ['x/*.{md}'] }), ['x/*.{md}']);
  });

  test('tolerates missing / non-array / non-string entries', () => {
    assert.deepEqual(findBadGlobs(undefined), []);
    assert.deepEqual(findBadGlobs({}), []);
    assert.deepEqual(findBadGlobs({ applyTo: [null, 42, '**/*.{sql}'] }), ['**/*.{sql}']);
  });

  test('handles a scalar string applyTo (pre-normalization frontmatter)', () => {
    assert.deepEqual(findBadGlobs({ applyTo: '**/*.{sql}' }), ['**/*.{sql}']);
    assert.deepEqual(findBadGlobs({ applyTo: '**/*.sql' }), []);
  });
});

// #1376 follow-up: the agent-skills skip must match a whole path segment, not a
// bare substring — otherwise a real skill dir like my-agent-skills-bridge would
// be wrongly excluded from skills:validate.
describe('isAgentSkillsPath', () => {
  const seg = (...parts) => parts.join(path.sep);

  test('matches paths under the agent-skills segment', () => {
    assert.equal(isAgentSkillsPath(seg('skills', 'agent-skills', 'foo', 'SKILL.md')), true);
    assert.equal(isAgentSkillsPath(seg('agent-skills', 'SKILL.md')), true);
  });

  test('does not match a directory that merely contains the substring', () => {
    assert.equal(
      isAgentSkillsPath(seg('skills', 'midstream', 'my-agent-skills-bridge', 'SKILL.md')),
      false
    );
    assert.equal(
      isAgentSkillsPath(seg('skills', 'midstream', 'agent-skills-bridge', 'SKILL.md')),
      false
    );
    assert.equal(
      isAgentSkillsPath(seg('skills', 'upstream', 'architecture-sample', 'SKILL.md')),
      false
    );
  });
});
