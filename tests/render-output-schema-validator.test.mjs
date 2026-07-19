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

import { getOutputSchemaValidator } from '../src/cli/render.mjs';

describe('getOutputSchemaValidator', () => {
  it('loads schemas/output.schema.json and returns a compiled validator', () => {
    const validate = getOutputSchemaValidator();
    assert.notStrictEqual(validate, null, 'expected output.schema.json to load successfully');
    assert.strictEqual(typeof validate, 'function');
  });
});
