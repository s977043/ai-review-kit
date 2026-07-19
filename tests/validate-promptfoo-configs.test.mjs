/**
 * Tests for scripts/validate-promptfoo-configs.mjs (offline structural
 * validator for community skill promptfoo.yaml configs — #929).
 *
 * Wired into CI as part of the "Skill schema validation" job (test.yml) after
 * being an orphan script with no test coverage. The glob it scans
 * (`skills/midstream/*\/eval/promptfoo.yaml`) drifted after #1320 flattened
 * the `skills/midstream/community/` nesting, silently turning the validator
 * red (0 configs found → exit 1) with nothing running it to notice.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validateConfig } from '../scripts/validate-promptfoo-configs.mjs';

// Resolve repo root from this file's own location (not process.cwd()) so the
// tests do not depend on the directory `node --test` was invoked from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(repoRoot, 'tests/fixtures/promptfoo-configs');

test('validateConfig returns no errors for a structurally valid promptfoo.yaml', () => {
  const errors = validateConfig(path.join(fixturesDir, 'valid.yaml'));
  assert.deepEqual(errors, []);
});

test('validateConfig reports errors for a structurally invalid promptfoo.yaml', () => {
  const errors = validateConfig(path.join(fixturesDir, 'invalid.yaml'));
  assert.ok(errors.length > 0, 'expected at least one structural error');
  assert.ok(errors.some((e) => e.includes('missing description')));
  assert.ok(errors.some((e) => e.includes('missing or empty assert')));
});

test('validateConfig reports structural errors (not a crash) for an empty/comment-only yaml', () => {
  const errors = validateConfig(path.join(fixturesDir, 'empty.yaml'));
  assert.ok(errors.length > 0, 'expected structural errors, not a crash');
  assert.ok(errors.some((e) => e.includes('Missing or empty required array: prompts')));
  assert.ok(errors.some((e) => e.includes('Missing or empty required array: providers')));
  assert.ok(errors.some((e) => e.includes('Missing or empty required array: tests')));
});

test('integration: promptfoo config validator exits 0 on the real repository', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-promptfoo-configs.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
