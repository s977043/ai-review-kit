// Contract tests for schemas/agent-contract.schema.json and
// schemas/agent-adapter-map.schema.json (#2014, Epic #2011).
//
// #2014 stops at the contract: there is no Agent execution engine yet, so the
// positive cases validate the shipped contracts in agents/contracts/ and a
// minimal fixture rather than the output of a production function. The
// vocabularies this contract borrows are NOT re-derived here: REVIEWER_ROLES
// and the gate vocabulary are imported from their production modules and pinned
// against the schema, so the Agent axis cannot grow a second copy of either.
//
// Several acceptance criteria of #2014 are cross-document constraints that JSON
// Schema cannot express (responsibility non-overlap, "every declared skill
// exists", "a required capability is provided by every runtime"). Those are
// enforced here, which is why the schema descriptions delegate to this file by
// name instead of promising something nothing checks.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

import { GATE_DECISIONS, GATE_REASON_CODES } from '../src/lib/gate-decision.mjs';
import { REVIEWER_ROLES } from '../src/lib/reviewer-orchestrator.mjs';
import {
  compileAgentAdapterMapValidator,
  compileAgentContractValidator,
} from './helpers/schema-validator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CONTRACT_SCHEMA_PATH = resolve(ROOT, 'schemas', 'agent-contract.schema.json');
const CONTRACTS_DIR = resolve(ROOT, 'agents', 'contracts');
const FIXTURES_DIR = resolve(HERE, 'fixtures', 'agent');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readFixture = (name) => readJson(resolve(FIXTURES_DIR, name));

// Compiled once at module scope (ajv compile is expensive, the schemas are
// static). Strict mode stays on so future schema typos surface here.
const validate = compileAgentContractValidator();
const validateAdapterMap = compileAgentAdapterMapValidator();
const schema = readJson(CONTRACT_SCHEMA_PATH);

const AGENT_IDS = schema.$defs.agentId.enum;
const contractFiles = readdirSync(CONTRACTS_DIR)
  .filter((name) => name.endsWith('.agent.json'))
  .sort();
const contracts = contractFiles.map((name) => readJson(resolve(CONTRACTS_DIR, name)));
const adapterMap = readJson(resolve(CONTRACTS_DIR, 'adapter-map.json'));

/** Deep clone of the minimal happy fixture, so each negative case mutates in isolation. */
const happy = () => readFixture('minimal-happy.json');

const errorsOf = (validator) => JSON.stringify(validator.errors, null, 2);

describe('agent-contract.schema.json', () => {
  test('the minimal happy fixture conforms to the schema', () => {
    assert.equal(validate(happy()), true, errorsOf(validate));
  });

  test('every shipped contract in agents/contracts/ conforms', () => {
    for (const [index, contract] of contracts.entries()) {
      assert.equal(validate(contract), true, `${contractFiles[index]}: ${errorsOf(validate)}`);
    }
  });

  test('the shipped contracts are exactly the five declared Agents', () => {
    assert.deepEqual(
      contracts.map((contract) => contract.id).sort(),
      [...AGENT_IDS].sort(),
      'a contract file exists for each declared Agent and for no other'
    );
    assert.equal(contracts.length, 5);
    assert.deepEqual(
      contractFiles,
      contracts.map((contract) => `${contract.id}.agent.json`).sort(),
      'each file is named after the Agent it declares'
    );
  });

  test('a sixth Agent id is rejected: proliferation is blocked mechanically', () => {
    // #2011 limits the initial set to five, so adding one must be a schema
    // change (a reviewable event), not a new file dropped into the directory.
    assert.equal(validate(readFixture('unknown-agent-guard.json')), false);
  });

  test('a reviewer lens role is rejected as an Agent id', () => {
    // The lens axis (REVIEWER_ROLES) and the Agent axis are separate ledgers.
    assert.equal(validate(readFixture('reviewer-lens-as-agent-guard.json')), false);
    for (const role of Object.keys(REVIEWER_ROLES)) {
      const contract = happy();
      contract.id = role;
      assert.equal(validate(contract), false, `id: ${role} should be rejected`);
      assert.equal(
        AGENT_IDS.includes(role),
        false,
        `reviewer role ${role} must not be an Agent id`
      );
    }
  });

  test('the schema does not copy the reviewer role ledger', () => {
    // Importing the SSoT instead of re-deriving it: the role names must live in
    // src/lib/reviewer-orchestrator.mjs only. `instantiatedPer` names the ledger
    // rather than enumerating it.
    const text = readFileSync(CONTRACT_SCHEMA_PATH, 'utf8');
    for (const role of Object.keys(REVIEWER_ROLES)) {
      assert.equal(text.includes(`"${role}"`), false, `schema enumerates the role ${role}`);
    }
    assert.deepEqual(schema.properties.instantiatedPer.enum, ['reviewer-role']);
  });

  test('the schema does not copy the gate vocabulary', () => {
    // completion-judge feeds gate derivation; it must not mint a second set of
    // decisions or reason codes.
    const enumValues = new Set(
      Object.values(schema.$defs)
        .flatMap((def) => def.enum ?? [])
        .concat(schema.properties.instantiatedPer.enum, schema.properties.onUnavailable.enum)
    );
    for (const value of [...GATE_DECISIONS, ...GATE_REASON_CODES]) {
      assert.equal(enumValues.has(value), false, `schema re-declares gate vocabulary ${value}`);
    }
  });

  test('exactly one Agent owns each responsibility, and all are owned', () => {
    // #2014 acceptance criterion: the five responsibilities do not overlap.
    const owners = new Map();
    for (const contract of contracts) {
      for (const responsibility of contract.responsibilities) {
        const existing = owners.get(responsibility);
        assert.equal(
          existing,
          undefined,
          `${responsibility} is claimed by both ${existing} and ${contract.id}`
        );
        owners.set(responsibility, contract.id);
      }
    }
    assert.deepEqual(
      [...owners.keys()].sort(),
      [...schema.$defs.responsibility.enum].sort(),
      'every declared responsibility is owned by exactly one Agent'
    );
  });

  test('no Agent can hold merge, release, source-write or policy authority', () => {
    // Enforced by the schema (const: false), not merely by the shipped values,
    // so granting it requires a schema change rather than a contract edit.
    const authority = schema.properties.authority;
    for (const field of [
      'canModifySource',
      'canApproveMerge',
      'canApproveRelease',
      'canRewritePolicy',
    ]) {
      assert.equal(authority.properties[field].const, false, `${field} must be const false`);
      assert.ok(authority.required.includes(field), `${field} must be required`);

      const contract = happy();
      contract.authority[field] = true;
      assert.equal(validate(contract), false, `${field}: true must be rejected`);
    }
    assert.equal(validate(readFixture('merge-authority-guard.json')), false);

    for (const contract of contracts) {
      assert.deepEqual(contract.authority, {
        canModifySource: false,
        canApproveMerge: false,
        canApproveRelease: false,
        canRewritePolicy: false,
      });
    }
  });

  test('a missing Agent fails to the safe side: there is no "continue" outcome', () => {
    assert.deepEqual(schema.properties.onUnavailable.enum, ['stop', 'escalate']);
    for (const outcome of schema.properties.onUnavailable.enum) {
      const contract = happy();
      contract.onUnavailable = outcome;
      assert.equal(validate(contract), true, `${outcome}: ${errorsOf(validate)}`);
    }
    const contract = happy();
    contract.onUnavailable = 'continue';
    assert.equal(validate(contract), false);
    assert.match(schema.properties.onUnavailable.description, /Absent means `escalate`/);
  });

  test('every skill a contract allows exists in the repository', () => {
    // Guards against a contract naming a skill that was only ever sketched in
    // an issue body (the #2014 example names `traceability-coverage`, which
    // this repository does not ship).
    const registry = readFileSync(resolve(ROOT, 'skills', 'registry.yaml'), 'utf8');
    const registryIds = new Set(
      [...registry.matchAll(/^\s*- id:\s*(\S+)\s*$/gm)].map((match) => match[1])
    );
    for (const contract of contracts) {
      for (const skillId of contract.skills ?? []) {
        const isAgentSkill = existsSync(
          resolve(ROOT, 'skills', 'agent-skills', skillId, 'SKILL.md')
        );
        assert.ok(
          registryIds.has(skillId) || isAgentSkill,
          `${contract.id}: skill "${skillId}" is in neither skills/registry.yaml nor skills/agent-skills/`
        );
      }
    }
  });

  test('every implementedBy reference points at code that exists', () => {
    for (const contract of contracts) {
      for (const ref of contract.implementedBy ?? []) {
        const path = resolve(ROOT, ref.path);
        assert.ok(existsSync(path), `${contract.id}: ${ref.path} does not exist`);
        if (!ref.symbol) continue;
        assert.ok(
          readFileSync(path, 'utf8').includes(ref.symbol),
          `${contract.id}: ${ref.symbol} not found in ${ref.path}`
        );
      }
    }
  });

  test('specialist-reviewer is the only Agent instantiated per reviewer role', () => {
    // Adding a reviewer lens must not add an Agent: this is the structural
    // reason the lens axis cannot inflate the Agent ledger.
    const perRole = contracts.filter((contract) => contract.instantiatedPer === 'reviewer-role');
    assert.deepEqual(
      perRole.map((contract) => contract.id),
      ['specialist-reviewer']
    );
  });

  test('the contract schema is runtime-independent: no host or model vocabulary', () => {
    const text = readFileSync(CONTRACT_SCHEMA_PATH, 'utf8');
    for (const forbidden of ['"claude"', '"codex"', '"model"', '"prompt"']) {
      assert.equal(text.includes(forbidden), false, `schema mentions ${forbidden} as a key/value`);
    }
  });

  test('schema declares draft 2020-12 and a closed document', () => {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);

    const contract = happy();
    contract.runtime = 'claude-code';
    assert.equal(validate(contract), false, 'an extra top-level property must be rejected');
  });

  test('required fields and formats are enforced', () => {
    for (const field of ['id', 'version', 'responsibilities', 'inputs', 'outputs', 'authority']) {
      const contract = happy();
      delete contract[field];
      assert.equal(validate(contract), false, `missing ${field} must be rejected`);
    }
    const nonSemver = happy();
    nonSemver.version = '0.1';
    assert.equal(validate(nonSemver), false);
  });
});

describe('agent-adapter-map.json', () => {
  test('the shipped adapter map conforms to its schema', () => {
    assert.equal(validateAdapterMap(adapterMap), true, errorsOf(validateAdapterMap));
  });

  test('every declared Agent has a binding on every runtime', () => {
    assert.deepEqual(Object.keys(adapterMap.agents).sort(), [...AGENT_IDS].sort());
    for (const [id, bindings] of Object.entries(adapterMap.agents)) {
      assert.deepEqual(
        Object.keys(bindings).sort(),
        Object.keys(adapterMap.runtimes).sort(),
        `${id}: a runtime is missing a binding`
      );
    }
  });

  test('the adapter map carries no judgment field', () => {
    // The acceptance criterion "a Claude/Codex adapter difference must not leak
    // into a judgment difference", checked structurally: judgment lives in the
    // contract, so these keys must not appear anywhere in the adapter map.
    const judgmentKeys = new Set([
      'responsibilities',
      'inputs',
      'outputs',
      'skills',
      'authority',
      'instantiatedPer',
      'onUnavailable',
      'severity',
    ]);
    const walk = (node, path) => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        assert.equal(judgmentKeys.has(key), false, `judgment key "${key}" found at ${path}`);
        walk(value, `${path}.${key}`);
      }
    };
    walk(adapterMap, '$');
  });

  test('the two runtimes really do differ in capability', () => {
    // Without this the intersection check below would be vacuous: it only
    // proves anything while one runtime offers something the other does not.
    const claude = new Set(adapterMap.runtimes.claude.capabilities);
    const codex = new Set(adapterMap.runtimes.codex.capabilities);
    const onlyOnOne = [...claude, ...codex].filter((cap) => !(claude.has(cap) && codex.has(cap)));
    assert.ok(onlyOnOne.length > 0, 'expected an asymmetry between the runtime capability sets');
  });

  test('every capability a contract requires is provided by every runtime', () => {
    // A capability only one runtime provides must never become a judgment
    // requirement, otherwise the same contract would judge differently per
    // runtime. The intersection is computed from the adapter map rather than
    // hard-coded, so adding a runtime tightens this automatically.
    const runtimeCapabilitySets = Object.values(adapterMap.runtimes).map(
      (runtime) => new Set(runtime.capabilities)
    );
    for (const contract of contracts) {
      for (const capability of contract.capabilities ?? []) {
        for (const [index, provided] of runtimeCapabilitySets.entries()) {
          assert.ok(
            provided.has(capability),
            `${contract.id} requires "${capability}", which ${Object.keys(adapterMap.runtimes)[index]} does not provide`
          );
        }
      }
    }
  });

  test('a fallback cannot mean "run a reduced judgment"', () => {
    const bindingSchema = readJson(resolve(ROOT, 'schemas', 'agent-adapter-map.schema.json')).$defs
      .binding;
    assert.deepEqual(bindingSchema.properties.fallback.enum, [
      'not-needed',
      'skill-only',
      'escalate',
    ]);
    const map = structuredClone(adapterMap);
    map.agents['consistency-judge'].codex.fallback = 'degrade';
    assert.equal(validateAdapterMap(map), false);
  });

  test('an unknown runtime or a missing Agent binding is rejected', () => {
    const extraRuntime = structuredClone(adapterMap);
    extraRuntime.runtimes.gemini = {
      capabilities: ['read-artifact'],
      capabilitySource: 'nowhere',
    };
    assert.equal(validateAdapterMap(extraRuntime), false);

    const missingAgent = structuredClone(adapterMap);
    delete missingAgent.agents['finding-verifier'];
    assert.equal(validateAdapterMap(missingAgent), false);
  });

  test('every capabilitySource points at a file that exists', () => {
    // The runtime capability lists are measurements of the shipped manifests,
    // so the file they were measured from has to be there.
    for (const [name, runtime] of Object.entries(adapterMap.runtimes)) {
      assert.ok(
        existsSync(resolve(ROOT, runtime.capabilitySource)),
        `${name}: capabilitySource ${runtime.capabilitySource} does not exist`
      );
    }
  });

  test('every binding surface points at a file that exists', () => {
    for (const [id, bindings] of Object.entries(adapterMap.agents)) {
      for (const [runtime, binding] of Object.entries(bindings)) {
        assert.ok(
          existsSync(resolve(ROOT, binding.surface)),
          `${id}/${runtime}: surface ${binding.surface} does not exist`
        );
      }
    }
  });
});
