// `river promote propose` — stable CLI + content-addressed candidate id
// (#1624 / #1574 P0 contract 4).
//
// The core property under test is idempotent convergence: proposing twice from
// the same evidence must yield exactly one candidate with the same id.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import { createTempMemory } from './helpers/memory.mjs';
import { loadMemory } from '../src/lib/riverbed-memory.mjs';
import {
  CANDIDATE_POLICY_VERSION,
  buildProposedCandidate,
  computeCandidateContentHash,
  normalizeEvidence,
} from '../src/lib/promotion-candidates.mjs';

const CLUSTER = 'repository-layer-boundary::false_positive';
const NOW = '2026-07-20T00:00:00.000Z';

const feedback = (pr, fingerprint) => ({
  timestamp: `2026-07-1${pr}T00:00:00.000Z`,
  trigger: 'pr-comment',
  feedbackType: 'false_positive',
  skillId: 'repository-layer-boundary',
  findingFingerprint: fingerprint ?? null,
  evidence: `PR #${pr} の指摘は誤検出`,
  pr,
});

const ENTRIES = [feedback(1, 'a'.repeat(16)), feedback(2, 'b'.repeat(16))];

/** Seed a temp Riverbed index plus an input JSONL file. */
function seed(entries = ENTRIES) {
  const { cleanup, dir, indexPath } = createTempMemory({
    layout: 'flat',
    prefix: 'rr-cli-propose-',
  });
  const inputPath = join(dir, 'candidate-feedback.jsonl');
  writeFileSync(inputPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return { cleanup, dir, indexPath, inputPath };
}

function proposeArgs(indexPath, inputPath, extra = []) {
  return [
    'promote',
    'propose',
    '--input',
    inputPath,
    '--cluster-key',
    CLUSTER,
    '--index',
    indexPath,
    '--output',
    'json',
    ...extra,
  ];
}

const env = { RIVER_NOW: NOW };

describe('river promote propose', () => {
  test('creates a content-addressed candidate from an explicit JSONL selection', async (t) => {
    const { cleanup, indexPath, inputPath } = seed();
    t.after(cleanup);
    const res = await runCliInProcess(proposeArgs(indexPath, inputPath), { env });
    assert.equal(res.code, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.created, true);
    assert.equal(out.clusterKey, CLUSTER);
    assert.equal(out.policyVersion, CANDIDATE_POLICY_VERSION);
    assert.equal(out.shadowOnly, false);
    assert.match(out.candidateId, /^RR-PC-[0-9a-f]{12}$/);
    assert.ok(out.contentHash.startsWith(out.candidateId.slice('RR-PC-'.length)));
    assert.equal(out.entry.context.promotionCandidate.promotionStatus, 'candidate');
    assert.equal(out.entry.context.promotionCandidate.recurrenceCount, 2);
    const index = loadMemory(indexPath);
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0].id, out.candidateId);
  });

  test('re-running with the same evidence converges on one candidate (idempotent)', async (t) => {
    const { cleanup, indexPath, inputPath } = seed();
    t.after(cleanup);
    const first = await runCliInProcess(proposeArgs(indexPath, inputPath), { env });
    assert.equal(first.code, 0, first.stderr);
    // A later run on a different day must not mint a second candidate: the id
    // is derived from evidence, not from the date.
    const second = await runCliInProcess(proposeArgs(indexPath, inputPath), {
      env: { RIVER_NOW: '2026-09-01T00:00:00.000Z' },
    });
    assert.equal(second.code, 0, second.stderr);
    const a = JSON.parse(first.stdout);
    const b = JSON.parse(second.stdout);
    assert.equal(a.candidateId, b.candidateId);
    assert.equal(b.created, false);
    assert.equal(b.wouldCreate, false);
    assert.equal(b.existing.candidateId, a.candidateId);
    assert.equal(b.existing.promotionStatus, 'candidate');
    const index = loadMemory(indexPath);
    assert.equal(index.entries.length, 1);
  });

  test('evidence order in the input file does not change the candidate id', async (t) => {
    const first = seed(ENTRIES);
    const second = seed([...ENTRIES].reverse());
    t.after(first.cleanup);
    t.after(second.cleanup);
    const a = await runCliInProcess(proposeArgs(first.indexPath, first.inputPath), { env });
    const b = await runCliInProcess(proposeArgs(second.indexPath, second.inputPath), { env });
    assert.equal(a.code, 0, a.stderr);
    assert.equal(b.code, 0, b.stderr);
    assert.equal(JSON.parse(a.stdout).candidateId, JSON.parse(b.stdout).candidateId);
  });

  test('--dry-run reports the candidate without writing the index', async (t) => {
    const { cleanup, indexPath, inputPath } = seed();
    t.after(cleanup);
    const res = await runCliInProcess(proposeArgs(indexPath, inputPath, ['--dry-run']), { env });
    assert.equal(res.code, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.created, false);
    assert.equal(out.wouldCreate, true);
    assert.equal(out.dryRun, true);
    assert.deepEqual(loadMemory(indexPath).entries, []);
  });

  test('a different policy version yields a different candidate id', async (t) => {
    const { cleanup, indexPath, inputPath } = seed();
    t.after(cleanup);
    const base = await runCliInProcess(proposeArgs(indexPath, inputPath, ['--dry-run']), { env });
    const bumped = await runCliInProcess(
      proposeArgs(indexPath, inputPath, ['--dry-run', '--policy-version', '2']),
      { env }
    );
    assert.equal(base.code, 0, base.stderr);
    assert.equal(bumped.code, 0, bumped.stderr);
    assert.notEqual(JSON.parse(base.stdout).candidateId, JSON.parse(bumped.stdout).candidateId);
  });

  test('fingerprint-less evidence is marked shadow-only', async (t) => {
    const { cleanup, indexPath, inputPath } = seed([feedback(1), feedback(2)]);
    t.after(cleanup);
    const res = await runCliInProcess(proposeArgs(indexPath, inputPath), { env });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).shadowOnly, true);
  });

  test('text output prints the candidate summary', async (t) => {
    const { cleanup, indexPath, inputPath } = seed();
    t.after(cleanup);
    const res = await runCliInProcess(
      ['promote', 'propose', '--input', inputPath, '--cluster-key', CLUSTER, '--index', indexPath],
      { env }
    );
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Created promotion candidate RR-PC-[0-9a-f]{12}\./);
    assert.match(res.stdout, /clusterKey:\s+repository-layer-boundary::false_positive/);
  });
});

describe('river promote propose validation', () => {
  test('missing --input / --cluster-key is a usage error (exit 1)', async (t) => {
    const { cleanup, indexPath, inputPath } = seed();
    t.after(cleanup);
    const noCluster = await runCliInProcess(
      ['promote', 'propose', '--input', inputPath, '--index', indexPath],
      { env }
    );
    assert.equal(noCluster.code, 1);
    assert.match(noCluster.stderr, /requires --input .* and --cluster-key/);
  });

  test('entries outside --cluster-key are rejected instead of filtered', async (t) => {
    const { cleanup, indexPath, inputPath } = seed([
      ...ENTRIES,
      { ...feedback(3, 'c'.repeat(16)), skillId: 'other-skill' },
    ]);
    t.after(cleanup);
    const res = await runCliInProcess(proposeArgs(indexPath, inputPath), { env });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /outside --cluster-key/);
    assert.deepEqual(loadMemory(indexPath).entries, []);
  });

  test('a cluster below the minimum recurrence is rejected', async (t) => {
    const { cleanup, indexPath, inputPath } = seed([feedback(1, 'a'.repeat(16))]);
    t.after(cleanup);
    const res = await runCliInProcess(proposeArgs(indexPath, inputPath), { env });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /below the minimum recurrence/);
  });

  test('a malformed cluster key is rejected', async (t) => {
    const { cleanup, indexPath, inputPath } = seed();
    t.after(cleanup);
    const res = await runCliInProcess(
      ['promote', 'propose', '--input', inputPath, '--cluster-key', 'nope', '--index', indexPath],
      { env }
    );
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--cluster-key must be/);
  });

  test('an unreadable --input is an error, not a silent empty proposal', async (t) => {
    const { cleanup, indexPath, dir } = seed();
    t.after(cleanup);
    const res = await runCliInProcess(proposeArgs(indexPath, join(dir, 'missing.jsonl')), { env });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Cannot read --input/);
  });
});

describe('candidate content hash', () => {
  test('normalizeEvidence sorts, deduplicates and flags missing fingerprints', () => {
    const withFp = normalizeEvidence([feedback(2, 'b'.repeat(16)), feedback(1, 'a'.repeat(16))]);
    assert.equal(withFp.fingerprintless, false);
    assert.deepEqual(
      withFp.evidence.map((e) => e.findingFingerprint),
      ['a'.repeat(16), 'b'.repeat(16)]
    );
    const duplicated = normalizeEvidence([
      feedback(1, 'a'.repeat(16)),
      feedback(1, 'a'.repeat(16)),
    ]);
    assert.equal(duplicated.evidence.length, 1);
    assert.equal(normalizeEvidence([feedback(1)]).fingerprintless, true);
  });

  test('the hash ignores wall-clock time but tracks the evidence set', () => {
    const build = (now, entries = ENTRIES) =>
      buildProposedCandidate({ entries, clusterKey: CLUSTER, now: new Date(now) });
    assert.equal(
      build('2026-07-20T00:00:00.000Z').candidateId,
      build('2027-01-01T12:34:56.000Z').candidateId
    );
    assert.notEqual(
      build('2026-07-20T00:00:00.000Z').candidateId,
      build('2026-07-20T00:00:00.000Z', [...ENTRIES, feedback(3, 'c'.repeat(16))]).candidateId
    );
  });

  test('computeCandidateContentHash is stable for the fixed canonical triple', () => {
    const { evidence } = normalizeEvidence(ENTRIES);
    const first = computeCandidateContentHash({ clusterKey: CLUSTER, evidence });
    const second = computeCandidateContentHash({ clusterKey: CLUSTER, evidence });
    assert.equal(first.contentHash, second.contentHash);
    assert.equal(first.candidateId, `RR-PC-${first.contentHash.slice(0, 12)}`);
  });
});
