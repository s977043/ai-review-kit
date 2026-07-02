import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

// .claude/hooks/gh-account-guard.sh (PreToolUse hook) を実プロセス実行で検証する。
// 実際の gh keyring に触れないよう、PATH 先頭に stub gh を注入する。
const HOOK = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.claude',
  'hooks',
  'gh-account-guard.sh'
);

const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_GH_LOG"
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  printf '%s\\n' "\${FAKE_GH_LOGIN:-s977043}"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "switch" ]; then
  exit "\${FAKE_GH_SWITCH_EXIT:-0}"
fi
exit 0
`;

function makeStub() {
  const dir = mkdtempSync(join(tmpdir(), 'rr-gh-guard-'));
  const gh = join(dir, 'gh');
  writeFileSync(gh, GH_STUB);
  chmodSync(gh, 0o755);
  const log = join(dir, 'gh-calls.log');
  return { dir, log };
}

function runHook(command, { login = 's977043', switchExit = 0 } = {}) {
  const { dir, log } = makeStub();
  const input = JSON.stringify({ tool_input: { command } });
  const res = spawnSync('bash', [HOOK], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      FAKE_GH_LOG: log,
      FAKE_GH_LOGIN: login,
      FAKE_GH_SWITCH_EXIT: String(switchExit),
      GH_ACCOUNT_GUARD_EXPECTED: 's977043',
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim() : '';
  return { status: res.status, stderr: res.stderr, calls };
}

test('non-gh command passes without invoking gh', () => {
  const r = runHook('git push origin feat/x');
  assert.equal(r.status, 0);
  assert.equal(r.calls, '');
});

test('gh read ops pass without invoking gh', () => {
  for (const cmd of [
    'gh pr view 123 --json url',
    'gh pr checks 1368',
    'gh api repos/s977043/river-review/pulls/1',
    'gh api user --jq .login',
    'gh release list',
    'gh auth status',
  ]) {
    const r = runHook(cmd);
    assert.equal(r.status, 0, cmd);
    assert.equal(r.calls, '', cmd);
  }
});

test('gh write op with expected account passes (login checked, no switch)', () => {
  const r = runHook('gh pr create --title x --body y', { login: 's977043' });
  assert.equal(r.status, 0);
  assert.match(r.calls, /api user --jq \.login/);
  assert.doesNotMatch(r.calls, /auth switch/);
});

test('gh write op with wrong account switches and proceeds', () => {
  const r = runHook('gh pr merge 42 --squash', { login: 'kominem-unilabo' });
  assert.equal(r.status, 0);
  assert.match(r.calls, /auth switch -u s977043/);
  assert.match(r.stderr, /switched to 's977043'/);
});

test('gh write op blocks (exit 2) when switch also fails', () => {
  const r = runHook('gh issue create --title t', {
    login: 'kominem-unilabo',
    switchExit: 1,
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /BLOCKED/);
});

test('write-op detection covers api methods, body fields, and compound commands', () => {
  for (const cmd of [
    'gh api repos/a/b/pulls/1/update-branch -X PUT',
    'gh api repos/a/b/issues -f title=hi',
    'git push origin HEAD && gh pr create --fill',
    'gh workflow run release-please.yml',
    'gh release create v1.0.0',
  ]) {
    const r = runHook(cmd, { login: 'kominem-unilabo' });
    assert.equal(r.status, 0, cmd);
    assert.match(r.calls, /auth switch -u s977043/, cmd);
  }
});

test('gh api with explicit GET is treated as read', () => {
  const r = runHook('gh api repos/a/b/pulls -X GET | jq .[0]', {
    login: 'kominem-unilabo',
  });
  assert.equal(r.status, 0);
  assert.equal(r.calls, '');
});

test('empty or malformed stdin payload passes', () => {
  for (const input of ['', '{not json']) {
    const res = spawnSync('bash', [HOOK], { input, encoding: 'utf8' });
    assert.equal(res.status, 0, JSON.stringify(input));
  }
});
