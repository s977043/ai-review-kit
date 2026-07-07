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
 * design. Most trigger shapes ARE part of the shared surface and are covered
 * by CASES below (#1399). A few trigger constraints still diverge by design
 * (array minItems vs empty-array, string minLength vs empty-string item);
 * those are pinned explicitly in the "known trigger divergences" block so a
 * silent change to them also fails loudly instead of being assumed-in-sync.
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
    // #1401 §4: args + selfContained added to deterministicGate (ajv + zod).
    label: 'deterministicGate with args + selfContained',
    skill: {
      ...base,
      evaluationType: 'deterministic',
      deterministicGate: {
        command: '/usr/bin/actionlint',
        args: ['-color', 'never'],
        selfContained: true,
      },
    },
    expectValid: true,
  },
  {
    label: 'deterministicGate args not an array',
    skill: { ...base, deterministicGate: { command: 'x', args: 'not-array' } },
    expectValid: false,
  },
  {
    label: 'deterministicGate args item not a string',
    skill: { ...base, deterministicGate: { command: 'x', args: [1, 2] } },
    expectValid: false,
  },
  {
    label: 'deterministicGate selfContained not a boolean',
    skill: { ...base, deterministicGate: { command: 'x', selfContained: 'yes' } },
    expectValid: false,
  },
  {
    label: 'deterministicGate with unknown sub-field (strict / additionalProperties)',
    skill: { ...base, deterministicGate: { command: 'x', unknownField: true } },
    expectValid: false,
  },
  {
    label: 'invalid modelHint value',
    skill: { ...base, modelHint: 'gigantic' },
    expectValid: false,
  },

  // --- trigger shape parity (#1399) -------------------------------------
  // base already carries top-level phase+applyTo, so these exercise the
  // trigger container's own field validation while both validators accept.
  {
    label: 'trigger phase + applyTo',
    skill: { ...base, trigger: { phase: 'midstream', applyTo: ['docs/**/*.md'] } },
    expectValid: true,
  },
  {
    label: 'trigger phase + files',
    skill: { ...base, trigger: { phase: 'midstream', files: ['docs/**/*.md'] } },
    expectValid: true,
  },
  {
    label: 'trigger phase + path_patterns',
    skill: { ...base, trigger: { phase: 'midstream', path_patterns: ['docs/**/*.md'] } },
    expectValid: true,
  },
  {
    label: 'trigger phase array',
    skill: { ...base, trigger: { phase: ['upstream', 'midstream'], applyTo: ['a/**'] } },
    expectValid: true,
  },
  {
    label: 'trigger empty object (top-level satisfies conditions)',
    skill: { ...base, trigger: {} },
    expectValid: true,
  },
  {
    label: 'trigger invalid phase enum',
    skill: { ...base, trigger: { phase: 'quantum', applyTo: ['a/**'] } },
    expectValid: false,
  },
  {
    label: 'trigger applyTo not an array',
    skill: { ...base, trigger: { phase: 'midstream', applyTo: 'a/**' } },
    expectValid: false,
  },
  {
    // Guards the exact #1399 gap: an unknown trigger sub-field must be rejected
    // by BOTH. ajv rejects via trigger.additionalProperties:false; zod rejects
    // via TriggerSchema.strict(). If either loses that constraint, a trigger
    // field added to only one schema would drift silently.
    label: 'trigger with unknown sub-field',
    skill: { ...base, trigger: { phase: 'midstream', applyTo: ['a/**'], unknownField: true } },
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

/**
 * Known trigger-shape divergences (NOT parity — pinned on purpose).
 *
 * These are the residual "zod is stricter about some structures" cases the old
 * header note alluded to. They are constraint-granularity differences that exist
 * symmetrically at the TOP LEVEL too (e.g. top-level applyTo: [] and applyTo: ['']
 * diverge identically), so aligning only the trigger container would introduce a
 * new inconsistency rather than remove one; a proper fix would touch both levels
 * of both schemas and is out of scope for #1399 (trigger field parity).
 *
 * Instead we pin the current behavior: if either schema silently changes one of
 * these, the assertion below flips and this test fails loudly. `files` and
 * `path_patterns` behave identically to `applyTo` on both sides.
 */
describe('known trigger divergences (documented, pinned)', () => {
  const cases = [
    {
      label: 'trigger applyTo empty array: ajv rejects (minItems), zod accepts',
      skill: { ...base, trigger: { phase: 'midstream', applyTo: [] } },
      ajv: false,
      zod: true,
    },
    {
      label: 'trigger applyTo empty-string item: ajv accepts, zod rejects (minLength)',
      skill: { ...base, trigger: { phase: 'midstream', applyTo: [''] } },
      ajv: true,
      zod: false,
    },
    {
      // #1418 gemini: with NO top-level phase/applyTo, an incomplete trigger
      // (no file spec) diverges. ajv's allOf/anyOf only requires the `trigger`
      // key to exist, so it accepts; zod's top-level refine still demands a file
      // requirement (applyTo/path_patterns) and rejects. This is the top-level
      // `files` alias / refine gap, not a trigger-container gap — pinned here so
      // a silent schema change fails loudly. Fixing it needs a coordinated
      // ajv anyOf + zod refine change (tracked as follow-up).
      label: 'trigger empty object, no top-level file spec: ajv accepts, zod rejects (refine)',
      skill: { ...base, phase: undefined, applyTo: undefined, trigger: {} },
      ajv: true,
      zod: false,
    },
    {
      label: 'trigger phase only, no top-level file spec: ajv accepts, zod rejects (refine)',
      skill: { ...base, phase: undefined, applyTo: undefined, trigger: { phase: 'midstream' } },
      ajv: true,
      zod: false,
    },
  ];

  for (const { label, skill, ajv: expectAjv, zod: expectZod } of cases) {
    test(label, () => {
      const ajvOk = ajvValidate(JSON.parse(JSON.stringify(skill)));
      const zodOk = SkillYamlSchema.safeParse(skill).success;
      assert.equal(ajvOk, expectAjv, `ajv expected ${expectAjv} for: ${label}`);
      assert.equal(zodOk, expectZod, `zod expected ${expectZod} for: ${label}`);
      assert.notEqual(
        ajvOk,
        zodOk,
        'this case is a documented divergence; if they now agree, promote it into CASES'
      );
    });
  }
});
