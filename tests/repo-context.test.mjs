import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectRepoContext, buildRepoContextSection } from '../src/lib/repo-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

test('collectRepoContext returns sections for changed source files', async () => {
  const result = await collectRepoContext({
    changedFiles: ['src/lib/finding-factory.mjs'],
    repoRoot: REPO_ROOT,
  });
  assert.ok(Array.isArray(result.sections), 'sections is array');
  assert.ok(result.sections.length > 0, 'at least one section collected');
  const fullFile = result.sections.find((s) => s.label.startsWith('Full file:'));
  assert.ok(fullFile, 'full file section present');
  assert.ok(fullFile.content.length > 0, 'content is non-empty');
  assert.ok(typeof result.totalChars === 'number', 'totalChars is number');
  assert.ok(typeof result.truncated === 'boolean', 'truncated is boolean');
});

test('collectRepoContext respects maxChars budget', async () => {
  const result = await collectRepoContext({
    changedFiles: ['src/lib/finding-factory.mjs', 'src/lib/review-engine.mjs'],
    repoRoot: REPO_ROOT,
    maxChars: 500,
  });
  const total = result.sections.reduce((s, sec) => s + sec.content.length, 0);
  assert.ok(total <= 600, `total content chars ${total} should be near or under budget`);
});

test('collectRepoContext handles non-existent file gracefully', async () => {
  const result = await collectRepoContext({
    changedFiles: ['src/lib/does-not-exist.mjs'],
    repoRoot: REPO_ROOT,
  });
  assert.ok(Array.isArray(result.sections), 'sections is array even for missing file');
});

test('collectRepoContext skips non-source files', async () => {
  const result = await collectRepoContext({
    changedFiles: ['README.md', 'package.json'],
    repoRoot: REPO_ROOT,
  });
  const fullFiles = result.sections.filter((s) => s.label.startsWith('Full file:'));
  assert.equal(fullFiles.length, 0, 'no full-file sections for non-source files');
});

test('buildRepoContextSection returns empty string when no context', () => {
  assert.equal(buildRepoContextSection(null), '');
  assert.equal(buildRepoContextSection(undefined), '');
  assert.equal(buildRepoContextSection({ sections: [] }), '');
});

test('buildRepoContextSection renders sections as markdown', () => {
  const ctx = {
    sections: [
      { label: 'Full file: src/foo.mjs', content: 'export const x = 1;', file: 'src/foo.mjs' },
    ],
    totalChars: 20,
    truncated: false,
  };
  const out = buildRepoContextSection(ctx);
  assert.ok(out.includes('Repository Context'), 'includes heading');
  assert.ok(out.includes('Full file: src/foo.mjs'), 'includes section label');
  assert.ok(out.includes('export const x = 1;'), 'includes section content');
});

test('buildRepoContextSection adds truncation notice when truncated', () => {
  const ctx = {
    sections: [{ label: 'Full file: src/bar.mjs', content: 'x', file: 'src/bar.mjs' }],
    totalChars: 1,
    truncated: true,
  };
  const out = buildRepoContextSection(ctx);
  assert.ok(out.includes('truncated'), 'includes truncation notice');
});
