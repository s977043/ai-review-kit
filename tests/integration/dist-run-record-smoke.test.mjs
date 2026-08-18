// Dist smoke test for #1900.
//
// Root cause: src/lib/result-store.mjs `loadRunRecord` resolved the record file
// with `path.resolve(base, `${runId}.json`)`. ncc's asset relocator matches that
// shape and rewrites the whole expression into an asset reference rooted at the
// bundle's asset base directory, so in runners/github-action/dist the resolved
// path no longer started with `base` and the traversal guard threw on EVERY
// call, for every runId. `loadAllRunRecords` wraps each load in
// `.catch(() => null)`, so nothing was logged: the GitHub Action job-summary
// digest (src/cli/commands/run.mjs, the Epic #1347 S3 forced display point) and
// `river runs digest` / `summary` / `diff` reported zero runs while the records
// sat on disk. The same rewrite also copied 64 unrelated *.json files from the
// repository into runners/github-action/dist/river-review/.
//
// This test pins the BEHAVIOUR rather than the source spelling: it writes run
// records to a temp repo's store and runs the ACTUAL committed dist bundle's
// `runs digest`, asserting the records are counted. A future rewrite of any
// other file-resolution call that ncc relocates the same way would also be
// caught here, which an allowlist over `__nccwpck_require__.ab` occurrences in
// dist/ would not be.
//
// Like tests/integration/dist-schema-smoke.test.mjs (#1599) it trusts the
// committed dist instead of invoking `npm run build:action` itself, so the unit
// test run does not pay the ncc bundle cost; the "Action dist freshness" CI job
// keeps dist/ in sync with src/ separately.
import assert from 'node:assert/strict';
import fs, { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runCliAsSubprocess } from '../helpers/cli.mjs';
import { createTempGitRepo } from '../helpers/temp-repo.mjs';

// Anchored to this file rather than CWD — see the note in dist-schema-smoke.test.mjs.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DIST_ENTRY = resolve(REPO_ROOT, 'runners', 'github-action', 'dist', 'index.mjs');

/** Minimal run record shaped like the ones `river run --save` persists. */
function makeRunRecord(runId, timestamp, decision) {
  return {
    runId,
    timestamp,
    phase: 'midstream',
    reviewedTarget: '.',
    findings: [],
    gate: {
      decision,
      reasonCode: null,
      inputs: { humanApprovalMode: null },
    },
    finalSummary: {
      findingsCount: 0,
      suppressedCount: 0,
      overviewCount: 0,
      changedFilesCount: 1,
    },
  };
}

test(
  'built github-action dist bundle can read back stored run records (#1900)',
  { skip: !existsSync(DIST_ENTRY) ? 'runners/github-action/dist/index.mjs not built' : false },
  async (t) => {
    const { dir, cleanup } = await createTempGitRepo({
      prefix: 'river-dist-runs-smoke-',
      initialFiles: { 'src/app.js': 'export const value = 1;\n' },
    });
    t.after(cleanup);

    const storeDir = join(dir, '.river', 'runs');
    await fs.promises.mkdir(storeDir, { recursive: true });
    const records = [
      makeRunRecord('2026-01-01T00-00-00-000Z-aaa111', '2026-01-01T00:00:00.000Z', 'GO'),
      makeRunRecord('2026-01-02T00-00-00-000Z-bbb222', '2026-01-02T00:00:00.000Z', 'NO_GO'),
    ];
    for (const record of records) {
      await fs.promises.writeFile(
        join(storeDir, `${record.runId}.json`),
        JSON.stringify(record, null, 2),
        'utf8'
      );
    }

    const result = await runCliAsSubprocess(['runs', 'digest'], {
      cwd: dir,
      cliPath: DIST_ENTRY,
      env: { ...process.env, RIVER_REPO_ROOT: REPO_ROOT },
    });

    assert.strictEqual(result.code, 0, result.stderr);
    // The pre-fix bundle printed exactly this line: every loadRunRecord threw,
    // loadAllRunRecords swallowed it, and the digest saw an empty list.
    assert.doesNotMatch(
      result.stdout,
      /No stored runs found/,
      `dist bundle could not load any run record:\n${result.stdout}\n${result.stderr}`
    );
    // Both records must be counted, gate block included — `listRunRecords`
    // alone (which ncc does NOT rewrite) would never reach this assertion
    // because the digest is built from the FULL records loadRunRecord returns.
    assert.match(
      result.stdout,
      /Runs: 2 \(2 with gate\)/,
      `unexpected digest output:\n${result.stdout}\n${result.stderr}`
    );
    assert.match(result.stdout, /GO: 1/);
    assert.match(result.stdout, /NO_GO: 1/);
  }
);
