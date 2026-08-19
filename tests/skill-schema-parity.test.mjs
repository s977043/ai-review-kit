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

import { SkillYamlSchema, InputContextEnum } from '../src/lib/skillYamlSchema.mjs';
import { resolveAvailableDependencies } from '../src/lib/utils.mjs';
import { selectSkills } from '../runners/core/review-runner.mjs';

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
 * inputContext enum parity canary (#1564).
 *
 * The set of allowed inputContext values is declared TWICE — as
 * schemas/skill.schema.json $defs.inputContext.enum (ajv, the runtime authority)
 * and as InputContextEnum in src/lib/skillYamlSchema.mjs (zod). #1559 uncovered a
 * drift where the zod side was missing reviewSelf / reviewExternal / findingsPool
 * / prDescription. This canary compares the two enum lists directly (not just via
 * accept/reject cases) so any future add/remove on one side without the other
 * fails loudly instead of drifting.
 */
describe('inputContext enum parity (zod vs JSON Schema $defs)', () => {
  const schemaEnum = schema.$defs?.inputContext?.enum;
  const zodEnum = InputContextEnum.options;

  test('JSON Schema exposes $defs.inputContext.enum as an array', () => {
    assert.ok(Array.isArray(schemaEnum), 'schema.$defs.inputContext.enum must be an array');
    assert.ok(Array.isArray(zodEnum), 'InputContextEnum.options must be an array');
  });

  test('zod enum and JSON Schema enum contain the same values (order-insensitive)', () => {
    const sortedSchema = [...schemaEnum].sort();
    const sortedZod = [...zodEnum].sort();
    assert.deepEqual(
      sortedZod,
      sortedSchema,
      `inputContext enum drift: zod=${JSON.stringify(sortedZod)} vs schema=${JSON.stringify(sortedSchema)}`
    );
  });

  test('no duplicate values in either enum', () => {
    assert.equal(new Set(schemaEnum).size, schemaEnum.length, 'JSON Schema enum has duplicates');
    assert.equal(new Set(zodEnum).size, zodEnum.length, 'zod enum has duplicates');
  });
});

/**
 * Dependency stub parity canary (#1921).
 *
 * `schemas/skill.schema.json` `$defs.dependency` is an `anyOf` of TWO branches:
 * a closed enum and an open `^custom:.+` pattern. The stub set that
 * `RIVER_DEPENDENCY_STUBS=1` advertises (`dependencyStubs` in
 * `src/lib/utils.mjs`) is a hand-maintained third copy of that vocabulary, and
 * it originally mirrored only the enum branch — so a skill declaring
 * `custom:github` was skipped precisely when stubs were meant to prevent skips.
 *
 * This canary asserts, without loading the schema at runtime in production:
 *   1. the schema still has exactly the two branches this design assumes;
 *   2. the stub set covers the whole enum branch;
 *   3. the pattern branch's treatment is pinned — represented by exactly one
 *      wildcard sentinel, `custom:*`;
 *   4. the sentinel expansion inside `missingDependencies()` accepts exactly
 *      the strings the schema's own pattern accepts (cross-checked against a
 *      regex compiled from the schema JSON, not from the implementation).
 */
describe('dependency stub parity (dependencyStubs vs JSON Schema $defs.dependency)', () => {
  const branches = schema.$defs?.dependency?.anyOf;
  const stubs = withStubEnv(() => resolveAvailableDependencies(null));

  /** Run `fn` with RIVER_DEPENDENCY_STUBS=1 and no explicit dependency list. */
  function withStubEnv(fn) {
    const previousStubs = process.env.RIVER_DEPENDENCY_STUBS;
    const previousList = process.env.RIVER_AVAILABLE_DEPENDENCIES;
    try {
      process.env.RIVER_DEPENDENCY_STUBS = '1';
      delete process.env.RIVER_AVAILABLE_DEPENDENCIES;
      return fn();
    } finally {
      if (previousStubs === undefined) delete process.env.RIVER_DEPENDENCY_STUBS;
      else process.env.RIVER_DEPENDENCY_STUBS = previousStubs;
      if (previousList === undefined) delete process.env.RIVER_AVAILABLE_DEPENDENCIES;
      else process.env.RIVER_AVAILABLE_DEPENDENCIES = previousList;
    }
  }

  test('schema still declares exactly one enum branch and one pattern branch', () => {
    assert.ok(Array.isArray(branches), '$defs.dependency.anyOf must be an array');
    assert.equal(branches.length, 2, 'a new anyOf branch needs a matching stub decision');
    assert.ok(Array.isArray(branches[0]?.enum), 'branch 0 must be the closed enum');
    assert.equal(typeof branches[1]?.pattern, 'string', 'branch 1 must be the open pattern');
  });

  test('stub set covers every value of the enum branch', () => {
    const missing = branches[0].enum.filter((value) => !stubs.includes(value));
    assert.deepEqual(missing, [], `dependencyStubs is missing enum values: ${missing.join(', ')}`);
  });

  test('pattern branch is represented by exactly one wildcard sentinel', () => {
    const patternStubs = stubs.filter((value) => new RegExp(branches[1].pattern).test(value));
    assert.deepEqual(
      patternStubs,
      ['custom:*'],
      'the open pattern branch must be stubbed by the single sentinel `custom:*`'
    );
  });

  /**
   * `custom:*` is itself a legal DECLARED dependency — `^custom:.+` matches it,
   * on both the ajv and the zod side. No skill declares it today (`grep -rn
   * 'custom:\*' skills/` returns nothing), so this pins the chosen reading
   * rather than a current behavior: the token means the same thing on both
   * sides of the comparison, so a skill declaring it is satisfied exactly when
   * blanket custom support is advertised — never by a specific `custom:` name.
   */
  test('a skill declaring custom:* is treated as a name, not as a second wildcard', () => {
    const wildcardSkill = {
      metadata: {
        id: 'wildcard-declaring-skill',
        phase: 'midstream',
        applyTo: ['src/**'],
        dependencies: ['custom:*'],
      },
    };
    const select = (availableDependencies) =>
      selectSkills([wildcardSkill], {
        phase: 'midstream',
        changedFiles: ['src/a.mjs'],
        availableContexts: [],
        availableDependencies,
      }).selected.length === 1;

    assert.equal(select(null), true, 'gating disabled: selected');
    assert.equal(select(stubs), true, 'blanket support advertised: selected');
    assert.equal(select(['custom:*']), true, 'blanket support requested explicitly: selected');
    assert.equal(select([]), false, 'nothing available: skipped');
    assert.equal(
      select(['custom:github']),
      false,
      'one specific custom dependency must NOT satisfy a blanket custom:* requirement'
    );

    // Both validators must keep accepting the declaration itself.
    const skill = { ...base, dependencies: ['custom:*'] };
    assert.equal(ajvValidate(JSON.parse(JSON.stringify(skill))), true);
    assert.equal(SkillYamlSchema.safeParse(skill).success, true);
  });

  test('the sentinel accepts exactly what the schema pattern accepts', () => {
    const schemaPattern = new RegExp(branches[1].pattern);
    // Hand-written probes; expectations come from the schema regex, and the
    // observed side comes from the real selection path in review-runner.
    const probes = [
      'custom:github',
      'custom:*',
      'custom:a',
      'custom: ',
      'custom:',
      'CUSTOM:github',
      'notcustom:github',
      'unknown_dependency',
    ];
    for (const dep of probes) {
      const skill = {
        metadata: {
          id: `stub-probe-${dep}`,
          phase: 'midstream',
          applyTo: ['src/**'],
          dependencies: [dep],
        },
      };
      const { selected } = selectSkills([skill], {
        phase: 'midstream',
        changedFiles: ['src/a.mjs'],
        availableContexts: [],
        availableDependencies: stubs,
      });
      const accepted = selected.length === 1;
      // Enum-branch names are stubbed outright, so only judge the pattern side.
      const expected = branches[0].enum.includes(dep) || schemaPattern.test(dep);
      assert.equal(
        accepted,
        expected,
        `stub acceptance disagrees with schema for ${JSON.stringify(dep)}`
      );
    }
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
