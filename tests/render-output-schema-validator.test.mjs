// Canary for #1599: fileURLToPath(new URL(...)) resolved schemas/output.schema.json
// correctly when render.mjs ran from source, but ncc rewrote the expression into a
// plain-path string in the built dist bundle, so fileURLToPath threw
// `TypeError [ERR_INVALID_URL]: Invalid URL` and getOutputSchemaValidator()
// silently fell back to null — disabling output schema validation on every
// dist (GitHub Action) run without any test catching it. This test asserts the
// source-level contract directly: the validator must load successfully.
// A companion dist smoke test (tests/integration/dist-schema-smoke.test.mjs,
// gated on the built bundle) covers the ncc-bundled path this test cannot see.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatJsonOutput, getOutputSchemaValidator } from '../src/cli/render.mjs';

describe('getOutputSchemaValidator', () => {
  it('loads schemas/output.schema.json and returns a compiled validator', () => {
    const validate = getOutputSchemaValidator();
    assert.notStrictEqual(validate, null, 'expected output.schema.json to load successfully');
    assert.strictEqual(typeof validate, 'function');
  });
});

// #1644 Phase 1: the JSON artifact is what output.schema.json governs, so a
// schema field that never reaches formatJsonOutput would be unobservable.
describe('formatJsonOutput scope propagation', () => {
  const baseFinding = {
    id: 'rr-1',
    ruleId: 'security-basic',
    title: 'token',
    message: 'Finding: token Evidence: x Severity: warning Confidence: high Fix: rotate the token',
    severity: 'major',
    confidence: 'high',
    status: 'open',
    evidence: ['x'],
    file: 'src/app.mjs',
    lineStart: 3,
    lineEnd: 3,
  };

  it('emits scope on the issue when the finding carries one', () => {
    const out = formatJsonOutput(
      { findings: [{ ...baseFinding, scope: 'pre-existing' }] },
      'midstream'
    );
    assert.strictEqual(out.issues[0].scope, 'pre-existing');
    const validate = getOutputSchemaValidator();
    assert.ok(validate(out), JSON.stringify(validate.errors));
  });

  it('omits scope when the finding has none (back-compat)', () => {
    const out = formatJsonOutput({ findings: [baseFinding] }, 'midstream');
    assert.ok(!('scope' in out.issues[0]));
  });
});

// #1666 (#1545 Phase 2): same reachability contract as scope — the traceability
// refs must reach the JSON artifact, and must stay absent when unset so every
// pre-#1666 output still validates unchanged.
describe('formatJsonOutput traceability refs propagation', () => {
  const baseFinding = {
    id: 'rr-1',
    ruleId: 'requirements-acceptance',
    title: 'acceptance criterion is untestable',
    message:
      'Finding: AC-4 is untestable Evidence: x Severity: warning Confidence: high Fix: define the observable outcome',
    severity: 'major',
    confidence: 'high',
    status: 'open',
    evidence: ['x'],
    file: 'docs/prd.md',
    lineStart: 42,
    lineEnd: 42,
  };

  it('emits criterionRefs / artifactRefs and still validates against the schema', () => {
    const out = formatJsonOutput(
      {
        findings: [
          {
            ...baseFinding,
            criterionRefs: ['AC-4', 'TC-7'],
            artifactRefs: ['plan.md#AC-4', 'todo.md#TASK-3'],
          },
        ],
      },
      'upstream'
    );
    assert.deepStrictEqual(out.issues[0].criterionRefs, ['AC-4', 'TC-7']);
    assert.deepStrictEqual(out.issues[0].artifactRefs, ['plan.md#AC-4', 'todo.md#TASK-3']);
    const validate = getOutputSchemaValidator();
    assert.ok(validate(out), JSON.stringify(validate.errors));
  });

  it('omits both fields when the finding has none (back-compat)', () => {
    const out = formatJsonOutput({ findings: [baseFinding] }, 'upstream');
    assert.ok(!('criterionRefs' in out.issues[0]));
    assert.ok(!('artifactRefs' in out.issues[0]));
    const validate = getOutputSchemaValidator();
    assert.ok(validate(out), JSON.stringify(validate.errors));
  });

  it('omits both fields for null and empty-array values', () => {
    const out = formatJsonOutput(
      { findings: [{ ...baseFinding, criterionRefs: null, artifactRefs: [] }] },
      'upstream'
    );
    assert.ok(!('criterionRefs' in out.issues[0]), 'null must not be serialized');
    assert.ok(!('artifactRefs' in out.issues[0]), 'an empty array must not be serialized');
    const validate = getOutputSchemaValidator();
    assert.ok(validate(out), JSON.stringify(validate.errors));
  });
});
