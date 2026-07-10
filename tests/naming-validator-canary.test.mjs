// tests/naming-validator-canary.test.mjs
//
// Canary + unit coverage for the skill naming validators (issue #1463 PR-3).
//
// Two responsibilities, per repo principle #1070 (deterministic checks live in
// static analysis + canary; the semantic Q0–Q5 import framework stays with
// human PR review):
//
//   1. Canary — pin known-legitimate names so a future tweak of the rules
//      cannot start flagging them (river-review-code, generated `as-<name>`
//      ids, grandfathered names, Title Case registry display names).
//   2. Unit — exercise every new check in both directions (happy / violation).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findProhibitedNoun,
  findReservedWord,
  normalizeHyphenVariant,
  findHyphenVariantCollisions,
  isProhibitedNounExempt,
  NAME_MAX_LENGTH,
  PROHIBITED_NOUN_EXEMPT,
} from '../scripts/validate-agent-skills.mjs';
import { findRegistryNamingCollisions } from '../scripts/validate-skills.mjs';
import {
  parseClaudeMdDistributedCommands,
  checkClaudeMdCommandParity,
} from '../scripts/validate-plugin-manifest.mjs';

// ---------------------------------------------------------------------------
// Canary: known-legitimate names must never be flagged.
// ---------------------------------------------------------------------------

test('canary: legitimate agent-skill names raise no prohibited-noun / reserved-word finding', () => {
  const legitimate = [
    'river-review-code', // router name; contains "-review" but no prohibited noun/reserved word
    'river-review-security',
    'adversarial-review', // the sole `<value>-review` precedent
    'as-simplify', // generated id for an imported skill (`as-<name>`)
    'as-my-imported-technique',
  ];
  for (const name of legitimate) {
    assert.equal(findProhibitedNoun(name), null, `${name} must not trip a prohibited noun`);
    assert.equal(findReservedWord(name), null, `${name} must not trip a reserved word`);
    assert.ok(name.length <= NAME_MAX_LENGTH, `${name} must be within the length limit`);
  }
});

test('canary: grandfathered names are exempt from the prohibited-noun warning', () => {
  // review-team / setup-team literally contain the noun "team" but are exempt.
  for (const name of ['review-team', 'setup-team']) {
    assert.equal(findProhibitedNoun(name), 'team', `${name} does contain the noun`);
    assert.ok(PROHIBITED_NOUN_EXEMPT.has(name), `${name} must be on the exempt list`);
  }
});

test('canary: Title Case registry display names do not cause id collisions', () => {
  // Registry entries separate id (kebab) from name (display). The collision
  // check operates on `id` only — a Title Case display name is never fed in.
  const entries = [
    { label: 'security-privacy-design', kind: 'registry id' },
    { label: 'secret-credential-scan', kind: 'registry id' },
  ];
  assert.deepEqual(findRegistryNamingCollisions(entries), []);
});

// ---------------------------------------------------------------------------
// Prohibited organizational nouns (warning-level).
// ---------------------------------------------------------------------------

test('findProhibitedNoun matches nouns only as whole hyphen-delimited words', () => {
  assert.equal(findProhibitedNoun('foo-manager'), 'manager');
  assert.equal(findProhibitedNoun('helper-bar'), 'helper');
  assert.equal(findProhibitedNoun('data-util'), 'util');
  assert.equal(findProhibitedNoun('team-lead-report'), 'team');
  // no false positive on a substring embedded in a longer word
  assert.equal(findProhibitedNoun('teamwork-review'), null);
  assert.equal(findProhibitedNoun('utility-audit'), null);
  assert.equal(findProhibitedNoun('code-quality'), null);
});

test('findProhibitedNoun is case-insensitive (gemini #1468)', () => {
  assert.equal(findProhibitedNoun('Foo-Team'), 'team');
  assert.equal(findProhibitedNoun('DATA-UTIL'), 'util');
  assert.equal(findProhibitedNoun('Some-Manager-Skill'), 'manager');
});

test('isProhibitedNounExempt is case-insensitive (gemini #1468)', () => {
  assert.ok(isProhibitedNounExempt('review-team'));
  assert.ok(isProhibitedNounExempt('Review-Team'));
  assert.ok(isProhibitedNounExempt('SETUP-TEAM'));
  assert.ok(!isProhibitedNounExempt('other-team'));
});

// ---------------------------------------------------------------------------
// Anthropic-derived hard constraints (error-level).
// ---------------------------------------------------------------------------

test('findReservedWord flags anthropic/claude anywhere in the name', () => {
  assert.equal(findReservedWord('my-claude-skill'), 'claude');
  assert.equal(findReservedWord('anthropic-helper'), 'anthropic');
  assert.equal(findReservedWord('Claude-Review'), 'claude'); // case-insensitive
  assert.equal(findReservedWord('code-review'), null);
  assert.equal(findReservedWord('river-review'), null);
});

test('name length boundary is inclusive at NAME_MAX_LENGTH', () => {
  assert.equal(NAME_MAX_LENGTH, 64);
  const atLimit = 'a'.repeat(NAME_MAX_LENGTH);
  const overLimit = 'a'.repeat(NAME_MAX_LENGTH + 1);
  assert.ok(atLimit.length <= NAME_MAX_LENGTH);
  assert.ok(overLimit.length > NAME_MAX_LENGTH);
});

// ---------------------------------------------------------------------------
// Hyphen-variant collisions (error-level) — agent-skill names.
// ---------------------------------------------------------------------------

test('normalizeHyphenVariant strips hyphens and lowercases', () => {
  assert.equal(normalizeHyphenVariant('River-Review'), 'riverreview');
  assert.equal(normalizeHyphenVariant('riverreview'), 'riverreview');
});

test('findHyphenVariantCollisions flags names differing only by hyphenation', () => {
  const collisions = findHyphenVariantCollisions(['river-review', 'riverreview', 'code-quality']);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].normalized, 'riverreview');
  assert.deepEqual(collisions[0].names, ['river-review', 'riverreview']);
});

test('findHyphenVariantCollisions is silent on distinct names and verbatim repeats', () => {
  assert.deepEqual(findHyphenVariantCollisions(['a-b', 'c-d', 'e-f']), []);
  // The same name twice is not a self-collision.
  assert.deepEqual(findHyphenVariantCollisions(['a-b', 'a-b']), []);
});

// ---------------------------------------------------------------------------
// Registry / agent-skill cross collisions (error-level).
// ---------------------------------------------------------------------------

test('findRegistryNamingCollisions flags a registry id colliding with an agent-skill name', () => {
  const entries = [
    { label: 'code-review', kind: 'registry id' },
    { label: 'codereview', kind: 'agent-skill' },
    { label: 'unrelated-id', kind: 'registry id' },
  ];
  const collisions = findRegistryNamingCollisions(entries);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].normalized, 'codereview');
  assert.deepEqual(collisions[0].entries.map((e) => e.label).sort(), ['code-review', 'codereview']);
});

test('findRegistryNamingCollisions de-duplicates identical label+kind (no self-collision)', () => {
  const entries = [
    { label: 'same-id', kind: 'registry id' },
    { label: 'same-id', kind: 'registry id' },
  ];
  assert.deepEqual(findRegistryNamingCollisions(entries), []);
});

test('findRegistryNamingCollisions flags the SAME label across different kinds (gemini #1468)', () => {
  // A registry id identical to an agent-skill name is ambiguous at resolution
  // time. No such pair exists in the current data (verified for #1468), so
  // this is error-level with no grandfathering.
  const entries = [
    { label: 'shared-name', kind: 'registry id' },
    { label: 'shared-name', kind: 'agent-skill' },
  ];
  const collisions = findRegistryNamingCollisions(entries);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].normalized, 'sharedname');
  assert.deepEqual(collisions[0].entries.map((e) => e.kind).sort(), ['agent-skill', 'registry id']);
});

// ---------------------------------------------------------------------------
// CLAUDE.md prose ↔ plugin.json command-set parity (#1451/#1463 carry-over).
// ---------------------------------------------------------------------------

const CLAUDE_MD_LINE =
  'Details: distributed commands (`/check` `/pr` `/skill` `/review-local` `/challenge` ' +
  '`/review-team` `/setup-team`) live in top-level `commands/`; repo-dev commands ' +
  '(`/propose-issue` `/plan-merge-order`) stay in `.claude/commands/`.';

function manifestWith(commands) {
  return { commands: commands.map((c) => `./commands/${c}.md`) };
}

test('parseClaudeMdDistributedCommands reads only the first parenthesized group', () => {
  const cmds = parseClaudeMdDistributedCommands(CLAUDE_MD_LINE);
  assert.deepEqual(cmds.sort(), [
    'challenge',
    'check',
    'pr',
    'review-local',
    'review-team',
    'setup-team',
    'skill',
  ]);
  // The trailing repo-dev list (propose-issue, plan-merge-order) is excluded.
  assert.ok(!cmds.includes('propose-issue'));
});

test('checkClaudeMdCommandParity passes when the two command sets match', () => {
  const manifest = manifestWith([
    'check',
    'pr',
    'skill',
    'review-local',
    'challenge',
    'review-team',
    'setup-team',
  ]);
  assert.deepEqual(checkClaudeMdCommandParity(CLAUDE_MD_LINE, manifest), []);
});

test('checkClaudeMdCommandParity flags a command missing from plugin.json', () => {
  const manifest = manifestWith([
    'check',
    'pr',
    'skill',
    'review-local',
    'challenge',
    'review-team',
    // setup-team omitted
  ]);
  const errors = checkClaudeMdCommandParity(CLAUDE_MD_LINE, manifest);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /distributed command "\/setup-team".*does not register/);
});

test('checkClaudeMdCommandParity flags a command missing from CLAUDE.md', () => {
  const manifest = manifestWith([
    'check',
    'pr',
    'skill',
    'review-local',
    'challenge',
    'review-team',
    'setup-team',
    'extra-cmd', // registered but not documented
  ]);
  const errors = checkClaudeMdCommandParity(CLAUDE_MD_LINE, manifest);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /registers command "extra-cmd".*omits it/);
});

test('checkClaudeMdCommandParity reports when the prose list is unfindable', () => {
  const errors = checkClaudeMdCommandParity('no such line here', manifestWith(['check']));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /could not find the "Details: distributed commands/);
});
