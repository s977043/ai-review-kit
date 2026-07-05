/**
 * Skill schema parity canary (Epic #1347 S3 / #1350 PR-C).
 *
 * The skill contract is defined TWICE: schemas/skill.schema.json (ajv — the
 * runtime loader) and src/lib/skillYamlSchema.mjs (zod — scripts/tests).
 * Nothing keeps them in sync; this canary feeds representative skill
 * definitions to BOTH validators and asserts they agree on accept/reject,
 * so a field added to one side (as evaluationType/deterministicGate almost
 * was) fails loudly instead of drifting.
 *
 * Note: agreement is only checked on ACCEPTANCE — error details differ by
 * design. The zod schema is stricter about some structures (trigger shape),
 * so fixtures stick to the shared surface.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { SkillYamlSchema } from '../src/lib/skillYamlSchema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  fs.readFileSync(path.join(HERE, '..', 'schemas', 'skill.schema.json'), 'utf8')
);
const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: true });
addFormats(ajv);
const ajvValidate = ajv.compile(schema);

const base = {
  id: 'parity-skill',
  version: '1.0.0',
  name: 'Parity Skill',
  description: 'schema parity canary',
  category: 'midstream',
  phase: 'midstream',
  applyTo: ['src/**/*.mjs'],
};

const CASES = [
  { label: 'minimal valid skill', skill: { ...base }, expectValid: true },
  {
    label: 'evaluationType deterministic + deterministicGate',
    skill: {
      ...base,
      evaluationType: 'deterministic',
      deterministicGate: { command: 'npm run lint', failSeverity: 'strict_block' },
    },
    expectValid: true,
  },
  {
    label: 'evaluationType heuristic (no gate)',
    skill: { ...base, evaluationType: 'heuristic' },
    expectValid: true,
  },
  {
    label: 'invalid evaluationType value',
    skill: { ...base, evaluationType: 'quantum' },
    expectValid: false,
  },
  {
    label: 'deterministicGate without command',
    skill: { ...base, deterministicGate: { failSeverity: 'strict_block' } },
    expectValid: false,
  },
  {
    label: 'invalid failSeverity value',
    skill: { ...base, deterministicGate: { command: 'x', failSeverity: 'explode' } },
    expectValid: false,
  },
  {
    label: 'invalid modelHint value',
    skill: { ...base, modelHint: 'gigantic' },
    expectValid: false,
  },
];

describe('skill schema parity (ajv vs zod)', () => {
  for (const { label, skill, expectValid } of CASES) {
    test(label, () => {
      // deep copy: ajv useDefaults mutates its input
      const ajvOk = ajvValidate(JSON.parse(JSON.stringify(skill)));
      const zodResult = SkillYamlSchema.safeParse(skill);
      assert.equal(
        ajvOk,
        zodResult.success,
        `validators disagree (ajv=${ajvOk}, zod=${zodResult.success})` +
          (zodResult.success ? '' : ` zod: ${JSON.stringify(zodResult.error?.issues?.[0])}`) +
          (ajvOk ? '' : ` ajv: ${JSON.stringify(ajvValidate.errors?.[0])}`)
      );
      assert.equal(ajvOk, expectValid, `expected ${expectValid} for: ${label}`);
    });
  }

  test('failSeverity default parity (ajv useDefaults vs zod .default)', () => {
    const input = { ...base, deterministicGate: { command: 'npm test' } };
    const ajvCopy = JSON.parse(JSON.stringify(input));
    ajvValidate(ajvCopy);
    const zodParsed = SkillYamlSchema.safeParse(input);
    assert.equal(zodParsed.success, true);
    assert.equal(ajvCopy.deterministicGate.failSeverity, 'strict_block');
    assert.equal(zodParsed.data.deterministicGate.failSeverity, 'strict_block');
  });
});
