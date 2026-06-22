import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const rubricPath = path.join(repoRoot, 'docs', 'eval', 'rubric.yaml');
const rubricSchemaPath = path.join(repoRoot, 'schemas', 'eval-rubric.schema.json');
const ledgerSchemaPath = path.join(repoRoot, 'schemas', 'eval-ledger-entry.schema.json');

const rubric = yaml.load(readFileSync(rubricPath, 'utf8'));
const rubricSchema = JSON.parse(readFileSync(rubricSchemaPath, 'utf8'));
const ledgerSchema = JSON.parse(readFileSync(ledgerSchemaPath, 'utf8'));

describe('eval/rubric.yaml integrity', () => {
  test('has severity, phase, and dimensions top-level sections', () => {
    assert.ok(rubric.severity, 'severity section missing');
    assert.ok(rubric.phase, 'phase section missing');
    assert.ok(Array.isArray(rubric.dimensions), 'dimensions section missing or not array');
  });

  test('validates against schemas/eval-rubric.schema.json', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(rubricSchema);
    const ok = validate(rubric);
    assert.ok(ok, `rubric.yaml schema violations: ${JSON.stringify(validate.errors, null, 2)}`);
  });

  test('dimension weights sum to 1.0 (±1e-9)', () => {
    const total = rubric.dimensions.reduce((acc, d) => acc + d.weight, 0);
    assert.ok(Math.abs(total - 1.0) < 1e-9, `weight sum is ${total}, expected 1.0 (±1e-9)`);
  });

  test('every dimension has a unique id', () => {
    const ids = rubric.dimensions.map((d) => d.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, `duplicate dimension ids: ${ids.join(', ')}`);
  });

  test('every dimension declares a direction', () => {
    for (const d of rubric.dimensions) {
      assert.ok(
        d.direction === 'higher_is_better' || d.direction === 'lower_is_better',
        `dimension '${d.id}' has invalid direction: ${d.direction}`
      );
    }
  });

  test('false_positive_rate is marked lower_is_better', () => {
    const fpr = rubric.dimensions.find((d) => d.id === 'false_positive_rate');
    assert.ok(fpr, 'false_positive_rate dimension not found');
    assert.equal(fpr.direction, 'lower_is_better');
  });

  test('scoringMethod values are within the allowed enum', () => {
    const allowed = new Set(['binary', 'ratio', 'manual']);
    for (const d of rubric.dimensions) {
      assert.ok(
        allowed.has(d.scoringMethod),
        `invalid scoringMethod on ${d.id}: ${d.scoringMethod}`
      );
    }
  });
});

describe('ledger/rubric terminology alignment', () => {
  test('ledger dimensionScores uses scoringMethod (not method)', () => {
    const dimensionItem = ledgerSchema.properties.dimensionScores.items.properties;
    assert.ok(
      dimensionItem.scoringMethod,
      'ledger schema should expose scoringMethod on dimensionScores items'
    );
    assert.ok(
      !dimensionItem.method,
      'ledger schema should no longer expose legacy `method` field on dimensionScores items'
    );
  });

  test('ledger scoringMethod enum matches rubric scoringMethod enum', () => {
    const ledgerEnum = ledgerSchema.properties.dimensionScores.items.properties.scoringMethod.enum;
    const rubricEnum = rubricSchema.properties.dimensions.items.properties.scoringMethod.enum;
    assert.deepEqual([...ledgerEnum].sort(), [...rubricEnum].sort());
  });
});
