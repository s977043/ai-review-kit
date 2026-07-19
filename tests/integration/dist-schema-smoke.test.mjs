// Dist smoke test for #1599.
//
// Root cause: src/cli/render.mjs resolved schemas/output.schema.json via
// `fileURLToPath(new URL('../../schemas/output.schema.json', import.meta.url))`.
// That works when running from source, but `npm run build:action` (ncc)
// rewrites the `new URL(...)` expression into a plain-path string
// (`__nccwpck_require__.ab + "output.schema.json"`) in the bundled
// runners/github-action/dist/index.mjs. fileURLToPath then throws
// `TypeError [ERR_INVALID_URL]: Invalid URL` because that string is not a
// valid file: URL, so getOutputSchemaValidator() silently fell back to null
// and printed `Warning: could not load output.schema.json for validation:
// Invalid URL` on every dist (GitHub Action) run — output schema validation
// was disabled with no test catching it, since all existing tests exercise
// src/cli.mjs directly, never the built dist bundle.
//
// This test runs the ACTUAL committed dist bundle (not source) end-to-end
// with `--dry-run --output json`, which is enough to reach
// formatJsonOutput -> validateOutputArtifact -> getOutputSchemaValidator, and
// asserts the warning does not appear on stderr. It intentionally does not
// invoke `npm run build:action` itself (that would make every unit-test run
// pay the ~3s ncc bundle cost); it trusts the committed dist, matching the
// existing "Action dist freshness" CI job's job of keeping dist/ in sync with
// src/ separately.
import assert from 'node:assert/strict';
import fs, { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { runCliAsSubprocess } from '../helpers/cli.mjs';
import { createTempGitRepo, runGit } from '../helpers/temp-repo.mjs';

const REPO_ROOT = resolve('.');
const DIST_ENTRY = resolve('runners/github-action/dist/index.mjs');

test(
  'built github-action dist bundle loads output.schema.json without warning (#1599)',
  { skip: !existsSync(DIST_ENTRY) ? 'runners/github-action/dist/index.mjs not built' : false },
  async (t) => {
    const { dir, cleanup } = await createTempGitRepo({
      prefix: 'river-dist-smoke-',
      initialFiles: { 'src/app.js': 'export const value = 1;\n' },
    });
    t.after(cleanup);

    await fs.promises.writeFile(join(dir, 'src', 'app.js'), 'export const value = 2;\n', 'utf8');
    await runGit(['add', '.'], dir);

    const result = await runCliAsSubprocess(['run', '.', '--dry-run', '--output', 'json'], {
      cwd: dir,
      cliPath: DIST_ENTRY,
      // The dist bundle resolves skills/schemas relative to RIVER_REPO_ROOT
      // (see runners/core/skill-loader.mjs), matching how action.yml sets it
      // (`${{ github.action_path }}/../..`) for the real GitHub Action.
      env: { RIVER_REPO_ROOT: REPO_ROOT },
    });

    assert.strictEqual(result.code, 0, result.stderr);
    assert.doesNotMatch(
      result.stderr,
      /could not load output\.schema\.json/,
      `dist bundle failed to load output.schema.json:\n${result.stderr}`
    );
    // Sanity: the run actually produced JSON, so we know we reached the code
    // path that triggers schema validation (formatJsonOutput -> validateOutputArtifact).
    assert.match(result.stdout, /"issues"/);
  }
);
