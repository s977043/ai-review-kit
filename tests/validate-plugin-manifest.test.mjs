import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  validatePluginManifest,
  checkBundleFieldAllowlist,
  checkCrossManifestParity,
  checkAssetRegistration,
  checkManifestHostIndependentRefs,
  checkReviewJudgmentDuplication,
  detectReviewJudgmentDefinitions,
  findSsotReferences,
  RA1_ENFORCEMENT,
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
  // Non-string array elements are skipped, not passed to normalizeRef (no throw).
  assert.doesNotThrow(() => {
    const errors = checkAssetRegistration(
      { commands: [123, null, './commands/pr.md'], agents: [{}, './agents/river-review.md'] },
      { commandFiles: ['pr.md', 'other.md'], agentFiles: ['river-review.md'] }
    );
    // pr.md / river-review.md registered (valid string refs); only other.md flagged.
    assert.equal(errors.length, 1);
    assert.match(errors[0], /commands\/other\.md/);
  });
});

// ---------------------------------------------------------------------------
// Runtime Adapter Invariants RA-1 / RA-2 (ADR-009 D3, #2027)
// ---------------------------------------------------------------------------

const RA_FIXTURES = path.join(import.meta.dirname, 'fixtures', 'runtime-adapter-invariants');

const readFixture = (name) => fs.readFileSync(path.join(RA_FIXTURES, `${name}.md`), 'utf8');

test('RA-1 positive fixture: a pointer-only host-local file has no judgment definition', () => {
  const hits = detectReviewJudgmentDefinitions(readFixture('compliant-pointer-only'));
  assert.deepEqual(hits, [], `Expected no detections but got: ${JSON.stringify(hits)}`);
});

test('RA-1 negative fixture: a duplicated severity mapping table is detected', () => {
  const hits = detectReviewJudgmentDefinitions(readFixture('violating-severity-map'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, 'severity-vocabulary-map');
  assert.match(hits[0].term, /blocker→critical/);
});

test('RA-1 negative fixture: gate, completion and evidence definitions are detected', () => {
  const hits = detectReviewJudgmentDefinitions(readFixture('violating-gate-condition'));
  assert.deepEqual(
    hits.map((h) => [h.rule, h.term]),
    [
      ['gate-decision-condition', 'MERGE_OK'],
      ['gate-decision-condition', 'BLOCKED'],
      ['completion-condition', '完了条件'],
      ['finding-evidence-requirement', 'finding evidence'],
    ]
  );
});

test('RA-1 severity rule does not fire on a single fail-safe `major` row', () => {
  // normalizeSeverity() maps anything unknown to `major`, so one such row is
  // not evidence of a duplicated mapping table.
  const content = ['| term | output |', '| ---- | ------ |', '| whatever | major |'].join('\n');
  assert.deepEqual(detectReviewJudgmentDefinitions(content), []);
});

test('RA-1 severity rule does not fire on a table of only fail-safe `major` rows', () => {
  // Two rows, both explainable by the `major` fail-safe: still not a mapping.
  const content = [
    '| term | output |',
    '| ---- | ------ |',
    '| whatever | major |',
    '| something | major |',
  ].join('\n');
  assert.deepEqual(detectReviewJudgmentDefinitions(content), []);
});

test('findSsotReferences keeps only D3-3 SSoT paths', () => {
  const content = [
    'See `docs/governance.md` and `docs/review/viewpoints.md`.',
    'Canonical: `pages/reference/review-policy.md`, `src/lib/finding-factory.mjs`.',
  ].join('\n');
  assert.deepEqual(findSsotReferences(content), [
    'pages/reference/review-policy.md',
    'src/lib/finding-factory.mjs',
  ]);
});

test('checkReviewJudgmentDuplication flags a definition with no SSoT reference', () => {
  const files = [{ path: '.claude/rules/x.md', content: readFixture('violating-severity-map') }];
  const violations = checkReviewJudgmentDuplication(files, new Map());
  assert.equal(violations.length, 1);
  assert.match(violations[0], /RA-1 \.claude\/rules\/x\.md:\d+: severity-vocabulary-map/);
  assert.match(violations[0], /declares no ADR-009 D3-3 SSoT reference/);
});

test('checkReviewJudgmentDuplication flags a reference whose SSoT lacks the wording verbatim', () => {
  // This is the `.claude/rules/review-core.md` shape ADR-009 D7-2 records: the
  // file points at an SSoT, but the SSoT never spells the internal vocabulary.
  const content = `See docs/review/output-format.md.\n\n${readFixture('violating-severity-map')}`;
  const ssot = new Map([
    ['docs/review/output-format.md', '# Output format\n\ncritical / major / minor\n'],
  ]);
  const violations = checkReviewJudgmentDuplication(
    [{ path: '.claude/rules/review-core.md', content }],
    ssot
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /not present verbatim in the referenced SSoT/);
});

test('checkReviewJudgmentDuplication excuses a derived table present verbatim in the SSoT', () => {
  const content = `See docs/review/output-format.md.\n\n${readFixture('violating-severity-map')}`;
  const ssot = new Map([
    [
      'docs/review/output-format.md',
      '# Output format\n\nblocker → critical, warning → major, nit → minor\n',
    ],
  ]);
  const violations = checkReviewJudgmentDuplication(
    [{ path: '.claude/rules/review-core.md', content }],
    ssot
  );
  assert.deepEqual(violations, [], `Expected no violations but got: ${violations.join(', ')}`);
});

test('checkManifestHostIndependentRefs passes on the current manifests (RA-2)', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const cc = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const codex = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  const errors = checkManifestHostIndependentRefs(cc, codex);
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
});

test('checkManifestHostIndependentRefs rejects a host-local reference (RA-2)', () => {
  const errors = checkManifestHostIndependentRefs(
    { commands: ['./.claude/commands/merge-check.md'], skills: './skills/agent-skills/' },
    { skills: './skills/agent-skills/' }
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /points into a host-local directory/);
});

test('checkManifestHostIndependentRefs rejects a reference outside the top-level set (RA-2)', () => {
  const errors = checkManifestHostIndependentRefs(
    { skills: './src/lib/skills/' },
    { skills: './skills/agent-skills/', interface: { composerIcon: './assets/icon.svg' } }
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /outside the host-neutral top-level set/);
});

test('RA-1 runs in observe: repo violations surface as warnings, not errors', async () => {
  const warnings = [];
  const errors = await validatePluginManifest({ warnings });
  assert.equal(RA1_ENFORCEMENT, 'observe');
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
  // ADR-009 D7-2 / D7-4 predicted both of these; they must be visible.
  assert.ok(
    warnings.some((w) => w.startsWith('RA-1 .claude/rules/review-core.md:')),
    `review-core.md observation missing from: ${warnings.join(' | ')}`
  );
  assert.ok(
    warnings.some((w) => w.startsWith('RA-1 .claude/commands/merge-check.md:')),
    `merge-check.md observation missing from: ${warnings.join(' | ')}`
  );
});
