// tests/cli-river-phase-env-validation.test.mjs
//
// #1759 C2: RIVER_PHASE used to skip validation entirely — an invalid value
// (e.g. `RIVER_PHASE=BOGUS`) propagated straight through to the printed
// phase with exit 0, while the CLI's own `--phase` flag already validated
// against the same PHASES vocabulary and exited 1 on an invalid value
// (src/cli.mjs, the `arg === '--phase'` branch). This file pins the fix:
// RIVER_PHASE is now validated with the SAME PHASES list and the SAME
// case-insensitive normalization as `--phase`, reusing that check rather
// than re-deriving it (CLAUDE.md "Import the SSoT, never re-derive it").
//
// Why this is a SEPARATE file instead of new rows in
// tests/cli-usage-error-exit-codes.test.mjs:
//
// That file's canary sweeps `argv` only. Its single `before()` hook builds
// one temp repo and runs every CASES/CONTROL_CASES row through the same
// `env` object, which unconditionally sets `RIVER_PHASE: undefined` for
// EVERY row (see its `sweep()` helper) — the table has no per-row env
// dimension, so an env-var-driven case cannot be expressed as a row in it
// without changing the sweep's shape for every existing row. Extending that
// table would either require adding an env dimension the other 106 rows do
// not use, or silently relying on process-level env mutation ordering
// between rows, neither of which fits the table's "one argv column" pin
// contract. A dedicated file keeps the CASES/VALID_CASES pin scope stable
// while still covering RIVER_PHASE with the same before/after discipline.
//
// Behavior pinned here (measured against the worktree — see PR body for the
// exact commands and exit codes):
//   - RIVER_PHASE unset               -> phase defaults to 'midstream', exit 0 (unchanged)
//   - RIVER_PHASE=''  (empty string)  -> phase defaults to 'midstream', exit 0 (unchanged)
//   - RIVER_PHASE=upstream            -> phase='upstream', exit 0 (unchanged)
//   - RIVER_PHASE=Upstream (mixed case) -> phase='upstream', exit 0 (NEW: previously passed
//     through unnormalized as literal 'Upstream'; now case-insensitive like --phase)
//   - RIVER_PHASE=BOGUS               -> exit 1, `Error: RIVER_PHASE must be one of: ...` (NEW;
//     previously exit 0 with the invalid value printed as-is)
//   - RIVER_PHASE=BOGUS with --phase upstream -> exit 0, phase='upstream' (the explicit flag
//     wins and the invalid env value is never consulted)
//
// This is a narrowing of RIVER_PHASE's accepted range: an existing caller
// that was passing an invalid value now gets exit 1 instead of a silently
// wrong phase.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { PHASES } from '../src/lib/planner-utils.mjs';
import { runCliInProcess } from './helpers/cli.mjs';
import { createTempGitRepo } from './helpers/temp-repo.mjs';

describe('#1759 C2: RIVER_PHASE validation matches --phase', () => {
  let cleanupRepo = null;
  let repoDir = null;

  before(async () => {
    const { dir, cleanup } = await createTempGitRepo({
      prefix: 'river-phase-env-',
      initialFiles: { 'a.txt': 'a\n' },
      changedFiles: { 'a.txt': 'a\nb\n' },
    });
    repoDir = dir;
    cleanupRepo = cleanup;
  });

  after(async () => {
    if (cleanupRepo) await cleanupRepo();
  });

  const run = (argv, env) =>
    runCliInProcess(argv, {
      cwd: repoDir,
      env: {
        RIVER_OFFLINE: '1',
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        NO_COLOR: '1',
        RIVER_PLANNER_MODE: undefined,
        RIVER_PHASE: undefined,
        ...env,
      },
    });

  test('RIVER_PHASE unset keeps defaulting to midstream (exit 0)', async () => {
    const result = await run(['run', '.', '--dry-run'], { RIVER_PHASE: undefined });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Phase: midstream/);
  });

  test('RIVER_PHASE="" (empty string) keeps defaulting to midstream (exit 0)', async () => {
    const result = await run(['run', '.', '--dry-run'], { RIVER_PHASE: '' });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Phase: midstream/);
  });

  test('RIVER_PHASE=upstream is accepted (exit 0)', async () => {
    const result = await run(['run', '.', '--dry-run'], { RIVER_PHASE: 'upstream' });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Phase: upstream/);
  });

  test('RIVER_PHASE=Upstream (mixed case) is normalized like --phase (exit 0)', async () => {
    const result = await run(['run', '.', '--dry-run'], { RIVER_PHASE: 'Upstream' });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Phase: upstream/);
  });

  test('RIVER_PHASE=BOGUS is rejected with exit 1 and the same wording as --phase', async () => {
    const result = await run(['run', '.', '--dry-run'], { RIVER_PHASE: 'BOGUS' });
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      new RegExp(`Error: RIVER_PHASE must be one of: ${PHASES.join(', ')} \\(got "BOGUS"\\)\\.`)
    );
  });

  test('an explicit --phase overrides an invalid RIVER_PHASE (exit 0)', async () => {
    const result = await run(['run', '.', '--dry-run', '--phase', 'upstream'], {
      RIVER_PHASE: 'BOGUS',
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Phase: upstream/);
  });

  test('an explicit invalid --phase still exits 1 even when RIVER_PHASE is valid', async () => {
    const result = await run(['run', '.', '--dry-run', '--phase', 'BOGUS'], {
      RIVER_PHASE: 'upstream',
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Error: --phase must be one of:/);
  });
});
