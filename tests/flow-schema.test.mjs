// Contract tests for schemas/flow.schema.json (#2013, Epic #2011).
//
// The Flow contract has no builder yet — #2013 stops at schema + fixtures and
// leaves the execution engine to a follow-up — so the positive case validates a
// fixture rather than the output of a production function. The two vocabularies
// the schema borrows are NOT re-derived here: the stop-condition and reviewer
// role lists are imported from their production modules and pinned against the
// schema, so a Flow can never grow a second reason-code or role ledger.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

import { GATE_REASON_CODES } from '../src/lib/gate-decision.mjs';
import { REVIEWER_ROLES } from '../src/lib/reviewer-orchestrator.mjs';
import { compileFlowValidator } from './helpers/schema-validator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(HERE, '..', 'schemas', 'flow.schema.json');
const FIXTURES_DIR = resolve(HERE, 'fixtures', 'flow');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readFixture = (name) => readJson(resolve(FIXTURES_DIR, name));

// Compiled once at module scope (ajv compile is expensive, the schema is
// static). Strict mode stays on so future schema typos surface here.
const validate = compileFlowValidator();
const schema = readJson(SCHEMA_PATH);

/** Deep clone of the happy fixture, so each negative case mutates in isolation. */
const happy = () => readFixture('final-review-happy.json');

const errorsOf = () => JSON.stringify(validate.errors, null, 2);

describe('flow.schema.json', () => {
  test('happy fixture conforms to the schema', () => {
    assert.equal(validate(happy()), true, errorsOf());
  });

  test('guard fixture with an unknown step primitive is rejected', () => {
    // The #2013 fail-safe criterion: an unknown primitive must fail validation
    // at load time, not be skipped while the rest of the Flow keeps running.
    assert.equal(validate(readFixture('unknown-primitive-guard.json')), false);
  });

  test('missing required field is rejected', () => {
    const flow = happy();
    delete flow.version;
    assert.equal(validate(flow), false);
  });

  test('extra top-level property is rejected', () => {
    const flow = happy();
    flow.runtime = 'claude-code';
    assert.equal(validate(flow), false);
  });

  test('unknown agent role is rejected', () => {
    const flow = happy();
    flow.steps[3] = { agent: 'consistency-judge' };
    assert.equal(validate(flow), false);
  });

  test('unknown stop condition is rejected', () => {
    const flow = happy();
    flow.stopConditions = ['missing-required-artifact'];
    assert.equal(validate(flow), false);
  });

  test('non-semver version is rejected', () => {
    const flow = happy();
    flow.version = '0.1';
    assert.equal(validate(flow), false);
  });

  test('non-kebab-case id is rejected', () => {
    const flow = happy();
    flow.id = 'Final_Review';
    assert.equal(validate(flow), false);
  });

  test('a step carrying a parameter bag is rejected', () => {
    // ADR-009 D3/D4: selection criteria stay in Review Judgment, so a step
    // must not be able to carry them.
    const flow = happy();
    flow.steps[2] = { use: 'select-skills', with: { applyTo: ['src/**'] } };
    assert.equal(validate(flow), false);
  });

  test('a step declaring both use and agent is rejected', () => {
    const flow = happy();
    flow.steps[0] = { use: 'resolve-artifacts', agent: 'bug-hunter' };
    assert.equal(validate(flow), false);
  });

  test('when clause with a free-form expression is rejected', () => {
    const flow = happy();
    flow.steps[6].when = { expr: 'baseline != null' };
    assert.equal(validate(flow), false);
  });

  test('stop / skip / degrade are the only continuation outcomes', () => {
    assert.deepEqual(schema.$defs.onUnsatisfied.enum, ['stop', 'skip', 'degrade']);

    const flow = happy();
    for (const outcome of schema.$defs.onUnsatisfied.enum) {
      flow.steps[7].onUnsatisfied = outcome;
      assert.equal(validate(flow), true, `${outcome}: ${errorsOf()}`);
    }
    flow.steps[7].onUnsatisfied = 'continue';
    assert.equal(validate(flow), false);
  });

  test('omitting onUnsatisfied stays valid (absence means the safe side: stop)', () => {
    const flow = happy();
    delete flow.steps[7].onUnsatisfied;
    assert.equal(validate(flow), true, errorsOf());
    assert.match(schema.$defs.onUnsatisfied.description, /Omitting the key means `stop`/);
  });

  test('stopCondition enum matches GATE_REASON_CODES exactly', () => {
    // Pinned against the production vocabulary rather than a copy of it:
    // a Flow must reuse the gate reason codes, not mint a parallel set.
    assert.deepEqual(schema.$defs.stopCondition.enum, [...GATE_REASON_CODES]);
  });

  test('reviewerRole enum matches REVIEWER_ROLES keys exactly', () => {
    assert.deepEqual(
      [...schema.$defs.reviewerRole.enum].sort(),
      Object.keys(REVIEWER_ROLES).sort()
    );
  });

  test('every stopCondition value validates as a stopCondition', () => {
    for (const code of GATE_REASON_CODES) {
      const flow = happy();
      flow.stopConditions = [code];
      assert.equal(validate(flow), true, `${code}: ${errorsOf()}`);
    }
  });

  test('every reviewer role validates as an agent step', () => {
    for (const role of Object.keys(REVIEWER_ROLES)) {
      const flow = happy();
      flow.steps[3] = { agent: role, parallel: true };
      assert.equal(validate(flow), true, `${role}: ${errorsOf()}`);
    }
  });

  test('every declared step primitive validates as a use step', () => {
    for (const primitive of schema.$defs.stepPrimitive.enum) {
      const flow = happy();
      flow.steps = [{ use: primitive }];
      assert.equal(validate(flow), true, `${primitive}: ${errorsOf()}`);
    }
  });

  test('step primitives cover the 14 names listed in #2013', () => {
    assert.deepEqual(schema.$defs.stepPrimitive.enum, [
      'resolve-intent',
      'resolve-artifacts',
      'select-skills',
      'select-agents',
      'deterministic-check',
      'parallel-review',
      'cross-artifact-review',
      'verify-findings',
      'compare-baseline',
      'detect-semantic-drift',
      'evaluate-completion',
      'derive-gate',
      'human-escalation',
      'persist-artifact',
    ]);
  });

  test('the schema is runtime-independent: no host or model vocabulary', () => {
    // AC "same Flow version means the same thing on Claude and Codex": the
    // document must not carry a runtime discriminator at all.
    const text = readFileSync(SCHEMA_PATH, 'utf8');
    for (const forbidden of ['"claude"', '"codex"', '"model"', '"prompt"']) {
      assert.equal(text.includes(forbidden), false, `schema mentions ${forbidden} as a key/value`);
    }
  });

  test('schema declares draft 2020-12 and a closed document', () => {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
  });
});
