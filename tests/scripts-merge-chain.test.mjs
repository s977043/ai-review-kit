// scripts/merge-chain.sh: disposition judgement and the dry-run / stop paths,
// with `gh` stubbed. Fixtures mirror shapes measured on 2026-09-03..05.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { callFunction, createGhStub, fixture, runScriptWithStub } from './helpers/gh-stub.mjs';

const SCRIPT = 'scripts/merge-chain.sh';
const read = (name) => readFileSync(fixture(name), 'utf8');

test('count_human_comments: bots and vercel* are ignored', () => {
  assert.equal(
    callFunction(SCRIPT, 'count_human_comments', [
      read('issue-comments-bots-only.json'),
    ]).stdout.trim(),
    '0'
  );
  assert.equal(
    callFunction(SCRIPT, 'count_human_comments', [
      read('issue-comments-one-human.json'),
    ]).stdout.trim(),
    '1'
  );
});

test('count_human_comments: paginated output (two concatenated arrays) is summed', () => {
  const two = read('issue-comments-one-human.json') + read('issue-comments-one-human.json');
  assert.equal(callFunction(SCRIPT, 'count_human_comments', [two]).stdout.trim(), '2');
});

test('has_blocked_label', () => {
  assert.equal(
    callFunction(SCRIPT, 'has_blocked_label', ['[{"name":"blocked"}]']).stdout.trim(),
    'yes'
  );
  assert.equal(
    callFunction(SCRIPT, 'has_blocked_label', ['[{"name":"enhancement"}]']).stdout.trim(),
    'no'
  );
  assert.equal(callFunction(SCRIPT, 'has_blocked_label', ['[]']).stdout.trim(), 'no');
});

test('failing_required_checks: an older cancelled run beside a newer pass of the same name is green', () => {
  const r = callFunction(SCRIPT, 'failing_required_checks', [
    read('checks-cancelled-then-pass.json'),
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '');
});

test('failing_required_checks: a queued run at 0001-01-01 is pending, not hidden by max_by', () => {
  const r = callFunction(SCRIPT, 'failing_required_checks', [read('checks-queued-zero-time.json')]);
  assert.equal(r.stdout.trim(), 'Unit tests (22.x)\tpending');
});

test('failing_required_checks: all pass / skipping is green', () => {
  assert.equal(
    callFunction(SCRIPT, 'failing_required_checks', [read('checks-all-pass.json')]).stdout.trim(),
    ''
  );
});

function cleanRoutes(pr, pullFile) {
  return [
    { match: new RegExp(`^api repos/owner/repo/pulls/${pr}$`), file: fixture(pullFile) },
    {
      match: new RegExp(`^api --paginate repos/owner/repo/pulls/${pr}/comments`),
      file: fixture('empty-array.json'),
    },
    {
      match: new RegExp(`^api --paginate repos/owner/repo/issues/${pr}/comments`),
      file: fixture('issue-comments-bots-only.json'),
    },
    {
      match: new RegExp(`^pr checks ${pr} --repo owner/repo`),
      file: fixture('checks-all-pass.json'),
    },
  ];
}

test('dry-run: a clean PR is verdict merge, exit 0, and no write op is called', () => {
  const stub = createGhStub(cleanRoutes(101, 'pull-open.json'));
  const r = runScriptWithStub(SCRIPT, ['101'], stub);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^#101\topen\t0\t0\tno\t-\tmerge\t/m);
  assert.match(r.stdout, /gh api --method PUT repos\/owner\/repo\/pulls\/101\/update-branch/);
  assert.ok(
    !stub.calls().some((c) => /--method PUT|pr merge|auth switch/.test(c)),
    `dry-run wrote: ${stub.calls()}`
  );
});

test('dry-run: a blocked label stops with exit 3 and names the item', () => {
  const stub = createGhStub(cleanRoutes(102, 'pull-open-blocked.json'));
  const r = runScriptWithStub(SCRIPT, ['102'], stub);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /#102\topen\t0\t0\tyes\t-\tSTOP:label=blocked\t/);
});

test('dry-run: one human issue comment stops with exit 3', () => {
  const routes = cleanRoutes(101, 'pull-open.json');
  routes[2] = {
    match: /^api --paginate repos\/owner\/repo\/issues\/101\/comments/,
    file: fixture('issue-comments-one-human.json'),
  };
  const r = runScriptWithStub(SCRIPT, ['101'], createGhStub(routes));
  assert.equal(r.status, 3);
  assert.match(r.stdout, /STOP:human-comments=1/);
});

test('dry-run: one line comment stops with exit 3', () => {
  const routes = cleanRoutes(101, 'pull-open.json');
  routes[1] = {
    match: /^api --paginate repos\/owner\/repo\/pulls\/101\/comments/,
    file: fixture('issue-comments-one-human.json'),
  };
  const r = runScriptWithStub(SCRIPT, ['101'], createGhStub(routes));
  assert.equal(r.status, 3);
  assert.match(r.stdout, /STOP:line-comments=3/);
});

test('dry-run: a pending required check stops with exit 3', () => {
  const routes = cleanRoutes(101, 'pull-open.json');
  routes[3] = {
    match: /^pr checks 101 --repo owner\/repo/,
    file: fixture('checks-queued-zero-time.json'),
    exit: 8,
  };
  const r = runScriptWithStub(SCRIPT, ['101'], createGhStub(routes));
  assert.equal(r.status, 3);
  assert.match(r.stdout, /STOP:checks=Unit tests \(22\.x\)=pending/);
});

test('dry-run: an already merged PR is skipped; nothing left means exit 0', () => {
  const stub = createGhStub([
    { match: /^api repos\/owner\/repo\/pulls\/2086$/, file: fixture('pull-merged.json') },
  ]);
  const r = runScriptWithStub(SCRIPT, ['2086'], stub);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /#2086 is already merged; skipped/);
  assert.match(r.stdout, /Nothing to merge/);
});

test('a failed API read exits 2', () => {
  const stub = createGhStub([
    { match: /^api repos\/owner\/repo\/pulls\/101$/, body: 'gh: Not Found (HTTP 404)\n', exit: 1 },
  ]);
  assert.equal(runScriptWithStub(SCRIPT, ['101'], stub).status, 2);
});

test('--execute: a stalled head reported by wait-pr-ready exits 1 before any merge', () => {
  const stub = createGhStub([
    { match: /^api user$/, body: '{"login":"s977043"}\n' },
    ...cleanRoutes(101, 'pull-open.json'),
    {
      match: /^api --method PUT repos\/owner\/repo\/pulls\/101\/update-branch$/,
      body: '{"message":"Updating pull request branch."}\n',
    },
    {
      match: /^api repos\/owner\/repo\/commits\/e1cb880e[0-9a-f]*\/check-runs/,
      body: '{"check_runs":[]}',
    },
    {
      match: /^api repos\/owner\/repo\/actions\/runs\?head_sha=e1cb880e/,
      file: fixture('runs-all-action-required.json'),
    },
  ]);
  const r = runScriptWithStub(SCRIPT, ['--execute', '101'], stub);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(!stub.calls().some((c) => c.startsWith('pr merge')), 'no merge was attempted');
});

test('--execute: a merge-conflict 422 on update-branch exits 1 and prints the procedure', () => {
  const stub = createGhStub([
    { match: /^api user$/, body: '{"login":"s977043"}\n' },
    ...cleanRoutes(101, 'pull-open.json'),
    {
      match: /^api --method PUT repos\/owner\/repo\/pulls\/101\/update-branch$/,
      body: 'gh: merge conflict between base and head (HTTP 422)\n',
      exit: 1,
    },
    {
      match: /^api repos\/owner\/repo\/actions\/runs\?head_sha=e1cb880e/,
      file: fixture('runs-all-action-required.json'),
    },
  ]);
  const r = runScriptWithStub(SCRIPT, ['--execute', '101'], stub);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /pr-unstall\.sh/);
});

test('--execute: a clean PR is merged with the PR title as the squash subject', () => {
  const stub = createGhStub([
    { match: /^api user$/, body: '{"login":"s977043"}\n' },
    ...cleanRoutes(101, 'pull-open.json'),
    {
      match: /^api --method PUT repos\/owner\/repo\/pulls\/101\/update-branch$/,
      body: 'gh: There are no new commits on the base branch. (HTTP 422)\n',
      exit: 1,
    },
    {
      match: /^api repos\/owner\/repo\/commits\/e1cb880e[0-9a-f]*\/check-runs/,
      body: '{"check_runs":[{"name":"Lint","conclusion":"success"}]}',
    },
    {
      match: /^api repos\/owner\/repo\/actions\/runs\?head_sha=e1cb880e/,
      file: fixture('runs-executed.json'),
    },
    {
      match:
        /^pr merge 101 --repo owner\/repo --squash --delete-branch --subject fix\(x\): #100 example \(#101\)$/,
      body: '',
    },
  ]);
  const r = runScriptWithStub(SCRIPT, ['--execute', '101'], stub);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /merged #101/);
  assert.match(r.stdout, /All PRs merged/);
});

test('--execute: disposition stop exits 3 and merges nothing', () => {
  const stub = createGhStub([
    { match: /^api user$/, body: '{"login":"s977043"}\n' },
    ...cleanRoutes(102, 'pull-open-blocked.json'),
    {
      match: /^api --method PUT repos\/owner\/repo\/pulls\/102\/update-branch$/,
      body: '{"message":"Updating pull request branch."}\n',
    },
    {
      match: /^api repos\/owner\/repo\/commits\/aaaa[0-9a-f]*\/check-runs/,
      body: '{"check_runs":[]}',
    },
    {
      match: /^api repos\/owner\/repo\/actions\/runs\?head_sha=aaaa/,
      file: fixture('runs-executed.json'),
    },
  ]);
  const r = runScriptWithStub(SCRIPT, ['--execute', '102'], stub);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /stopped at #102: label=blocked/);
  assert.ok(!stub.calls().some((c) => c.startsWith('pr merge')));
});

test('usage errors exit 64', () => {
  const stub = createGhStub([]);
  assert.equal(runScriptWithStub(SCRIPT, [], stub).status, 64);
  assert.equal(runScriptWithStub(SCRIPT, ['--execute'], stub).status, 64);
  assert.equal(runScriptWithStub(SCRIPT, ['12x'], stub).status, 64);
});
