/**
 * Deterministic command allowlist validation-layer tests (#1401 §10.1).
 *
 * Covers each validation rule (§10.1.2 (A)–(E)) plus adversarial cases:
 * absolute-path enforcement, interpreter denylist, danger-flag denylist
 * (including `--eval=x` normalization), `@file` argument-file rejection
 * (gemini #1426), selfContained gating, exact argv matching, and safe
 * handling of malformed YAML.
 *
 * This is a pure validation layer — no process is ever spawned; the test file
 * asserts that too (no child_process import in the module under test).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseAllowlist,
  validateAllowlistEntry,
  loadValidAllowlist,
  matchCommand,
  DETERMINISTIC_UNRUNNABLE,
} from '../src/lib/deterministic-command-allowlist.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function goodEntry(overrides = {}) {
  return {
    command: '/usr/bin/actionlint',
    args: ['-color', 'never'],
    selfContained: true,
    ...overrides,
  };
}

describe('validateAllowlistEntry — (A) absolute path', () => {
  test('absolute path OK', () => {
    assert.equal(validateAllowlistEntry(goodEntry()).valid, true);
  });

  test('relative path rejected', () => {
    const r = validateAllowlistEntry(goodEntry({ command: './bin/actionlint' }));
    assert.equal(r.valid, false);
    assert.match(r.reason, /absolute path/);
  });

  test('bare PATH-lookup name rejected', () => {
    const r = validateAllowlistEntry(goodEntry({ command: 'actionlint' }));
    assert.equal(r.valid, false);
    assert.match(r.reason, /absolute path/);
  });

  test('missing command rejected', () => {
    const r = validateAllowlistEntry({ args: [], selfContained: true });
    assert.equal(r.valid, false);
  });
});

describe('validateAllowlistEntry — (C) interpreter denylist', () => {
  for (const interp of [
    'npm',
    'npx',
    'node',
    'nodejs',
    'bash',
    'sh',
    'python3',
    'make',
    'env',
    'xargs',
  ]) {
    test(`interpreter ${interp} rejected even at absolute path`, () => {
      const r = validateAllowlistEntry(goodEntry({ command: `/usr/bin/${interp}`, args: [] }));
      assert.equal(r.valid, false);
      assert.match(r.reason, /interpreter/);
    });
  }

  test('trailing-slash path does not bypass the interpreter denylist (gemini #1427)', () => {
    // `/usr/bin/node/` must still resolve basename to `node`, not "".
    const r = validateAllowlistEntry(goodEntry({ command: '/usr/bin/node/', args: [] }));
    assert.equal(r.valid, false);
    assert.match(r.reason, /interpreter/);
  });

  for (const interp of ['dash', 'ksh', 'fish', 'pwsh', 'powershell', 'osascript']) {
    test(`shell interpreter ${interp} rejected (gemini #1427)`, () => {
      const r = validateAllowlistEntry(goodEntry({ command: `/usr/bin/${interp}`, args: [] }));
      assert.equal(r.valid, false);
      assert.match(r.reason, /interpreter/);
    });
  }
});

describe('validateAllowlistEntry — (B) danger flags', () => {
  for (const flag of [
    '-e',
    '--eval',
    '-c',
    '--command',
    '-p',
    '-r',
    '--require',
    '--import',
    'run',
    'exec',
    'dlx',
    '-x',
    '-lc',
    '--rcfile',
    '--init-file',
    '--config',
    '--rc',
  ]) {
    test(`danger flag ${flag} rejected`, () => {
      const r = validateAllowlistEntry(goodEntry({ args: [flag] }));
      assert.equal(r.valid, false);
      assert.match(r.reason, /dangerous flag/);
    });
  }

  test('--eval=x form rejected (normalized on `=`)', () => {
    const r = validateAllowlistEntry(goodEntry({ args: ['--eval=require("fs")'] }));
    assert.equal(r.valid, false);
    assert.match(r.reason, /dangerous flag/);
  });

  test('--config=./evil.js form rejected (normalized on `=`)', () => {
    const r = validateAllowlistEntry(goodEntry({ args: ['--config=./evil.js'] }));
    assert.equal(r.valid, false);
  });

  test('benign args accepted', () => {
    assert.equal(validateAllowlistEntry(goodEntry({ args: ['-color', 'never', '.'] })).valid, true);
  });

  test('non-string args rejected', () => {
    const r = validateAllowlistEntry(goodEntry({ args: ['ok', 123] }));
    assert.equal(r.valid, false);
  });
});

describe('validateAllowlistEntry — @file argument-file (gemini #1426)', () => {
  test('@file arg rejected', () => {
    const r = validateAllowlistEntry(goodEntry({ args: ['@argfile.txt'] }));
    assert.equal(r.valid, false);
    assert.match(r.reason, /@-prefixed/);
  });

  test('@ alone rejected', () => {
    const r = validateAllowlistEntry(goodEntry({ args: ['@'] }));
    assert.equal(r.valid, false);
  });
});

describe('validateAllowlistEntry — (A) selfContained gating', () => {
  test('selfContained undefined rejected', () => {
    const e = goodEntry();
    delete e.selfContained;
    const r = validateAllowlistEntry(e);
    assert.equal(r.valid, false);
    assert.match(r.reason, /selfContained/);
  });

  test('selfContained false rejected', () => {
    const r = validateAllowlistEntry(goodEntry({ selfContained: false }));
    assert.equal(r.valid, false);
  });

  test('selfContained truthy-but-not-true (1) rejected', () => {
    const r = validateAllowlistEntry(goodEntry({ selfContained: 1 }));
    assert.equal(r.valid, false);
  });
});

describe('parseAllowlist', () => {
  test('valid YAML parsed', () => {
    const yaml = `version: 1
commands:
  - id: actionlint
    command: /usr/bin/actionlint
    args: ['-color', 'never']
    selfContained: true
`;
    const parsed = parseAllowlist(yaml);
    assert.ok(!('error' in parsed));
    assert.equal(parsed.commands.length, 1);
    assert.equal(parsed.version, 1);
  });

  test('malformed YAML returns {error}, does not throw', () => {
    const parsed = parseAllowlist('version: 1\ncommands: [oops: : :');
    assert.ok('error' in parsed);
    assert.match(parsed.error, /invalid YAML/);
  });

  test('non-mapping root returns {error}', () => {
    assert.ok('error' in parseAllowlist('- a\n- b'));
  });

  test('missing commands list returns {error}', () => {
    assert.ok('error' in parseAllowlist('version: 1'));
  });

  test('non-object entry returns {error}', () => {
    assert.ok('error' in parseAllowlist('version: 1\ncommands:\n  - just-a-string'));
  });

  test('empty / null input returns {error}', () => {
    assert.ok('error' in parseAllowlist(''));
  });
});

describe('loadValidAllowlist', () => {
  test('splits valid and rejected entries', () => {
    const yaml = `version: 1
commands:
  - command: /usr/bin/actionlint
    args: ['-color', 'never']
    selfContained: true
  - command: /usr/bin/npm
    args: ['run', 'lint']
    selfContained: true
  - command: relative/tool
    selfContained: true
`;
    const { valid, rejected } = loadValidAllowlist(yaml);
    assert.equal(valid.length, 1);
    assert.equal(rejected.length, 2);
    assert.equal(valid[0].command, '/usr/bin/actionlint');
    for (const r of rejected) assert.match(r.reason, new RegExp(DETERMINISTIC_UNRUNNABLE));
  });

  test('malformed YAML → empty valid + one rejected carrying parse error', () => {
    const { valid, rejected } = loadValidAllowlist('commands: [: : :');
    assert.equal(valid.length, 0);
    assert.equal(rejected.length, 1);
  });
});

describe('matchCommand — exact argv equality', () => {
  const valid = loadValidAllowlist(`version: 1
commands:
  - command: /usr/bin/actionlint
    args: ['-color', 'never']
    selfContained: true
`).valid;

  test('exact command+args matches', () => {
    const m = matchCommand({ command: '/usr/bin/actionlint', args: ['-color', 'never'] }, valid);
    assert.ok(m);
    assert.equal(m.command, '/usr/bin/actionlint');
  });

  test('args order difference does NOT match', () => {
    assert.equal(
      matchCommand({ command: '/usr/bin/actionlint', args: ['never', '-color'] }, valid),
      null
    );
  });

  test('partial args (prefix) does NOT match', () => {
    assert.equal(matchCommand({ command: '/usr/bin/actionlint', args: ['-color'] }, valid), null);
  });

  test('extra args does NOT match', () => {
    assert.equal(
      matchCommand({ command: '/usr/bin/actionlint', args: ['-color', 'never', '.'] }, valid),
      null
    );
  });

  test('different command does NOT match', () => {
    assert.equal(
      matchCommand({ command: '/usr/bin/other', args: ['-color', 'never'] }, valid),
      null
    );
  });

  test('missing gate args treated as empty array', () => {
    const v2 = loadValidAllowlist(`version: 1
commands:
  - command: /usr/bin/checker
    selfContained: true
`).valid;
    assert.ok(matchCommand({ command: '/usr/bin/checker' }, v2));
    assert.equal(matchCommand({ command: '/usr/bin/checker', args: ['x'] }, v2), null);
  });

  test('null gate / empty entries safe', () => {
    assert.equal(matchCommand(null, valid), null);
    assert.equal(matchCommand({ command: '/usr/bin/actionlint' }, null), null);
  });

  test('null / undefined entries in the list do not crash (gemini #1427 defensive)', () => {
    const entries = [
      null,
      undefined,
      { command: '/usr/bin/actionlint', args: ['-color', 'never'] },
    ];
    assert.ok(matchCommand({ command: '/usr/bin/actionlint', args: ['-color', 'never'] }, entries));
    assert.equal(matchCommand(null, entries), null);
  });
});

describe('no child process usage in the module (constraint)', () => {
  test('source imports no child_process / spawn / execFile / exec', () => {
    const raw = fs.readFileSync(
      path.join(HERE, '..', 'src', 'lib', 'deterministic-command-allowlist.mjs'),
      'utf8'
    );
    // Strip block and line comments so the doc comment (which names these
    // banned APIs to explain their absence) does not trip the check; only
    // real code — imports and call sites — must be free of them.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /child_process/);
    assert.doesNotMatch(code, /\bspawn\s*\(/);
    assert.doesNotMatch(code, /\bexecFile\s*\(/);
    assert.doesNotMatch(code, /\bexec\s*\(/);
    assert.doesNotMatch(code, /from\s+['"](?:node:)?child_process['"]/);
    assert.doesNotMatch(code, /require\(\s*['"](?:node:)?child_process['"]\s*\)/);
  });
});
