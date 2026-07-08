import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validatePluginManifest,
  checkBundleFieldAllowlist,
  checkCrossManifestParity,
  checkAssetRegistration,
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

test('checkAssetRegistration passes when every command/agent file is registered', () => {
  const cc = {
    commands: ['./commands/pr.md', './commands/check.md'],
    agents: './agents/river-review.md',
  };
  const errors = checkAssetRegistration(cc, {
    commandFiles: ['pr.md', 'check.md', 'README.md'],
    agentFiles: ['river-review.md'],
  });
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
});

test('checkAssetRegistration detects an unregistered command file', () => {
  const cc = { commands: ['./commands/pr.md'], agents: './agents/river-review.md' };
  const errors = checkAssetRegistration(cc, {
    commandFiles: ['pr.md', 'new-cmd.md'],
    agentFiles: ['river-review.md'],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /commands\/new-cmd\.md exists but is not registered/);
});

test('checkAssetRegistration never flags README.md', () => {
  const cc = { commands: [], agents: [] };
  const errors = checkAssetRegistration(cc, {
    commandFiles: ['README.md'],
    agentFiles: ['README.md'],
  });
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
});

test('checkAssetRegistration detects an unregistered agent file', () => {
  const cc = { commands: [], agents: './agents/river-review.md' };
  const errors = checkAssetRegistration(cc, {
    commandFiles: [],
    agentFiles: ['river-review.md', 'extra-agent.md'],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /agents\/extra-agent\.md exists but is not referenced/);
});

test('checkAssetRegistration accepts agents declared as an array', () => {
  const cc = {
    commands: [],
    agents: ['./agents/river-review.md', './agents/extra-agent.md'],
  };
  const errors = checkAssetRegistration(cc, {
    commandFiles: [],
    agentFiles: ['river-review.md', 'extra-agent.md'],
  });
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
});

test('checkAssetRegistration tolerates unexpected field/manifest types without throwing (gemini #1443)', () => {
  // commands/agents of unexpected types → treated as "nothing registered".
  assert.doesNotThrow(() => {
    const errors = checkAssetRegistration(
      { commands: { not: 'an array' }, agents: 42 },
      { commandFiles: ['new-cmd.md'], agentFiles: ['new-agent.md'] }
    );
    assert.equal(errors.length, 2);
  });
  // null manifest → no throw, no registrations.
  assert.doesNotThrow(() => {
    const errors = checkAssetRegistration(null, { commandFiles: ['x.md'], agentFiles: [] });
    assert.equal(errors.length, 1);
  });
});
