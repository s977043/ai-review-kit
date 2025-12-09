import assert from 'node:assert/strict';
import test from 'node:test';
import { CostEstimator } from '../../src/core/cost-estimator.js';

test('estimateCost computes cost from tokens', () => {
  const est = new CostEstimator('gpt-3.5-turbo');
  const cost = est.estimateCost(1000, 500);
  assert.equal(cost.model, 'gpt-3.5-turbo');
  assert.ok(cost.usd > 0);
});

test('estimateFromDiff adds skill overhead', () => {
  const est = new CostEstimator('gpt-4-turbo');
  const diff = { tokenEstimate: 2000 };
  const skills = [{}, {}, {}];
  const cost = est.estimateFromDiff(diff, skills);
  assert.ok(cost.inputTokens > diff.tokenEstimate);
});

test('formatCost renders human readable text', () => {
  const est = new CostEstimator('gpt-4');
  const text = est.formatCost({ usd: 0.1234, inputTokens: 1000, outputTokens: 500, model: 'gpt-4' });
  assert.match(text, /Model: gpt-4/);
  assert.match(text, /\$0\.1234/);
});
