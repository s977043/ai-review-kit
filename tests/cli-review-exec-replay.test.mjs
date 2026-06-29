// #878 A2-3 — replay execution integration test.
//
// A2-3-pre (#922) added the snapshot schema. A2-3-runners (#933) made
// buildExecutionPlan emit it. A2-3-impl (this slice) wires runReviewExecReplay
// to resolve the current diff, read the carried-over snapshot, and invoke
// generateReview against the source plan's selectedSkills (no re-plan).
//
// The contract verified here is "replay EXECUTES skills" — proven by
// debug.execution.skillsExecuted and replaySnapshotUsed. The findings COUNT
// depends on LLM availability (heuristics alone may return 0), so CI without
// an API key asserts execution reach, not finding volume.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../src/cli.mjs');

function makeFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'river-a2-3-replay-'));
  const planPath = path.join(dir, 'plan.json');
  const diffPath = path.join(dir, 'diff.patch');

  writeFileSync(
    diffPath,
    [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index 111..222 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' export function foo() {',
      '+  const x = eval(userInput);',
      '   return 1;',
      ' }',
      '',
    ].join('\n')
  );

  const plan = {
    version: '1',
    timestamp: '2026-05-27T22:00:00Z',
    phase: 'midstream',
    status: 'ok',
    plan: {
      selectedSkills: [{ id: 'security-basic', name: 'Basic Security Review' }],
      skippedSkills: [],
      plannerMode: 'off',
    },
    debug: {
      execution: {
        snapshot: {
          fileTypes: ['typescript'],
          relatedADRs: [],
          reviewMode: 'standard',
          riskAssessment: null,
        },
      },
    },
  };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return { dir, planPath, diffPath };
}

function parseArtifact(stdout) {
  const jsonStart = stdout.indexOf('{');
  const jsonEnd = stdout.lastIndexOf('}');
  assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, `no JSON in stdout: ${stdout}`);
  return JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
}

describe('#878 A2-3 — `river review exec --plan` replay execution', () => {
  test('replay executes the source plan skills against the current diff', () => {
    const { dir, planPath, diffPath } = makeFixture();
    try {
      const r = spawnSync(
        process.execPath,
        [CLI, 'review', 'exec', '--plan', planPath, '--artifact', `diff=${diffPath}`, '--debug'],
        { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }
      );
      const artifact = parseArtifact(r.stdout);

      // Replay does NOT re-plan: the selectedSkills come verbatim from the source.
      assert.equal(artifact.plan.selectedSkills.length, 1);
      assert.equal(artifact.plan.selectedSkills[0].id, 'security-basic');

      // Replay EXECUTES (the A2-3 contract): generateReview ran the skill.
      assert.ok(artifact.debug?.execution, 'debug.execution must be present');
      assert.equal(artifact.debug.execution.skillsExecuted, 1);
      // The carried-over snapshot was consumed, not re-derived.
      assert.equal(artifact.debug.execution.replaySnapshotUsed, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('replay without a diff falls back to the echo contract (findings: [])', () => {
    const { dir, planPath } = makeFixture();
    try {
      const r = spawnSync(process.execPath, [CLI, 'review', 'exec', '--plan', planPath], {
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
      });
      const artifact = parseArtifact(r.stdout);
      // No diff resolved → nothing to execute against → echo contract holds.
      assert.deepEqual(artifact.findings, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--dry-run --plan does not execute (echo only)', () => {
    const { dir, planPath, diffPath } = makeFixture();
    try {
      const r = spawnSync(
        process.execPath,
        [
          CLI,
          'review',
          'exec',
          '--plan',
          planPath,
          '--artifact',
          `diff=${diffPath}`,
          '--dry-run',
          '--debug',
        ],
        { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }
      );
      const artifact = parseArtifact(r.stdout);
      // dry-run must not execute skills even with a diff present.
      assert.equal(artifact.debug?.execution ?? undefined, undefined);
      assert.deepEqual(artifact.findings, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
