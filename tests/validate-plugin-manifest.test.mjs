import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validatePluginManifest,
  checkBundleFieldAllowlist,
  checkCrossManifestParity,
} from '../scripts/validate-plugin-manifest.mjs';

test('validatePluginManifest passes on current repo state', async () => {
  const errors = await validatePluginManifest();
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
});

function makeCcManifest() {
  return {
    name: 'river-review',
    displayName: 'River Review',
    homepage: 'https://example.com/',
    repository: 'https://github.com/s977043/river-review',
    author: { name: 'river-review maintainers', url: 'https://example.com/' },
    skills: './skills/agent-skills/',
    composerIcon: './assets/icon.svg',
  };
}

function makeCodexManifest() {
  return {
    name: 'river-review',
    version: '1.0.0',
    description: 'desc',
    author: { name: 'river-review maintainers', url: 'https://example.com/' },
    homepage: 'https://example.com/',
    repository: 'https://github.com/s977043/river-review',
    license: 'MIT',
    keywords: ['code-review'],
    skills: './skills/agent-skills/',
    interface: {
      displayName: 'River Review',
      shortDescription: 'short',
      longDescription: 'long',
      developerName: 'river-review maintainers',
      category: 'Developer Tools',
      capabilities: ['Read'],
      websiteURL: 'https://example.com/',
      composerIcon: './assets/icon.svg',
    },
  };
}

test('checkCrossManifestParity passes when shared fields match', () => {
  const errors = checkCrossManifestParity(makeCcManifest(), makeCodexManifest());
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
});

test('checkCrossManifestParity detects repository drift', () => {
  const codex = makeCodexManifest();
  codex.repository = 'https://github.com/other/fork';
  const errors = checkCrossManifestParity(makeCcManifest(), codex);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"repository"/);
});

test('checkCrossManifestParity detects composerIcon drift (regression #1250)', () => {
  const codex = makeCodexManifest();
  delete codex.interface.composerIcon;
  const errors = checkCrossManifestParity(makeCcManifest(), codex);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /interface\.composerIcon/);
});

test('checkCrossManifestParity detects displayName and websiteURL drift', () => {
  const codex = makeCodexManifest();
  codex.interface.displayName = 'Other Name';
  codex.interface.websiteURL = 'https://elsewhere.example/';
  const errors = checkCrossManifestParity(makeCcManifest(), codex);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /interface\.displayName/);
  assert.match(errors[1], /interface\.websiteURL/);
});

test('checkCrossManifestParity detects developerName drift against author.name', () => {
  const codex = makeCodexManifest();
  codex.interface.developerName = 'someone else';
  const errors = checkCrossManifestParity(makeCcManifest(), codex);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /interface\.developerName/);
});

test('checkBundleFieldAllowlist passes on a conforming manifest', () => {
  const errors = checkBundleFieldAllowlist(makeCodexManifest());
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
});

test('checkBundleFieldAllowlist rejects unknown top-level field', () => {
  const codex = makeCodexManifest();
  codex.marketplaceBadge = 'gold';
  const errors = checkBundleFieldAllowlist(codex);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"marketplaceBadge" is not in the bundle allowlist/);
});

test('checkBundleFieldAllowlist rejects unknown interface field', () => {
  const codex = makeCodexManifest();
  codex.interface.heroImage = './assets/hero.png';
  const errors = checkBundleFieldAllowlist(codex);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /interface field "heroImage" is not in the bundle allowlist/);
});

test('checkBundleFieldAllowlist reports missing listing-required fields', () => {
  const codex = makeCodexManifest();
  delete codex.repository;
  codex.license = '';
  const errors = checkBundleFieldAllowlist(codex);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /required bundle field "repository"/);
  assert.match(errors[1], /required bundle field "license"/);
});

test('checkBundleFieldAllowlist reports null listing-required field', () => {
  const codex = makeCodexManifest();
  codex.license = null;
  const errors = checkBundleFieldAllowlist(codex);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /required bundle field "license"/);
});
