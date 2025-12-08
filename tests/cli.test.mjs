import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const CLI_PATH = resolve('src/cli.mjs');

async function runCli(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], { cwd });
    return { code: 0, stdout: stdout.toString(), stderr: stderr?.toString() ?? '' };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? '',
    };
  }
}

async function runGit(args, cwd) {
  return execFileAsync('git', args, { cwd });
}

async function createRepoWithChange() {
  const dir = mkdtempSync(join(tmpdir(), 'river-cli-'));
  await runGit(['init', '-b', 'main'], dir);
  await runGit(['config', 'user.email', 'cli@example.com'], dir);
  await runGit(['config', 'user.name', 'CLI Tester'], dir);

  const readme = join(dir, 'README.md');
  writeFileSync(readme, '# sample\n');
  await runGit(['add', '.'], dir);
  await runGit(['commit', '-m', 'init'], dir);

  writeFileSync(readme, '# sample\nupdated\n');

  return { dir, readme };
}

test('river run emits review comments in dry-run mode', async () => {
  const { dir } = await createRepoWithChange();
  try {
    const result = await runCli(['run', '.', '--dry-run', '--debug'], dir);

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /River Reviewer/);
    assert.match(result.stdout, /Review comments/);
    assert.match(result.stdout, /README.md:/);
    assert.match(result.stdout, /LLM:/);
    assert.match(result.stdout, /Changed files/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('river run reports when there are no changes', async () => {
  const { dir } = await createRepoWithChange();
  try {
    await runGit(['add', '.'], dir);
    await runGit(['commit', '-m', 'apply change'], dir);

    const result = await runCli(['run', '.'], dir);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /No changes to review/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('river run falls back gracefully without API key', async () => {
  const { dir } = await createRepoWithChange();
  try {
    const result = await runCli(['run', '.', '--debug'], dir);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /River Reviewer/);
    assert.match(result.stdout, /LLM: OPENAI_API_KEY/i);
    assert.match(result.stdout, /Review comments/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('river run injects project rules into prompt when present', async () => {
  const { dir } = await createRepoWithChange();
  try {
    const rulesDir = join(dir, '.river');
    await mkdir(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'rules.md'), '- Use App Router\n- Prefer server components');

    const result = await runCli(['run', '.', '--dry-run', '--debug'], dir);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Project rules: present/);
    assert.match(result.stdout, /Project-specific review rules/i);
    assert.match(result.stdout, /Use App Router/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('river run fails gracefully outside git repos', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'river-cli-empty-'));
  await mkdir(resolve(dir, 'nested'));
  const result = await runCli(['run', '.'], dir);

  assert.notStrictEqual(result.code, 0);
  assert.match(result.stderr, /Not a git repository/);
  await rm(dir, { recursive: true, force: true });
});
