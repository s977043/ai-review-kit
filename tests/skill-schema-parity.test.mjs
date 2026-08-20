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
 * inputContext enum parity canary (#1564, widened in #1940).
 *
 * The set of allowed inputContext values is declared in MORE THAN ONE place. The
 * runtime authority is schemas/skill.schema.json $defs.inputContext.enum (ajv);
 * InputContextEnum in src/lib/skillYamlSchema.mjs (zod) mirrors it for
 * scripts/tests. #1559 uncovered a drift where the zod side was missing
 * reviewSelf / reviewExternal / findingsPool / prDescription. This canary compares
 * the two enum lists directly (not just via accept/reject cases) so any future
 * add/remove on one side without the other fails loudly instead of drifting.
 *
 * The TypeScript declarations are covered by the separate block below — the
 * original wording here said "declared TWICE", which was already untrue when it
 * was written (#1940). Deliberately no count is stated in prose: the number of
 * declaration sites is pinned mechanically in TS_DECLARATION_SITES instead, so it
 * cannot go stale silently.
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
 * TypeScript declaration parity canary for inputContext / outputKind (#1940).
 *
 * The JSON Schema $defs are the runtime authority, but the same two vocabularies
 * are ALSO hand-written as TypeScript union types (and as JSDoc @typedef, which is
 * what types runners/core for editors and `tsc --checkJs` consumers). #1940 found
 * every TypeScript site 4 values behind on inputContext, and 2 of them 1 value
 * behind on outputKind — the runtime accepted `prDescription` / `review-audit`
 * while the published types rejected them. The #1564 canary could not see it
 * because it only compared ajv against zod.
 *
 * Design decisions, recorded here because each had a viable alternative:
 *
 *   Extraction: regex over the file text, not a TypeScript parse. The repo has no
 *   TypeScript compiler in the unit-test path (typescript is only a devDependency
 *   of the runners/node-api workspace, invoked by its own `npm run build`), and
 *   tests/action-esm-require-canary.test.mjs (#1929) already sets the precedent of
 *   reading sibling sources with readFileSync and matching with a documented
 *   regex. Adding a parser dependency to `node --test` for two one-line unions is
 *   not worth it. The cost is that the regex only understands the two shapes these
 *   files actually use; DECLARATION_RE and JSDOC_RE below pin those shapes, and an
 *   extraction that stops matching fails (see below) rather than passing empty.
 *
 *   Site list: pinned explicitly, AND cross-checked against a directory scan. A
 *   pure hardcoded list would silently miss a new declaration site; a pure scan
 *   would silently shrink to zero if the scan root or the extension filter broke.
 *   So the scan discovers sites under SCAN_ROOTS and the discovered set must equal
 *   TS_DECLARATION_SITES exactly — a new site fails until it is added to the list
 *   (and thereby reviewed), and a disappearing site fails too.
 *
 *   Generated output is out of scope, by name. runners/github-action/dist/ (ncc)
 *   and runners/node-api/dist/ (tsc) both contain a copy of these vocabularies,
 *   but they are build artifacts regenerated by `npm run build:action` and by
 *   `npm run build` in runners/node-api, and their freshness is already guarded by
 *   the Auto Rebuild Action Dist workflow. Pinning them here would report a stale
 *   build as a vocabulary drift. GENERATED_DIRS records the exclusion so it is a
 *   decision in the file, not an accident of the glob.
 *
 *   Extraction failure fails, it does not skip. #1937 (the actions/github-script
 *   version pin in tests/action-esm-require-canary.test.mjs) settled this for the
 *   repo: a canary that cannot evaluate its subject must fail, because skipping
 *   recreates exactly the invisible-failure mode the canary exists to remove.
 */
describe('inputContext / outputKind TypeScript declaration parity (#1940)', () => {
  /** Directories walked to discover declaration sites. */
  const SCAN_ROOTS = ['src', 'runners'];

  /** Never walked: dependencies and build output (see the block comment above). */
  const SKIP_DIRS = new Set(['node_modules']);
  const GENERATED_DIRS = ['runners/github-action/dist', 'runners/node-api/dist'];

  /** Files whose text is searched for a declaration. */
  const SCANNED_EXTENSIONS = ['.ts', '.mts', '.mjs', '.js', '.cjs'];

  /**
   * The vocabularies under guard, keyed by TypeScript type name, valued by the
   * JSON Schema $defs key that is their runtime authority.
   */
  const GUARDED = { InputContext: 'inputContext', OutputKind: 'outputKind' };

  /**
   * Every hand-maintained TypeScript/JSDoc declaration site, as a repo-relative
   * POSIX path. Update this list in the same commit that adds or removes one.
   */
  const TS_DECLARATION_SITES = {
    InputContext: [
      'runners/core/review-runner.d.ts',
      'runners/core/skill-loader.d.ts',
      'runners/core/skill-loader.mjs',
      'runners/node-api/src/types.ts',
      'src/types/skill.ts',
    ],
    OutputKind: [
      'runners/core/skill-loader.d.ts',
      'runners/core/skill-loader.mjs',
      'runners/node-api/src/types.ts',
      'src/types/skill.ts',
    ],
  };

  const REPO_ROOT = path.join(HERE, '..');

  /** `export type Name = <union up to the first semicolon>;` */
  const declarationRe = (name) =>
    new RegExp(String.raw`export\s+type\s+${name}\s*=\s*([^;]+);`, 'g');
  /** `@typedef {<union>} Name` — the shape runners/core/skill-loader.mjs uses. */
  const typedefRe = (name) => new RegExp(String.raw`@typedef\s*\{([^}]+)\}\s*${name}\b`, 'g');

  /** Single-quoted string literals inside a union body. */
  const LITERAL_RE = /'([^']+)'/g;

  function isGenerated(relPath) {
    return GENERATED_DIRS.some((dir) => relPath === dir || relPath.startsWith(`${dir}/`));
  }

  /** Walk SCAN_ROOTS and return repo-relative POSIX paths of candidate files. */
  function scannedFiles() {
    const out = [];
    const queue = SCAN_ROOTS.map((root) => root);
    while (queue.length > 0) {
      const rel = queue.shift();
      if (isGenerated(rel)) continue;
      const abs = path.join(REPO_ROOT, rel);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(abs)) {
          if (SKIP_DIRS.has(entry)) continue;
          queue.push(`${rel}/${entry}`);
        }
        continue;
      }
      if (SCANNED_EXTENSIONS.some((ext) => rel.endsWith(ext))) out.push(rel);
    }
    return out.sort();
  }

  /**
   * Extract every declaration of `name` in `source`.
   * @returns {string[][]} one array of literal values per declaration found
   */
  function declarationsIn(source, name) {
    const found = [];
    for (const re of [declarationRe(name), typedefRe(name)]) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(source)) !== null) {
        LITERAL_RE.lastIndex = 0;
        found.push([...match[1].matchAll(LITERAL_RE)].map((m) => m[1]));
      }
    }
    return found;
  }

  /** name -> { relPath -> string[][] } for everything the scan found. */
  const discovered = Object.fromEntries(Object.keys(GUARDED).map((name) => [name, {}]));
  for (const rel of scannedFiles()) {
    const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    for (const name of Object.keys(GUARDED)) {
      const declarations = declarationsIn(source, name);
      if (declarations.length > 0) discovered[name][rel] = declarations;
    }
  }

  test('the scan itself found files to read (extraction did not go empty)', () => {
    const files = scannedFiles();
    assert.ok(
      files.length >= 50,
      `only ${files.length} file(s) scanned under ${SCAN_ROOTS.join(', ')} — the walk or the ` +
        `extension filter is broken, and this canary would silently guard nothing`
    );
  });

  for (const [name, defsKey] of Object.entries(GUARDED)) {
    const expectedSites = [...TS_DECLARATION_SITES[name]].sort();
    const schemaEnum = schema.$defs?.[defsKey]?.enum;

    test(`${name}: JSON Schema $defs.${defsKey}.enum is a non-empty array`, () => {
      assert.ok(Array.isArray(schemaEnum), `schema.$defs.${defsKey}.enum must be an array`);
      assert.ok(schemaEnum.length > 0, `schema.$defs.${defsKey}.enum must not be empty`);
    });

    test(`${name}: the discovered declaration sites are exactly the pinned ones`, () => {
      assert.deepEqual(
        Object.keys(discovered[name]).sort(),
        expectedSites,
        `${name} declaration sites drifted. If a site was added on purpose, add it to ` +
          `TS_DECLARATION_SITES in this file so it is checked. If one disappeared, either the ` +
          `declaration moved out of ${SCAN_ROOTS.join('/')} or the extraction regex stopped ` +
          `matching its shape — both make this canary guard less than it claims.`
      );
    });

    for (const site of expectedSites) {
      test(`${name}: ${site} declares the same values as the JSON Schema enum`, () => {
        const declarations = discovered[name][site];
        assert.ok(
          Array.isArray(declarations) && declarations.length === 1,
          `expected exactly 1 ${name} declaration in ${site}, found ` +
            `${declarations?.length ?? 0}. A zero here means the regex no longer matches the ` +
            `declaration's shape — fix the regex or the declaration, do not skip.`
        );
        const values = declarations[0];
        assert.ok(
          values.length > 0,
          `extracted 0 string literals from the ${name} declaration in ${site} — ` +
            `LITERAL_RE no longer matches this declaration's quoting style`
        );
        assert.deepEqual(
          [...values].sort(),
          [...schemaEnum].sort(),
          `${name} drift in ${site}: ts=${JSON.stringify([...values].sort())} vs ` +
            `schema $defs.${defsKey}=${JSON.stringify([...schemaEnum].sort())}`
        );
        assert.equal(new Set(values).size, values.length, `${site} has duplicate ${name} values`);
      });
    }
  }
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
