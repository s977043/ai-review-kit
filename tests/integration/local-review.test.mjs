import assert from 'node:assert';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const CLI_PATH = resolve('src/cli.mjs');
const SAMPLE_DIFF = resolve('tests/fixtures/sample-diff.txt');
const SAMPLE_RULES = resolve('tests/fixtures/.river/rules.md');

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

async function applySampleDiff(repoDir) {
  const raw = await fs.promises.readFile(SAMPLE_DIFF, 'utf8');
  const lines = raw
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1));
  const targetPath = join(repoDir, 'src', 'utils');
  await mkdir(targetPath, { recursive: true });
  await fs.promises.writeFile(join(targetPath, 'math.ts'), `${lines.join('\n')}\n`, 'utf8');
}

async function setupRepoWithDiff() {
  const dir = mkdtempSync(join(tmpdir(), 'river-int-'));
  await runGit(['init', '-b', 'main'], dir);
  await runGit(['config', 'user.email', 'integration@example.com'], dir);
  await runGit(['config', 'user.name', 'Integration Tester'], dir);
  await runGit(['commit', '--allow-empty', '-m', 'init'], dir);
  await applySampleDiff(dir);
  await runGit(['add', '.'], dir);
  const rulesDir = join(dir, '.river');
  await mkdir(rulesDir, { recursive: true });
  await fs.promises.copyFile(SAMPLE_RULES, join(rulesDir, 'rules.md'));
  return dir;
}

test('runs dry-run review with sample diff and project rules', async () => {
  const dir = await setupRepoWithDiff();
  try {
    const result = await runCli(['run', '.', '--dry-run', '--debug'], dir);

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /River Reviewer/);
    assert.match(result.stdout, /Project rules: present/);
    assert.match(result.stdout, /src\/utils\/math.ts/);
    assert.match(result.stdout, /Review comments/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('respects phase flag in integration run', async () => {
  const dir = await setupRepoWithDiff();
  try {
    const result = await runCli(['run', '.', '--phase', 'downstream', '--dry-run'], dir);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Phase: downstream/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('debug output shows token estimation and reduction', async () => {
  const dir = await setupRepoWithDiff();
  try {
    const result = await runCli(['run', '.', '--dry-run', '--debug'], dir);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Token estimate/);
    assert.match(result.stdout, /Changed files/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fails clearly when project rules cannot be read', async () => {
  const dir = await setupRepoWithDiff();
  try {
    const rulesPath = join(dir, '.river', 'rules.md');
    await fs.promises.rm(rulesPath, { force: true });
    await fs.promises.mkdir(rulesPath, { recursive: true });
    const result = await runCli(['run', '.'], dir);

    assert.notStrictEqual(result.code, 0);
    assert.match(result.stderr, /Failed to read project rules/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
