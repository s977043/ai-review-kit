/**
 * Gate conformance fixture suite (Epic #1347 S2 / #1349).
 *
 * These fixtures are the executable contract kit for EXTERNAL hosts
 * (PlanGate, custom loop runners): each file carries a schema-valid artifact
 * with a gate block plus the host behavior the contract expects
 * (`expectedHostAction`). This suite keeps the kit itself honest:
 *
 *  1. every artifact validates against review-artifact.schema.json,
 *  2. every gate block replays — feeding gate.inputs back through
 *     deriveGateDecision reproduces decision / reasonCode / inputsHash,
 *  3. every fixture documents a non-empty expectedHostAction.
 *
 * Host implementers consume the fixtures directly: feed `artifact` to your
 * loop and assert your runner does what `expectedHostAction` says.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { deriveGateDecision } from '../src/lib/gate-decision.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, 'fixtures', 'gate-conformance');
const schema = JSON.parse(
  fs.readFileSync(path.join(HERE, '..', 'schemas', 'review-artifact.schema.json'), 'utf8')
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const files = fs
  .readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('gate conformance fixtures (Epic #1347 S2)', () => {
  test('the kit covers every gate decision value', () => {
    const decisions = new Set(
      files.map(
        (f) =>
          JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')).artifact.gate.decision
      )
    );
    for (const d of ['GO', 'GO_WITH_OBSERVATION', 'NO_GO', 'ESCALATE']) {
      assert.ok(decisions.has(d), `missing a fixture for ${d}`);
    }
  });

  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));

    test(`${file}: artifact is schema-valid`, () => {
      assert.equal(validate(fixture.artifact), true, JSON.stringify(validate.errors));
    });

    test(`${file}: gate block replays from its own inputs`, () => {
      const gate = fixture.artifact.gate;
      const replayed = deriveGateDecision(gate.inputs);
      assert.equal(replayed.decision, gate.decision, 'decision must replay');
      assert.equal(replayed.reasonCode, gate.reasonCode, 'reasonCode must replay');
      assert.equal(replayed.tier, gate.tier, 'tier must replay');
      assert.equal(replayed.inputsHash, gate.inputsHash, 'inputsHash must replay');
    });

    test(`${file}: documents the expected host action`, () => {
      assert.equal(typeof fixture.expectedHostAction, 'string');
      assert.ok(fixture.expectedHostAction.length > 20, 'host action must be actionable prose');
    });
  }
});
