// tests/generate-registry-fields.test.mjs
//
// Registry structural-field generator (#1562): frontmatter parsing, value
// normalization / rendering, the in-place drift-resolving line rewrite, and the
// wrapped-flow (#1580 W1) handling + prettier canonicalization.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as yaml from 'js-yaml';
import prettier from 'prettier';

import {
  MANAGED_FIELDS,
  parseFrontmatter,
  normalizeValue,
  needsQuote,
  renderScalar,
  renderFieldValue,
  syncRegistryFields,
} from '../scripts/generate-registry-fields.mjs';

// Match the repo's .prettierrc so the generator's canonicalization step in
// these temp-dir tests behaves exactly like production (printWidth 100 wraps
// long `tags` arrays across lines; short ones stay inline).
const PRETTIER = { printWidth: 100, singleQuote: true, tabWidth: 2, proseWrap: 'preserve' };

/** Look up a parsed skill entry by id from generated registry content. */
function entryById(content, id) {
  const parsed = yaml.load(content);
  return (parsed.skills ?? []).find((s) => s.id === id);
}

test('parseFrontmatter reads the YAML frontmatter block', () => {
  const fm = parseFrontmatter('---\nid: x\nname: Y Z\ntags:\n  - a\n  - b\n---\nbody');
  assert.equal(fm.id, 'x');
  assert.equal(fm.name, 'Y Z');
  assert.deepEqual(fm.tags, ['a', 'b']);
});

test('parseFrontmatter returns {} when no frontmatter', () => {
  assert.deepEqual(parseFrontmatter('# no frontmatter'), {});
});

test('normalizeValue collapses single-element arrays to scalars', () => {
  assert.equal(normalizeValue(['midstream']), 'midstream');
  assert.deepEqual(normalizeValue(['upstream', 'midstream']), ['upstream', 'midstream']);
  assert.equal(normalizeValue('midstream'), 'midstream');
});

test('needsQuote flags YAML-unsafe plain scalars', () => {
  assert.equal(needsQuote('Baseline Security Checks'), false);
  assert.equal(needsQuote('GitHubレビューコメント対応（修正案つき）'), false);
  assert.equal(needsQuote('Next.js App Router Client/Server Boundary'), false);
  assert.equal(needsQuote(''), true);
  assert.equal(needsQuote('key: value'), true); // ": " indicator
  assert.equal(needsQuote('true'), true); // boolean-ish
  assert.equal(needsQuote('0.2.0'), false); // two dots => not a number, plain ok
  assert.equal(needsQuote('42'), true); // number-ish
});

test('renderScalar quotes only when necessary and escapes single quotes', () => {
  assert.equal(renderScalar('Plain Name'), 'Plain Name');
  // A mid-string apostrophe is valid in a YAML plain scalar (only a *leading*
  // quote is an indicator), so it stays unquoted.
  assert.equal(renderScalar("it's"), "it's");
  // A leading quote forces quoting; the internal quote is doubled per YAML.
  assert.equal(renderScalar("'quoted"), "'''quoted'");
});

test('renderFieldValue matches registry formatting conventions', () => {
  assert.equal(renderFieldValue('version', '0.2.0'), "'0.2.0'");
  assert.equal(renderFieldValue('name', 'Baseline Security Checks'), 'Baseline Security Checks');
  assert.equal(
    renderFieldValue('tags', ['security', 'midstream', 'web']),
    '[security, midstream, web]'
  );
  assert.equal(renderFieldValue('phase', ['midstream']), 'midstream'); // single-element => scalar
  assert.equal(renderFieldValue('phase', ['upstream', 'midstream']), '[upstream, midstream]');
  assert.equal(renderFieldValue('category', 'midstream'), 'midstream');
});

test('MANAGED_FIELDS excludes catalog-curation fields', () => {
  assert.ok(!MANAGED_FIELDS.includes('recommended'));
  assert.ok(!MANAGED_FIELDS.includes('description'));
  assert.ok(!MANAGED_FIELDS.includes('applyTo'));
  assert.ok(!MANAGED_FIELDS.includes('path'));
});

async function makeSkill(root, dir, frontmatter) {
  const full = path.join(root, dir);
  await fs.mkdir(full, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) =>
      Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${typeof v === 'string' ? v : v}`
    )
    .join('\n');
  await fs.writeFile(path.join(full, 'SKILL.md'), `---\n${fm}\n---\n# body\n`);
}

test('syncRegistryFields rewrites only drifted managed fields, preserving comments/order', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await makeSkill(root, 'skills/midstream/a', {
    id: 'a',
    version: '0.2.0', // drift: registry says 0.1.0
    name: 'Alpha Guard', // drift: registry says 'Alpha'
    category: 'midstream',
    phase: 'midstream',
    tags: ['x', 'y'], // drift: registry says [x, z]
    severity: 'major',
  });
  await makeSkill(root, 'skills/midstream/b', {
    id: 'b',
    version: '0.1.0',
    name: 'Beta',
    category: 'midstream',
    phase: ['midstream'], // single-element array; registry scalar => NOT drift
    tags: ['p'],
    severity: 'info',
  });

  const raw = `# header comment
skills:
  # Section comment
  - id: a
    version: '0.1.0'
    name: 'Alpha'
    path: skills/midstream/a/SKILL.md
    category: midstream
    phase: midstream
    tags: [x, z]
    severity: major
    recommended: true
    description: 'curated desc A'

  - id: b
    version: '0.1.0'
    name: Beta
    path: skills/midstream/b/SKILL.md
    category: midstream
    phase: midstream
    tags: [p]
    severity: info
    recommended: false
    description: 'curated desc B'

packs:
  - id: keep-me
`;

  const { content, changes, errors } = await syncRegistryFields(raw, {
    rootDir: root,
    prettierConfig: PRETTIER,
  });

  assert.deepEqual(errors, []);
  // Only a.version, a.name, a.tags changed; b is untouched (phase normalized).
  assert.deepEqual(changes.map((c) => `${c.id}.${c.field}`).sort(), [
    'a.name',
    'a.tags',
    'a.version',
  ]);
  const a = entryById(content, 'a');
  assert.equal(a.version, '0.2.0');
  assert.equal(a.name, 'Alpha Guard');
  assert.deepEqual(a.tags, ['x', 'y']);
  // Entry b untouched (single-element phase array normalized to the scalar).
  const b = entryById(content, 'b');
  assert.equal(b.name, 'Beta');
  assert.equal(b.phase, 'midstream');
  assert.deepEqual(b.tags, ['p']);
  // Preserved: comments, curated description, packs section.
  assert.match(content, /# header comment/);
  assert.match(content, /# Section comment/);
  assert.match(content, /description: 'curated desc A'/);
  assert.match(content, /packs:\n {2}- id: keep-me/);
});

test('syncRegistryFields is idempotent and prettier-stable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await makeSkill(root, 'skills/midstream/a', {
    id: 'a',
    version: '0.1.0',
    name: 'Alpha',
    category: 'midstream',
    phase: 'midstream',
    tags: ['x'],
    severity: 'major',
  });
  const raw = `skills:
  - id: a
    version: '0.1.0'
    name: Alpha
    path: skills/midstream/a/SKILL.md
    category: midstream
    phase: midstream
    tags: [x]
    severity: major
    recommended: true
    description: 'd'
`;
  const first = await syncRegistryFields(raw, { rootDir: root, prettierConfig: PRETTIER });
  assert.equal(first.changes.length, 0);
  assert.deepEqual(first.errors, []);
  // Already synced + prettier-clean => byte-identical (no-drift run is a no-op).
  assert.equal(first.content, raw);
  const second = await syncRegistryFields(first.content, {
    rootDir: root,
    prettierConfig: PRETTIER,
  });
  assert.equal(second.content, first.content);
});

// --- #1580 W1: wrapped (multi-line flow) tags were a silent-miss hole. ---

// Build a prettier-canonical registry whose `a` entry has a LONG tags array
// that wraps across lines (the shape that defeated the same-line rewrite).
async function wrappedRegistryFixture(root, frontmatterTags, registryTags) {
  await makeSkill(root, 'skills/midstream/a', {
    id: 'a',
    version: '0.1.0',
    name: 'Alpha',
    category: 'midstream',
    phase: 'midstream',
    tags: frontmatterTags,
    severity: 'major',
  });
  const inline = `skills:
  - id: a
    version: '0.1.0'
    name: Alpha
    path: skills/midstream/a/SKILL.md
    category: midstream
    phase: midstream
    tags: [${registryTags.join(', ')}]
    severity: major
    recommended: true
    description: 'd'
`;
  // Canonicalize so `tags:` really is wrapped onto its own following lines.
  return prettier.format(inline, { ...PRETTIER, parser: 'yaml' });
}

test('wrapped-flow tags: drift IS detected and fixed (W1 regression)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const longTags = [
    'adversarial',
    'refactor-claim',
    'claim-vs-actual',
    'verification',
    'midstream',
    'cognitive-bias',
    'performance-regression',
  ];
  const drifted = [...longTags.slice(0, 6), 'w1-probe-tag']; // frontmatter differs
  const raw = await wrappedRegistryFixture(root, drifted, longTags);
  // Precondition: the fixture really is wrapped (tags value not on the tags: line).
  assert.match(raw, /^ {4}tags:\s*$/m);

  const { content, changes, errors } = await syncRegistryFields(raw, {
    rootDir: root,
    prettierConfig: PRETTIER,
  });
  assert.deepEqual(errors, []);
  // The silent miss is gone: the drift is now reported...
  assert.deepEqual(
    changes.map((c) => `${c.id}.${c.field}`),
    ['a.tags']
  );
  // ...and actually realized in the output (re-parsed value equals frontmatter).
  assert.deepEqual(entryById(content, 'a').tags, drifted);
  // Output stays prettier-canonical.
  assert.equal(content, await prettier.format(content, { ...PRETTIER, parser: 'yaml' }));
});

test('wrapped-flow tags: matching frontmatter is a no-op', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const longTags = [
    'adversarial',
    'refactor-claim',
    'claim-vs-actual',
    'verification',
    'midstream',
    'cognitive-bias',
    'performance-regression',
  ];
  const raw = await wrappedRegistryFixture(root, longTags, longTags); // identical
  const { content, changes, errors } = await syncRegistryFields(raw, {
    rootDir: root,
    prettierConfig: PRETTIER,
  });
  assert.deepEqual(errors, []);
  assert.equal(changes.length, 0);
  assert.equal(content, raw); // steady state => byte-identical
});

test('backstop: drift with no locatable field line is a hard error, not a silent skip', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await makeSkill(root, 'skills/midstream/a', {
    id: 'a',
    version: '0.1.0',
    name: 'Alpha',
    category: 'midstream',
    phase: 'midstream',
    tags: ['x', 'y'], // frontmatter has tags...
    severity: 'major',
  });
  // ...but the registry entry has NO tags: line at all.
  const raw = `skills:
  - id: a
    version: '0.1.0'
    name: Alpha
    path: skills/midstream/a/SKILL.md
    category: midstream
    phase: midstream
    severity: major
    recommended: true
    description: 'd'
`;
  const { changes, errors } = await syncRegistryFields(raw, {
    rootDir: root,
    prettierConfig: PRETTIER,
  });
  assert.equal(changes.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no "tags:" line exists/);
});

// --- #1580 line review: id first-field, CRLF, malformed frontmatter, BOM. ---

test('parseFrontmatter tolerates a BOM and leading whitespace (gemini #3609683790)', () => {
  assert.equal(parseFrontmatter('﻿---\nid: a\nname: X\n---\nbody').id, 'a');
  assert.equal(parseFrontmatter('\n\n  ---\nid: b\nname: Y\n---\nbody').id, 'b');
});

test('id drift on the `  - id:` first field self-repairs (gemini #3609683783)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await makeSkill(root, 'skills/midstream/a', {
    id: 'new-id',
    version: '0.1.0',
    name: 'Alpha',
    category: 'midstream',
    phase: 'midstream',
    tags: ['x'],
    severity: 'major',
  });
  const raw = `skills:
  - id: old-id
    version: '0.1.0'
    name: Alpha
    path: skills/midstream/a/SKILL.md
    category: midstream
    phase: midstream
    tags: [x]
    severity: major
    recommended: true
    description: 'd'
`;
  const { content, changes, errors } = await syncRegistryFields(raw, {
    rootDir: root,
    prettierConfig: PRETTIER,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(
    changes.map((c) => `${c.field}`),
    ['id']
  );
  assert.equal(entryById(content, 'new-id').id, 'new-id');
  assert.match(content, /^ {2}- id: new-id$/m); // rewritten in place, prefix preserved
});

test('CRLF input is normalized: no phantom drift, LF output (gemini #3609683784/786)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await makeSkill(root, 'skills/midstream/a', {
    id: 'a',
    version: '0.1.0',
    name: 'Alpha',
    category: 'midstream',
    phase: 'midstream',
    tags: ['x'],
    severity: 'major',
  });
  const lf = `skills:
  - id: a
    version: '0.1.0'
    name: Alpha
    path: skills/midstream/a/SKILL.md
    category: midstream
    phase: midstream
    tags: [x]
    severity: major
    recommended: true
    description: 'd'
`;
  const crlf = lf.replaceAll('\n', '\r\n');
  const { content, changes, errors } = await syncRegistryFields(crlf, {
    rootDir: root,
    prettierConfig: PRETTIER,
  });
  assert.deepEqual(errors, []);
  assert.equal(changes.length, 0); // CRLF must not read as stale
  assert.ok(!content.includes('\r'));
  assert.equal(content, lf);
});

test('malformed frontmatter YAML is a hard error, not a silent skip (gemini #3609683789)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const full = path.join(root, 'skills/midstream/a');
  await fs.mkdir(full, { recursive: true });
  // Unclosed flow sequence => js-yaml throws.
  await fs.writeFile(
    path.join(full, 'SKILL.md'),
    '---\nid: a\nname: Alpha\ntags: [x, y\nseverity: major\n---\nbody\n'
  );
  const raw = `skills:
  - id: a
    version: '0.1.0'
    name: Alpha
    path: skills/midstream/a/SKILL.md
    category: midstream
    phase: midstream
    tags: [z]
    severity: major
    recommended: true
    description: 'd'
`;
  const { changes, errors } = await syncRegistryFields(raw, {
    rootDir: root,
    prettierConfig: PRETTIER,
  });
  assert.equal(changes.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /frontmatter is not valid YAML/);
});

test('genuinely missing SKILL.md (ENOENT) is skipped, not an error', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // No file created at the referenced path.
  const raw = `skills:
  - id: a
    version: '0.1.0'
    name: Alpha
    path: skills/midstream/missing/SKILL.md
    category: midstream
    phase: midstream
    tags: [z]
    severity: major
    recommended: true
    description: 'd'
`;
  const { changes, errors } = await syncRegistryFields(raw, {
    rootDir: root,
    prettierConfig: PRETTIER,
  });
  assert.deepEqual(errors, []); // validateRegistryPaths owns the missing-file signal
  assert.equal(changes.length, 0);
});
