// Contract tests for the four core review Flow definitions (#2016, Epic #2011).
//
// Scope note: #2016 stops at definition + wiring + observe. There is no Flow
// execution engine yet, so these tests validate the shipped assets in `flows/`
// against the schemas that #2013 and this issue own, and pin the cross-document
// constraints JSON Schema cannot express:
//
//   - every Flow's `intent.purpose` resolves to exactly one Review Intent
//   - the Review Intent's evidence list and the Flow's `inputs[]` agree, so the
//     "missing artifact stops / degrades / skips" declaration cannot drift
//   - the entry map resolves to a Flow id AND version that exists
//   - the Review Intent artifact vocabulary is a subset of the Agent Contract
//     `inputKind` vocabulary (#2014), not a parallel ledger
//   - observe mode: no runtime module loads `flows/`, so adding these documents
//     cannot change an existing gate or decision
//
// The Ajv setup is NOT re-implemented here: the compiled validators come from
// tests/helpers/schema-validator.mjs, the same factory the #2013/#2014 suites use.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

import { GATE_REASON_CODES } from '../src/lib/gate-decision.mjs';
import {
  compileFlowValidator,
  compileFlowEntryMapValidator,
  compileReviewIntentValidator,
} from './helpers/schema-validator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const FLOWS_DIR = resolve(REPO_ROOT, 'flows');
const INTENTS_DIR = resolve(FLOWS_DIR, 'intents');
const SCHEMAS_DIR = resolve(REPO_ROOT, 'schemas');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const flowFiles = readdirSync(FLOWS_DIR)
  .filter((name) => name.endsWith('.flow.json'))
  .sort();
const intentFiles = readdirSync(INTENTS_DIR)
  .filter((name) => name.endsWith('.intent.json'))
  .sort();

const flows = flowFiles.map((name) => ({ name, doc: readJson(join(FLOWS_DIR, name)) }));
const intents = intentFiles.map((name) => ({ name, doc: readJson(join(INTENTS_DIR, name)) }));
const entryMap = readJson(join(FLOWS_DIR, 'entry-map.json'));

const intentByPurpose = new Map(intents.map(({ doc }) => [doc.purpose, doc]));
const flowById = new Map(flows.map(({ doc }) => [doc.id, doc]));

const validateFlow = compileFlowValidator();
const validateIntent = compileReviewIntentValidator();
const validateEntryMap = compileFlowEntryMapValidator();

const errorsOf = (validate) => JSON.stringify(validate.errors, null, 2);

/** The four Flows #2016 defines. Written out so a silently dropped file fails. */
const EXPECTED_FLOW_IDS = [
  'final-review',
  'plan-review',
  'replan-review',
  'task-completion-review',
];

describe('core review Flow definitions (#2016)', () => {
  test('the four expected Flows ship, one file per Flow', () => {
    assert.deepEqual([...flowById.keys()].sort(), EXPECTED_FLOW_IDS);
    assert.equal(flows.length, EXPECTED_FLOW_IDS.length);
    for (const { name, doc } of flows) {
      assert.equal(name, `${doc.id}.flow.json`, `${name}: filename must match the Flow id`);
    }
  });

  test('every Flow validates against schemas/flow.schema.json', () => {
    for (const { name, doc } of flows) {
      assert.equal(validateFlow(doc), true, `${name}: ${errorsOf(validateFlow)}`);
    }
  });

  test('every Review Intent validates against schemas/review-intent.schema.json', () => {
    for (const { name, doc } of intents) {
      assert.equal(validateIntent(doc), true, `${name}: ${errorsOf(validateIntent)}`);
      assert.equal(name, `${doc.purpose}.intent.json`, `${name}: filename must match the purpose`);
    }
  });

  test('every Flow purpose resolves to exactly one Review Intent, and vice versa', () => {
    const flowPurposes = flows.map(({ doc }) => doc.intent.purpose).sort();
    assert.deepEqual(flowPurposes, [...intentByPurpose.keys()].sort());
    assert.equal(new Set(flowPurposes).size, flowPurposes.length, 'purposes must be unique');
  });

  test('each Review Intent declares a distinct stage', () => {
    const stages = intents.map(({ doc }) => doc.stage).sort();
    assert.deepEqual(stages, ['final', 'plan', 'replan', 'task-completion']);
  });

  // The #2016 acceptance criterion "missing artifact は degrade/stop が明示される"
  // lives in two documents (the Intent declares the requirement, the Flow declares
  // the step outcome). These assertions are what stop them from drifting apart.
  test('Flow inputs and Review Intent evidence name the same artifacts', () => {
    for (const { name, doc } of flows) {
      const intent = intentByPurpose.get(doc.intent.purpose);
      const inputNames = (doc.inputs ?? []).map((input) => input.name).sort();
      const evidenceArtifacts = intent.evidence.map((entry) => entry.artifact).sort();
      assert.deepEqual(inputNames, evidenceArtifacts, `${name}: inputs vs evidence`);
    }
  });

  test('required evidence is a required Flow input, and optional evidence is not', () => {
    for (const { name, doc } of flows) {
      const intent = intentByPurpose.get(doc.intent.purpose);
      const inputByName = new Map((doc.inputs ?? []).map((input) => [input.name, input]));
      for (const entry of intent.evidence) {
        const input = inputByName.get(entry.artifact);
        const required = input.required === true;
        assert.equal(
          required,
          entry.requirement === 'required',
          `${name}: input "${entry.artifact}" required=${required} vs evidence ${entry.requirement}`
        );
      }
    }
  });

  test('required evidence always stops: no required artifact degrades or skips', () => {
    for (const { name, doc } of intents) {
      for (const entry of doc.evidence) {
        if (entry.requirement !== 'required') continue;
        assert.equal(entry.onMissing, 'stop', `${name}: required "${entry.artifact}"`);
      }
    }
  });

  test('a Flow that can stop on a missing artifact declares the stop condition', () => {
    for (const { name, doc } of flows) {
      const intent = intentByPurpose.get(doc.intent.purpose);
      const canStop = intent.evidence.some((entry) => entry.onMissing === 'stop');
      if (!canStop) continue;
      assert.ok(
        (doc.stopConditions ?? []).includes('DETERMINISTIC_UNRUNNABLE'),
        `${name}: declares a stop-on-missing artifact but no DETERMINISTIC_UNRUNNABLE stop condition`
      );
    }
  });

  test('every declared onMissing outcome is realized by a step outcome', () => {
    for (const { name, doc } of flows) {
      const intent = intentByPurpose.get(doc.intent.purpose);
      // `stop` is the schema default for a step with no onUnsatisfied, so only
      // the two opt-in outcomes need a step that spells them out.
      const stepOutcomes = new Set(
        doc.steps.map((step) => step.onUnsatisfied).filter((value) => value !== undefined)
      );
      for (const outcome of new Set(intent.evidence.map((entry) => entry.onMissing))) {
        if (outcome === 'stop') continue;
        assert.ok(
          stepOutcomes.has(outcome),
          `${name}: evidence declares onMissing "${outcome}" but no step declares it`
        );
      }
    }
  });

  test('every when.input is a declared, optional input', () => {
    for (const { name, doc } of flows) {
      const inputByName = new Map((doc.inputs ?? []).map((input) => [input.name, input]));
      for (const step of doc.steps) {
        if (!step.when) continue;
        const input = inputByName.get(step.when.input);
        assert.ok(input, `${name}: when.input "${step.when.input}" is not declared`);
        assert.notEqual(
          input.required,
          true,
          `${name}: conditioning on required input "${input.name}" is meaningless`
        );
      }
    }
  });

  test('a step conditioned on a present input skips rather than stops when absent', () => {
    for (const { name, doc } of flows) {
      for (const step of doc.steps) {
        if (step.when?.state !== 'present') continue;
        assert.equal(
          step.onUnsatisfied,
          'skip',
          `${name}: step gated on "${step.when.input}" must declare onUnsatisfied: skip`
        );
      }
    }
  });

  test('stop conditions reuse GATE_REASON_CODES, never a parallel vocabulary', () => {
    for (const { name, doc } of flows) {
      for (const code of doc.stopConditions ?? []) {
        assert.ok(GATE_REASON_CODES.includes(code), `${name}: unknown stop condition ${code}`);
      }
    }
  });

  test('Review Intent phase reuses the skill phase vocabulary', () => {
    const skillSchema = readJson(join(SCHEMAS_DIR, 'skill.schema.json'));
    const intentSchema = readJson(join(SCHEMAS_DIR, 'review-intent.schema.json'));
    assert.deepEqual(intentSchema.properties.phase.enum, skillSchema.$defs.phase.enum);
  });

  test('Review Intent artifact kinds are a subset of Agent Contract inputKind', () => {
    // #2014 owns the artifact-kind ledger. A Review Intent may narrow it; it may
    // not mint a kind no Agent can declare as an input.
    const agentSchema = readJson(join(SCHEMAS_DIR, 'agent-contract.schema.json'));
    const intentSchema = readJson(join(SCHEMAS_DIR, 'review-intent.schema.json'));
    const inputKinds = new Set(agentSchema.$defs.inputKind.enum);
    for (const kind of intentSchema.$defs.artifactKind.enum) {
      assert.ok(inputKinds.has(kind), `artifactKind "${kind}" is not an Agent Contract inputKind`);
    }
  });

  // Flow -> Agent -> Skill. The last hop is NOT re-declared anywhere in flows/:
  // each Agent Contract already carries its allowed skill ids (#2014), so the
  // Flows reach existing skills through the Agent axis instead of a new map.
  // This test pins the first hop, which is the only one #2016 adds.
  test('every judgment step primitive is owned by exactly one Agent Contract', () => {
    const STEP_TO_RESPONSIBILITY = {
      'resolve-intent': 'resolve-intent',
      'select-skills': 'plan-execution',
      'select-agents': 'select-agents',
      'parallel-review': 'generate-candidate-findings',
      'cross-artifact-review': 'judge-cross-artifact-consistency',
      'verify-findings': 'verify-findings',
      'evaluate-completion': 'evaluate-completion',
    };
    const contractsDir = resolve(REPO_ROOT, 'agents', 'contracts');
    const contracts = readdirSync(contractsDir)
      .filter((name) => name.endsWith('.agent.json'))
      .map((name) => readJson(join(contractsDir, name)));

    const usedPrimitives = new Set(
      flows.flatMap(({ doc }) => doc.steps.map((step) => step.use).filter(Boolean))
    );
    for (const primitive of usedPrimitives) {
      const responsibility = STEP_TO_RESPONSIBILITY[primitive];
      if (!responsibility) continue; // mechanical step (resolve-artifacts, derive-gate, ...)
      const owners = contracts.filter((contract) =>
        contract.responsibilities.includes(responsibility)
      );
      assert.equal(
        owners.length,
        1,
        `${primitive} -> ${responsibility}: ${owners.length} Agent Contracts claim it`
      );
    }
  });

  test('a reviewer lens step is owned by the per-role Agent, not by a new Agent', () => {
    const contractsDir = resolve(REPO_ROOT, 'agents', 'contracts');
    const specialist = readJson(join(contractsDir, 'specialist-reviewer.agent.json'));
    assert.equal(specialist.instantiatedPer, 'reviewer-role');
    assert.ok(specialist.skills.length > 0, 'the lens skills are declared on the Agent Contract');
    const lensSteps = flows.flatMap(({ doc }) =>
      doc.steps.map((step) => step.reviewer).filter(Boolean)
    );
    assert.ok(lensSteps.length > 0, 'the Flows use reviewer lens steps');
  });

  test('no Flow document names a skill: selection stays in Review Judgment', () => {
    // ADR-009 D3: which skill is selected is Review Judgment and must not be
    // duplicated into a Flow, an Intent, or the entry map.
    for (const { name, doc } of [...flows, ...intents, { name: 'entry-map.json', doc: entryMap }]) {
      const text = JSON.stringify(doc);
      for (const forbidden of ['"skills"', '"skill"', '"applyTo"']) {
        assert.equal(text.includes(forbidden), false, `${name} carries ${forbidden}`);
      }
    }
  });
});

describe('flow entry map (#2016)', () => {
  test('validates against schemas/flow-entry-map.schema.json', () => {
    assert.equal(validateEntryMap(entryMap), true, errorsOf(validateEntryMap));
  });

  test('the four user-facing entry names from #2016 are present', () => {
    assert.deepEqual(Object.keys(entryMap.entries).sort(), [
      'review-final',
      'review-plan',
      'review-replan',
      'review-task',
    ]);
  });

  test('every entry resolves to a shipped Flow id at the version it pins', () => {
    for (const [entryName, entry] of Object.entries(entryMap.entries)) {
      const flow = flowById.get(entry.flow);
      assert.ok(flow, `${entryName}: no Flow with id "${entry.flow}"`);
      assert.equal(
        entry.flowVersion,
        flow.version,
        `${entryName}: pinned ${entry.flowVersion} but the Flow is ${flow.version}`
      );
    }
  });

  test('every Flow is reachable from exactly one entry name', () => {
    const targets = Object.values(entryMap.entries)
      .map((entry) => entry.flow)
      .sort();
    assert.deepEqual(targets, EXPECTED_FLOW_IDS);
  });

  test('the entry map carries no runtime discriminator', () => {
    // AC "Claude / Codex で同一 Flow ID が使われる": the map cannot branch on a
    // runtime, so there is nothing for the two hosts to disagree about.
    const text = readFileSync(join(FLOWS_DIR, 'entry-map.json'), 'utf8');
    for (const forbidden of ['claude', 'codex', 'runtime', 'model']) {
      assert.equal(
        text.toLowerCase().includes(forbidden),
        false,
        `entry-map.json mentions "${forbidden}"`
      );
    }
  });
});

describe('observe mode (#2016)', () => {
  test('no runtime module loads flows/, so no gate or decision changes', () => {
    // #2016 defines and wires the Flows; executing them is a follow-up. Until an
    // engine lands, nothing under src/ or runners/ may read these documents, so
    // adding them provably cannot alter an existing gate, decision or finding.
    // When the engine does land, this test is the explicit thing that must be
    // changed — that is the point of pinning it.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(mjs|js|cjs|ts)$/.test(entry.name)) continue;
        const text = readFileSync(full, 'utf8');
        if (/['"`][^'"`]*\bflows\//.test(text)) offenders.push(full);
      }
    };
    walk(resolve(REPO_ROOT, 'src'));
    walk(resolve(REPO_ROOT, 'runners'));
    assert.deepEqual(offenders, [], `modules referencing flows/: ${offenders.join(', ')}`);
  });
});
