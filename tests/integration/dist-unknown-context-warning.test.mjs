// Dist smoke test for the #1759 C3 `--context` advisory (#1958 review, 修正 1 / 修正 2).
//
// Root cause (same shape as #1599, see tests/integration/dist-schema-smoke.test.mjs):
// `knownInputContexts()` in src/cli.mjs read the vocabulary via
// `fileURLToPath(new URL('../schemas/skill.schema.json', import.meta.url))`.
// ncc rewrites `new URL(<asset>, import.meta.url)` into
// `__nccwpck_require__.ab + "skill.schema.json"` — a BARE absolute path, not a
// file: URL — so `fileURLToPath()` threw `ERR_INVALID_URL` inside the bundle.
// The function's fail-safe `catch` swallowed that, cached `null`, and the
// advisory never fired anywhere in runners/github-action/dist/**.
//
// Why the test lives HERE and not next to the source test:
//   1. The failure is not observable from src/cli.mjs. Running from source,
//      `import.meta.url` is always a real file: URL, so the broken form and the
//      correct form behave identically. Only the bundled artifact separates
//      them (memory: measure at the layer that fails).
//   2. `tests/cli-unknown-context-warning.test.mjs` uses `runCliInProcess`,
//      which shares ONE module instance across the whole test process. Because
//      `knownInputContextsCache` is a module-level singleton, a single failed
//      read there would silence every later test in that process. A subprocess
//      against the dist bundle has no such cross-test coupling.
//
// The second test below is the one that covers the `null` branch of that cache
// (schema unreadable -> stay quiet, exit code untouched), which no test
// exercised before — and which is exactly what hid bug 1.
//
// Like dist-schema-smoke.test.mjs, this trusts the COMMITTED dist rather than
// running `npm run build:action` itself; the "Action dist freshness" CI job is
// what keeps dist/ in sync with src/.
import assert from 'node:assert/strict';
import fs, { existsSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runCliAsSubprocess } from '../helpers/cli.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DIST_DIR = resolve(REPO_ROOT, 'runners', 'github-action', 'dist');
const DIST_ENTRY = join(DIST_DIR, 'index.mjs');
const SKIP = !existsSync(DIST_ENTRY) ? 'runners/github-action/dist/index.mjs not built' : false;

const WARNING = 'outside the skill inputContext vocabulary';

/** `runs list` is the lightest surface that still goes through parseArgs. */
async function runDist(argv, cwd, cliPath = DIST_ENTRY) {
  return runCliAsSubprocess(argv, {
    cwd,
    cliPath,
    env: { ...process.env, RIVER_OFFLINE: '1', RIVER_REPO_ROOT: REPO_ROOT },
  });
}

async function tempCwd(t) {
  const dir = await fs.promises.mkdtemp(join(os.tmpdir(), 'river-1958-ctx-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  return dir;
}

test(
  'built github-action dist bundle warns on an unknown --context value (#1958)',
  { skip: SKIP },
  async (t) => {
    const cwd = await tempCwd(t);
    const result = await runDist(['runs', 'list', '--context', 'BOGUS_CONTEXT'], cwd);

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(
      result.stderr,
      new RegExp(WARNING),
      'the advisory must reach the bundled surface too — a fileURLToPath() wrapper ' +
        'around the schema URL makes it silently disappear here'
    );
    assert.match(result.stderr, /BOGUS_CONTEXT/);
  }
);

test(
  'built github-action dist bundle stays quiet for a known --context value',
  { skip: SKIP },
  async (t) => {
    const cwd = await tempCwd(t);
    const result = await runDist(['runs', 'list', '--context', 'diff'], cwd);

    assert.strictEqual(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stderr, new RegExp(WARNING));
  }
);

test(
  'an unreadable vocabulary schema stays silent instead of guessing (fail-safe null branch)',
  { skip: SKIP },
  async (t) => {
    // Copy the bundle, then remove ONLY the emitted skill.schema.json asset.
    // That is the one state in which `knownInputContexts()` caches `null`, and
    // the contract for it is: no warning, no error, exit code untouched.
    const sandbox = await fs.promises.mkdtemp(join(os.tmpdir(), 'river-1958-nodist-'));
    t.after(() => fs.promises.rm(sandbox, { recursive: true, force: true }));
    const brokenDist = join(sandbox, 'dist');
    await fs.promises.cp(DIST_DIR, brokenDist, { recursive: true });

    const asset = join(brokenDist, 'skill.schema.json');
    assert.ok(existsSync(asset), 'ncc must emit skill.schema.json next to index.mjs');
    await fs.promises.rm(asset);

    const cwd = await tempCwd(t);
    const result = await runDist(
      ['runs', 'list', '--context', 'BOGUS_CONTEXT'],
      cwd,
      join(brokenDist, 'index.mjs')
    );

    assert.strictEqual(result.code, 0, 'fail-safe must not change the exit code');
    assert.doesNotMatch(result.stderr, new RegExp(WARNING), 'no vocabulary -> nothing to claim');
    assert.doesNotMatch(
      result.stderr,
      /ENOENT|Invalid URL|ERR_INVALID_URL/,
      'must not leak the read failure'
    );
  }
);
