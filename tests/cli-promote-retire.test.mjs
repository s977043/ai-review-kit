// CLI end-to-end tests for `river promote retire` and
// `river promote review-effectiveness` (Phase 3, #1568-C / #1623).
// Uses --index (seeded temp Riverbed index) and --feedback-root so no git repo
// is required; asserts stdout / exit codes and the persisted index.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import { createTempMemory } from './helpers/memory.mjs';
import { buildPromotionCandidateEntry } from '../scripts/feedback-rule-candidates.mjs';
import { applyPromotionDecision } from '../src/lib/promotion.mjs';
import { appendEntry, loadMemory } from '../src/lib/riverbed-memory.mjs';

const now = new Date('2026-07-20T00:00:00.000Z'); // expiresAt = +90d (2026-10-18)
const fp = (pr) => ({ pr, findingFingerprint: null, feedbackType: 'false_positive' });

const approve = (entry) =>
  applyPromotionDecision(entry, {
    decision: 'approved',
    approver: 'alice',
    now: new Date('2026-07-21T00:00:00.000Z'),
  });

// Seed a nested-layout memory index plus a feedback JSONL file.
function seed({ approveFixture = false, feedback = [] } = {}) {
  const { cleanup, indexPath, dir } = createTempMemory({
    layout: 'nested',
    prefix: 'rr-cli-retire-',
  });
  const fixture = buildPromotionCandidateEntry({
    skillId: 'repository-layer-boundary',
    feedbackType: 'false_positive',
    group: [fp(1), fp(2)],
    now,
  });
  if (approveFixture) approve(fixture);
  appendEntry(indexPath, fixture);

  if (feedback.length) {
    const fbDir = join(dir, '.river', 'feedback');
    mkdirSync(fbDir, { recursive: true });
    writeFileSync(
      join(fbDir, '2026-07.jsonl'),
      feedback.map((e) => JSON.stringify(e)).join('\n') + '\n'
    );
  }
  return { cleanup, indexPath, dir, fixtureId: fixture.id };
}

const fb = ({ skillId, feedbackType = 'accepted', timestamp, reversedBy }) => {
  const e = { timestamp, trigger: 'pr-comment', feedbackType, skillId, findingFingerprint: null };
  if (reversedBy) e.reversedBy = reversedBy;
  return e;
};

describe('river promote retire', () => {
  test('archives an expired candidate and syncs promotionStatus', async (t) => {
    const { cleanup, indexPath, fixtureId } = seed({ approveFixture: true });
    t.after(cleanup);
    const res = await runCliInProcess(['promote', 'retire', '--index', indexPath], {
      env: { RIVER_NOW: '2026-11-01T00:00:00.000Z' },
    });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Retired 1 promotion candidate/);
    assert.match(res.stdout, /approved -> archived/);
    const entry = loadMemory(indexPath).entries.find((e) => e.id === fixtureId);
    assert.equal(entry.status, 'archived');
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'archived');
  });

  test('nothing to retire before expiry (exit 0, friendly message)', async (t) => {
    const { cleanup, indexPath } = seed({ approveFixture: true });
    t.after(cleanup);
    const res = await runCliInProcess(['promote', 'retire', '--index', indexPath], {
      env: { RIVER_NOW: '2026-08-01T00:00:00.000Z' },
    });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /No promotion candidates to retire/);
  });
});

describe('river promote review-effectiveness', () => {
  test('flags needs_review when negative feedback reaches the threshold', async (t) => {
    const { cleanup, indexPath, dir, fixtureId } = seed({
      approveFixture: true,
      feedback: [
        fb({
          skillId: 'repository-layer-boundary',
          feedbackType: 'false_positive',
          timestamp: '2026-07-25T00:00:00.000Z',
        }),
        fb({
          skillId: 'repository-layer-boundary',
          feedbackType: 'accepted',
          timestamp: '2026-07-26T00:00:00.000Z',
          reversedBy: 'pr-9',
        }),
      ],
    });
    t.after(cleanup);
    const res = await runCliInProcess(
      [
        'promote',
        'review-effectiveness',
        '--index',
        indexPath,
        '--feedback-root',
        dir,
        '--threshold',
        '2',
      ],
      { env: { RIVER_NOW: '2026-07-30T00:00:00.000Z' } }
    );
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /FLAGGED needs_review/);
    assert.match(res.stdout, /negative=2/);
    const entry = loadMemory(indexPath).entries.find((e) => e.id === fixtureId);
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'needs_review');
    assert.equal(entry.context.effectiveness.decision, 'needs_review');
  });

  test('retains a candidate below the threshold (--output json)', async (t) => {
    const { cleanup, indexPath, dir, fixtureId } = seed({
      approveFixture: true,
      feedback: [
        fb({
          skillId: 'repository-layer-boundary',
          feedbackType: 'false_positive',
          timestamp: '2026-07-25T00:00:00.000Z',
        }),
      ],
    });
    t.after(cleanup);
    const res = await runCliInProcess(
      [
        'promote',
        'review-effectiveness',
        '--index',
        indexPath,
        '--feedback-root',
        dir,
        '--output',
        'json',
      ],
      { env: { RIVER_NOW: '2026-07-30T00:00:00.000Z' } }
    );
    assert.equal(res.code, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.threshold, 2);
    assert.equal(parsed.flagged, 0);
    const entry = loadMemory(indexPath).entries.find((e) => e.id === fixtureId);
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'approved');
  });

  test('unknown id exits 1', async (t) => {
    const { cleanup, indexPath, dir } = seed({ approveFixture: true });
    t.after(cleanup);
    const res = await runCliInProcess(
      ['promote', 'review-effectiveness', 'nope', '--index', indexPath, '--feedback-root', dir],
      { env: { RIVER_NOW: '2026-07-30T00:00:00.000Z' } }
    );
    assert.equal(res.code, 1);
    assert.match(res.stderr, /No promotion_candidate entry/);
  });

  test('rejects a non-positive --threshold', async (t) => {
    const { cleanup, indexPath, dir } = seed({ approveFixture: true });
    t.after(cleanup);
    const res = await runCliInProcess(
      [
        'promote',
        'review-effectiveness',
        '--index',
        indexPath,
        '--feedback-root',
        dir,
        '--threshold',
        '0',
      ],
      { env: { RIVER_NOW: '2026-07-30T00:00:00.000Z' } }
    );
    // Invalid flag values are a usage error (#1709 Slice 2: exit 1 + stderr
    // summary), matching the existing --approver/--reason validation behavior.
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--threshold option requires a positive integer/);
  });
});
