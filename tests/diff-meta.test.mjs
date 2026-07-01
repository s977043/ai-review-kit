import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDiffMeta } from '../src/lib/diff-processor.mjs';

test('extractDiffMeta: computes fileCount and changedLines from diffText', () => {
  const diff = {
    changedFiles: ['src/foo.ts', 'src/bar.ts'],
    diffText: '+added1\n+added2\n-removed1\n context\n+++ b/src/foo.ts\n--- a/src/foo.ts',
  };
  const meta = extractDiffMeta(diff);
  assert.equal(meta.fileCount, 2);
  assert.equal(meta.changedLines, 3);
});

test('extractDiffMeta: changedLines is 0 when diffText is absent', () => {
  const diff = {
    changedFiles: ['src/foo.ts'],
  };
  const meta = extractDiffMeta(diff);
  assert.equal(meta.fileCount, 1);
  assert.equal(meta.changedLines, 0);
});

test('extractDiffMeta: hasTests is true when test files present', () => {
  const diff = {
    changedFiles: ['tests/foo.test.mjs'],
    diffText: '+line',
  };
  const meta = extractDiffMeta(diff);
  assert.equal(meta.hasTests, true);
  assert.equal(meta.hasMigrations, false);
  assert.equal(meta.hasSchemas, false);
});

test('extractDiffMeta: hasMigrations is true when migration file present', () => {
  const diff = {
    changedFiles: ['db/migrations/001_create_users.sql'],
    diffText: '+line',
  };
  const meta = extractDiffMeta(diff);
  assert.equal(meta.hasMigrations, true);
  assert.equal(meta.hasSchemas, false);
});

test('extractDiffMeta: hasSchemas is true when schema file present', () => {
  const diff = {
    changedFiles: ['schemas/output.schema.json'],
    diffText: '+line',
  };
  const meta = extractDiffMeta(diff);
  assert.equal(meta.hasSchemas, true);
  assert.equal(meta.hasMigrations, false);
});

test('extractDiffMeta: empty diff returns zeros', () => {
  const meta = extractDiffMeta({ changedFiles: [] });
  assert.equal(meta.fileCount, 0);
  assert.equal(meta.changedLines, 0);
  assert.equal(meta.hasTests, false);
  assert.equal(meta.hasMigrations, false);
  assert.equal(meta.hasSchemas, false);
});
