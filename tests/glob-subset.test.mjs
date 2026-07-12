import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expandBraces,
  globOverlaps,
  globContains,
  isDecidableGlob,
} from '../scripts/lib/glob-subset.mjs';

test('expandBraces expands a single group', () => {
  assert.deepEqual(expandBraces('src/**/*.{tsx,jsx,vue,svelte}'), [
    'src/**/*.tsx',
    'src/**/*.jsx',
    'src/**/*.vue',
    'src/**/*.svelte',
  ]);
});

test('expandBraces returns the input when there is no group', () => {
  assert.deepEqual(expandBraces('src/**/*.ts'), ['src/**/*.ts']);
});

test('expandBraces handles multiple groups (cartesian)', () => {
  assert.deepEqual(expandBraces('{a,b}/*.{ts,js}'), ['a/*.ts', 'a/*.js', 'b/*.ts', 'b/*.js']);
});

test('expandBraces leaves an unbalanced brace literal', () => {
  assert.deepEqual(expandBraces('src/{ts'), ['src/{ts']);
});

test('globContains: routes subset of src', () => {
  assert.equal(globContains('src/**/*.ts', 'src/routes/**/*.ts'), 'yes');
  assert.equal(globContains('src/routes/**/*.ts', 'src/**/*.ts'), 'no');
});

test('globContains: distinguishes extensions exactly', () => {
  assert.equal(globContains('src/**/*.tsx', 'src/**/*.ts'), 'no');
  assert.equal(globContains('app/**/*.tsx', 'app/**/*.tsx'), 'yes');
  assert.equal(globContains('**/*.css', 'src/**/*.css'), 'yes');
});

test('globContains: globstar matches zero segments', () => {
  assert.equal(globContains('**/x.ts', 'x.ts'), 'yes');
  assert.equal(globContains('a/**', 'a'), 'yes');
  assert.equal(globContains('a/**/b', 'a/b'), 'yes');
});

test('globContains: literal path membership', () => {
  assert.equal(globContains('app/**/*.tsx', 'app/a/b/c.tsx'), 'yes');
  assert.equal(globContains('app/**/*.tsx', 'app/x.ts'), 'no');
});

test('globOverlaps: shared vs disjoint paths', () => {
  assert.equal(globOverlaps('src/**/*.tsx', '**/*.tsx'), 'yes');
  assert.equal(globOverlaps('src/**/*.html', 'src/routes/**/*.ts'), 'no');
  assert.equal(globOverlaps('**/*.sql', 'src/**/*.ts'), 'no');
  assert.equal(globOverlaps('tests/**/*', '**/*.test.ts'), 'yes');
});

test('unsupported grammar is undecidable, never a hard yes/no', () => {
  assert.equal(isDecidableGlob('src/**/*.[jt]s'), false);
  assert.equal(globContains('src/**/*.[jt]s', 'src/a.ts'), 'unknown');
  assert.equal(globOverlaps('src/**/*.[jt]s', 'src/a.ts'), 'unknown');
});
