/**
 * Tests for findBadGlobs in scripts/validate-skills.mjs (#1196 retrospective).
 *
 * Guards against non-portable single-extension brace globs (e.g. `*.{sql}`) in
 * skill applyTo / files / path_patterns — which slipped past skills:validate and
 * caused a manifest-freshness CI failure in #1200.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { findBadGlobs } from '../scripts/validate-skills.mjs';

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
