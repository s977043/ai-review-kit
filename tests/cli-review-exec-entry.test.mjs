// tests/cli-review-exec-entry.test.mjs
//
// `river review exec --entry <name>` (Epic #2011 AC7 P2, Beta, record only).
//
// What is pinned:
//
//   1. `review exec --entry` runs the pinned Flow through
//      src/lib/flow-runner.mjs (P1) and appends `steps`, one entry per Flow
//      step, in document order, with an outcome drawn from the closed set the
//      artifact schema declares. Measured on the 4 core entries.
//   2. Record only (RA-1): `gate`, `decision`, `findings`, `plan` and
//      `suggestedLoopSignal` are byte-identical to the run WITHOUT `--entry`
//      on the same inputs. The runner's `stopped` never reaches the gate.
//   3. Additive: without `--entry` the key set is what it was; with it the
//      keys are `…, flow, evidenceRequirements, steps` followed by the
//      trailing `executionManifest` (#2054 PR-4 pins that one last).
//   4. `review plan --entry` and `review exec --dry-run --entry` attach the
//      pin only: no `steps`, because no review ran.
//   5. The emitted artifact validates against schemas/review-artifact.schema.json.
//
// Output capture: as in tests/cli-review-plan-entry.test.mjs the artifact is
// read back from --output-file (runCliInProcess does not capture stdout).

import assert from 'node:assert/strict';
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

import { resolveFlowEntry } from '../src/lib/flow-loader.mjs';
import { runCliInProcess } from './helpers/cli.mjs';
import { compileReviewArtifactValidator } from './helpers/schema-validator.mjs';
import { createTempDir, cleanupTempDir } from './helpers/temp-dir.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, 'fixtures', 'plangate-review-artifacts');
const SCHEMA = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'schemas', 'review-artifact.schema.json'), 'utf8')
);
const OUTCOMES = new Set(SCHEMA.properties.steps.items.properties.outcome.enum);
const KINDS = new Set(SCHEMA.properties.steps.items.properties.kind.enum);
const validate = compileReviewArtifactValidator();

const CORE_ENTRIES = ['review-plan', 'review-replan', 'review-task', 'review-final'];
const ENV = { RIVER_OFFLINE: '1', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', NO_COLOR: '1' };

function setupRepo(t) {
  const dir = createTempDir({ prefix: 'rr-review-exec-entry-' });
  t.after(() => cleanupTempDir(dir));
  for (const f of ['plan.md', 'todo.md', 'diff.patch']) {
    copyFileSync(join(FIXTURE, f), join(dir, f));
  }
  return dir;
}

let counter = 0;
async function run(dir, argv) {
  const out = join(dir, `artifact-${counter++}.json`);
  const result = await runCliInProcess(
    ['review', ...argv, '--phase', 'upstream', '--output-file', out],
    { cwd: dir, env: ENV }
  );
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(readFileSync(out, 'utf8'));
}

/** Drop the manifest (#2054 PR-4): it pins the flow, so it differs by design. */
const withoutManifest = ({ executionManifest, ...rest }) => rest;

describe('river review exec --entry (Epic #2011 AC7 P2)', () => {
  for (const entry of CORE_ENTRIES) {
    test(`${entry}: one step record per Flow step, closed outcome set, schema-valid, gate untouched`, async (t) => {
      const dir = setupRepo(t);
      const without = await run(dir, ['exec']);
      const withEntry = await run(dir, ['exec', '--entry', entry]);
      assert.equal(validate(withEntry), true, JSON.stringify(validate.errors));

      const { document } = resolveFlowEntry(entry);
      assert.ok(Array.isArray(withEntry.steps));
      assert.equal(withEntry.steps.length, document.steps.length);
      withEntry.steps.forEach((step, i) => {
        assert.equal(step.index, i);
        assert.equal(step.id, document.steps[i].use ?? document.steps[i].reviewer);
        assert.ok(KINDS.has(step.kind), `unknown kind ${step.kind}`);
        assert.ok(OUTCOMES.has(step.outcome), `unknown outcome ${step.outcome}`);
      });
      // P2 wires no capability: nothing may claim to have executed.
      assert.equal(
        withEntry.steps.some((s) => s.outcome === 'executed'),
        false,
        'no capability is wired in P2, so no step can be executed'
      );

      // RA-1: the runner's result does not feed the judgment.
      assert.deepEqual(withEntry.gate, without.gate);
      assert.equal(withEntry.decision, without.decision);
      assert.deepEqual(withEntry.findings, without.findings);
      assert.deepEqual(withEntry.plan, without.plan);
      assert.equal(withEntry.suggestedLoopSignal, without.suggestedLoopSignal);
    });
  }

  test('additive: keys are the base keys, then flow / evidenceRequirements / steps, then the manifest', async (t) => {
    const dir = setupRepo(t);
    const without = await run(dir, ['exec']);
    const withEntry = await run(dir, ['exec', '--entry', 'review-plan']);
    assert.equal('steps' in without, false);
    assert.equal('flow' in without, false);
    const baseKeys = Object.keys(withoutManifest(without));
    assert.deepEqual(Object.keys(withoutManifest(withEntry)), [
      ...baseKeys,
      'flow',
      'evidenceRequirements',
      'steps',
    ]);
    assert.deepEqual(Object.keys(withEntry).slice(-1), ['executionManifest']);
  });

  test('plan --entry and exec --dry-run --entry carry the pin but no steps (no review ran)', async (t) => {
    const dir = setupRepo(t);
    const plan = await run(dir, ['plan', '--plan-only', '--entry', 'review-plan']);
    assert.ok(plan.flow);
    assert.equal('steps' in plan, false);
    const dry = await run(dir, ['exec', '--dry-run', '--entry', 'review-plan']);
    assert.ok(dry.flow);
    assert.equal('steps' in dry, false);
  });

  test('the schema rejects a step with an unknown outcome or an extra key', async (t) => {
    const dir = setupRepo(t);
    const artifact = await run(dir, ['exec', '--entry', 'review-task']);
    const badOutcome = structuredClone(artifact);
    badOutcome.steps[0].outcome = 'nope';
    assert.equal(validate(badOutcome), false);
    const extraKey = structuredClone(artifact);
    extraKey.steps[0].verdict = 'GO';
    assert.equal(validate(extraKey), false);
  });
});
