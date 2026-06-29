import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'src', 'cli.mjs');

function run(args) {
  try {
    const stdout = execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd: repoRoot });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('skills resolve lists deterministic skills for a midstream ts path', () => {
  const { code, stdout } = run([
    'skills',
    'resolve',
    '--phase',
    'midstream',
    '--path',
    'src/app.ts',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /Resolved skills \(phase=midstream/);
  assert.match(stdout, /typescript-strict|type-driven-design/);
});

test('skills resolve --output json returns a machine-readable plan', () => {
  const { code, stdout } = run([
    'skills',
    'resolve',
    '--phase',
    'midstream',
    '--path',
    'src/app.ts',
    '--output',
    'json',
  ]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.phase, 'midstream');
  assert.deepEqual(parsed.paths, ['src/app.ts']);
  assert.ok(Array.isArray(parsed.selected) && parsed.selected.length > 0);
  assert.ok(Array.isArray(parsed.skipped));
});

test('skills resolve without --path fails fast with guidance', () => {
  const { code, stderr } = run(['skills', 'resolve']);
  assert.equal(code, 1);
  assert.match(stderr, /requires at least one --path/);
});

test('skills resolve supports multiple --path flags', () => {
  const { code, stdout } = run([
    'skills',
    'resolve',
    '--phase',
    'midstream',
    '--path',
    'src/app.ts',
    '--path',
    'docs/design.md',
    '--output',
    'json',
  ]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(parsed.paths, ['src/app.ts', 'docs/design.md']);
});
