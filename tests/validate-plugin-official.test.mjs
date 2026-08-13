import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_WARNINGS,
  TARGETS,
  classifyFindings,
  parseFindings,
  validateWithOfficialCli,
} from '../scripts/validate-plugin-official.mjs';

// Real output shapes captured from `claude plugin validate` (v2.x).
const WARNING_OUTPUT = `Validating plugin manifest: /repo/.claude-plugin/plugin.json

⚠ Found 1 warning:

  ❯ composerIcon: Unknown field 'composerIcon'. Claude Code ignores it at load time.

Validating plugin: /repo/CLAUDE.md

⚠ Found 1 warning:

  ❯ root: CLAUDE.md at the plugin root is not loaded as project context. To ship context with your plugin, use a skill (skills/<name>/SKILL.md) instead.

✘ Validation failed (--strict treats warnings as errors)
`;

const ERROR_OUTPUT = `Validating plugin manifest: /repo/.claude-plugin/plugin.json

✘ Found 3 errors:

  ❯ name: Plugin name cannot contain spaces. Use kebab-case (e.g., "my-plugin")
  ❯ version: Invalid input: expected string, received number
  ❯ commands[0]: Path not found: ./nope.md. The runtime loader will report this as a load failure.

✘ Validation failed
`;

test('parseFindings labels findings by their section header', () => {
  const warnings = parseFindings(WARNING_OUTPUT);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((f) => f.kind === 'warning'));

  const errors = parseFindings(ERROR_OUTPUT);
  assert.equal(errors.length, 3);
  assert.ok(errors.every((f) => f.kind === 'error'));
});

test('classifyFindings accepts only the documented warnings', () => {
  const { accepted, blocking } = classifyFindings(parseFindings(WARNING_OUTPUT));
  assert.equal(blocking.length, 0);
  assert.deepEqual(accepted.map((f) => f.id).sort(), [
    'root-claude-md-not-context',
    'unknown-field-composer-icon',
  ]);
});

test('classifyFindings never accepts errors, even ones matching an accepted pattern', () => {
  const findings = [{ kind: 'error', message: "composerIcon: Unknown field 'composerIcon'." }];
  const { accepted, blocking } = classifyFindings(findings);
  assert.equal(accepted.length, 0);
  assert.equal(blocking.length, 1);
});

test('classifyFindings blocks a new, undocumented warning', () => {
  const output = `⚠ Found 1 warning:

  ❯ hooks: Unknown field 'somethingNew'.
`;
  const { blocking } = classifyFindings(parseFindings(output));
  assert.equal(blocking.length, 1);
  assert.match(blocking[0].message, /somethingNew/);
});

test('ACCEPTED_WARNINGS entries all carry an id, a pattern and a reason', () => {
  for (const entry of ACCEPTED_WARNINGS) {
    assert.equal(typeof entry.id, 'string');
    assert.ok(entry.pattern instanceof RegExp);
    assert.ok(entry.reason.length > 20, `reason for ${entry.id} must explain the decision`);
  }
});

test('validateWithOfficialCli skips (exit-0 path) when the claude CLI is absent', () => {
  const fakeRun = () => ({ error: new Error('ENOENT'), status: null });
  const result = validateWithOfficialCli(fakeRun);
  assert.equal(result.skipped, true);
  assert.deepEqual(result.blocking, []);
});

test('validateWithOfficialCli fails when the CLI exits non-zero with unparsable output', () => {
  const calls = [];
  const fakeRun = (cmd, args) => {
    calls.push(args);
    if (args[0] === '--version') return { status: 0, stdout: '2.0.0' };
    return { status: 2, stdout: '', stderr: 'boom' };
  };
  const result = validateWithOfficialCli(fakeRun);
  assert.equal(result.skipped, false);
  assert.equal(result.blocking.length, TARGETS.length);
  assert.match(result.blocking[0].message, /no parsable finding/);
});
