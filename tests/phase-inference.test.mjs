// #1565 Stage 1 — inferPhase() unit tests.
//
// Covers the deterministic rule table (docs-only -> upstream, test-only ->
// downstream, app -> midstream) and the fail-safe default (empty / config /
// infra / schema / migration / unknown / undecidable mix -> midstream).

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { inferPhase } from '../src/lib/phase-inference.mjs';
import { classifyChangedFiles } from '../src/lib/file-classifier.mjs';

const EMPTY = {
  config: [],
  schema: [],
  migration: [],
  app: [],
  test: [],
  infra: [],
  docs: [],
  unknown: [],
};

function withTypes(overrides) {
  return { ...EMPTY, ...overrides };
}

describe('inferPhase — rule table', () => {
  test('rule 1: docs-only diff -> upstream', () => {
    const result = inferPhase(withTypes({ docs: ['docs/adr/001.md', 'README.md'] }));
    assert.equal(result.phase, 'upstream');
    assert.equal(result.confidence, 'high');
    assert.match(result.reason, /docs-only diff \(2 files\)/);
  });

  test('rule 1: single CHANGELOG.md (docs) -> upstream', () => {
    const result = inferPhase(withTypes({ docs: ['CHANGELOG.md'] }));
    assert.equal(result.phase, 'upstream');
    assert.match(result.reason, /docs-only diff \(1 file\)/);
  });

  test('rule 2: test-only diff -> downstream', () => {
    const result = inferPhase(withTypes({ test: ['tests/a.test.mjs'] }));
    assert.equal(result.phase, 'downstream');
    assert.equal(result.confidence, 'high');
    assert.match(result.reason, /test-only diff \(1 file\)/);
  });

  test('rule 2: tests plus docs but no app -> downstream', () => {
    const result = inferPhase(withTypes({ test: ['tests/a.test.mjs'], docs: ['docs/x.md'] }));
    assert.equal(result.phase, 'downstream');
  });

  test('rule 3: app changes -> midstream', () => {
    const result = inferPhase(withTypes({ app: ['src/app.ts'] }));
    assert.equal(result.phase, 'midstream');
    assert.equal(result.confidence, 'high');
    assert.match(result.reason, /app diff \(1 file\)/);
  });

  test('rule 3: app plus tests (implementation with tests) -> midstream', () => {
    const result = inferPhase(withTypes({ app: ['src/app.ts'], test: ['tests/a.test.mjs'] }));
    assert.equal(result.phase, 'midstream');
  });

  test('rule 3: app plus docs -> midstream', () => {
    const result = inferPhase(withTypes({ app: ['src/app.ts'], docs: ['docs/x.md'] }));
    assert.equal(result.phase, 'midstream');
  });
});

describe('inferPhase — fail-safe (rule 4)', () => {
  test('empty classification -> midstream (low confidence)', () => {
    const result = inferPhase(EMPTY);
    assert.equal(result.phase, 'midstream');
    assert.equal(result.confidence, 'low');
  });

  test('config / infra only -> midstream', () => {
    const result = inferPhase(
      withTypes({ config: ['package.json'], infra: ['.github/workflows/ci.yml'] })
    );
    assert.equal(result.phase, 'midstream');
    assert.equal(result.confidence, 'low');
  });

  test('schema-only -> midstream (conservative, not upstream)', () => {
    const result = inferPhase(withTypes({ schema: ['schemas/x.schema.json'] }));
    assert.equal(result.phase, 'midstream');
  });

  test('migration-only -> midstream', () => {
    const result = inferPhase(withTypes({ migration: ['migrations/001.sql'] }));
    assert.equal(result.phase, 'midstream');
  });

  test('unknown-only -> midstream', () => {
    const result = inferPhase(withTypes({ unknown: ['weird.xyz'] }));
    assert.equal(result.phase, 'midstream');
  });

  test('docs plus schema (docs not sole signal) -> midstream fail-safe', () => {
    const result = inferPhase(
      withTypes({ docs: ['docs/x.md'], schema: ['schemas/x.schema.json'] })
    );
    assert.equal(result.phase, 'midstream');
  });
});

describe('inferPhase — robustness', () => {
  test('missing keys are treated as empty (no throw)', () => {
    assert.equal(inferPhase({ docs: ['docs/x.md'] }).phase, 'upstream');
    assert.equal(inferPhase({}).phase, 'midstream');
  });

  test('undefined / null input -> midstream fail-safe', () => {
    assert.equal(inferPhase(undefined).phase, 'midstream');
    assert.equal(inferPhase(null).phase, 'midstream');
  });

  test('deterministic: same input yields identical output', () => {
    const input = withTypes({ app: ['src/a.ts'] });
    assert.deepEqual(inferPhase(input), inferPhase(input));
  });
});

describe('inferPhase — integration with classifyChangedFiles', () => {
  test('docs-only file list classifies then infers upstream', () => {
    const ft = classifyChangedFiles(['docs/design/plan.md', 'pages/reference/x.md']);
    assert.equal(inferPhase(ft).phase, 'upstream');
  });

  test('test-only file list infers downstream', () => {
    const ft = classifyChangedFiles(['tests/foo.test.mjs']);
    assert.equal(inferPhase(ft).phase, 'downstream');
  });

  test('app file list infers midstream', () => {
    const ft = classifyChangedFiles(['src/lib/foo.mjs']);
    assert.equal(inferPhase(ft).phase, 'midstream');
  });
});
