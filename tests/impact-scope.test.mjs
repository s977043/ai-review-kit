import assert from 'node:assert/strict';
import test from 'node:test';
import { inferImpactTags } from '../src/lib/impact-scope.mjs';

test('inferImpactTags detects typescript, api, and security signals', () => {
  const tags = inferImpactTags(['src/api/user.ts', 'src/auth/session.ts', 'src/config/env.ts']);
  assert.ok(tags.includes('typescript'));
  assert.ok(tags.includes('api'));
  assert.ok(tags.includes('security'));
});

test('inferImpactTags detects tests', () => {
  const tags = inferImpactTags(['tests/user.test.ts', 'src/app.ts']);
  assert.ok(tags.includes('tests'));
  assert.ok(tags.includes('typescript'));
});

test('inferImpactTags detects observability and reliability', () => {
  const tags = inferImpactTags(['src/logger.ts', 'src/tracing/otel.ts']);
  assert.ok(tags.includes('observability'));
  assert.ok(tags.includes('reliability'));
});

