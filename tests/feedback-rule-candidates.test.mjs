import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  findRuleCandidates,
  buildCandidatesArtifact,
  writeCandidatesArtifact,
  buildPromotionCandidate,
  buildPromotionCandidateEntry,
  buildPromotionCandidates,
  DEFAULT_EXPIRY_DAYS,
} from '../scripts/feedback-rule-candidates.mjs';
import { createTempDirAsync, cleanupTempDirAsync } from './helpers/temp-dir.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../scripts/feedback-rule-candidates.mjs');

const fp = (skillId, pr) => ({ skillId, feedbackType: 'false_positive', pr });

test('groups by (skillId, feedbackType) and applies the threshold', () => {
  const entries = [
    fp('skill-a', 10),
    fp('skill-a', 11),
    fp('skill-b', 12),
    { skillId: 'skill-a', feedbackType: 'missed_issue', pr: 13 },
  ];
  const candidates = findRuleCandidates(entries);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].skillId, 'skill-a');
  assert.equal(candidates[0].feedbackType, 'false_positive');
  assert.deepEqual(candidates[0].prs, [10, 11]);
  assert.match(candidates[0].suggestedAction, /guard fixture/);
});

test('accepted feedback and malformed entries are ignored', () => {
  const entries = [
    { skillId: 'skill-a', feedbackType: 'accepted', pr: 1 },
    { skillId: 'skill-a', feedbackType: 'accepted', pr: 2 },
    { feedbackType: 'false_positive' },
    { skillId: 'skill-b' },
  ];
  assert.deepEqual(findRuleCandidates(entries), []);
});

test('custom threshold and count-descending ordering', () => {
  const entries = [
    fp('skill-a', 1),
    fp('skill-a', 2),
    fp('skill-a', 3),
    { skillId: 'skill-b', feedbackType: 'accepted_risk', pr: 4 },
    { skillId: 'skill-b', feedbackType: 'accepted_risk', pr: 5 },
  ];
  const candidates = findRuleCandidates(entries, { min: 2 });
  assert.deepEqual(
    candidates.map((c) => [c.skillId, c.count]),
    [
      ['skill-a', 3],
      ['skill-b', 2],
    ]
  );
  assert.match(candidates[1].suggestedAction, /rules\.md/);
  assert.equal(findRuleCandidates(entries, { min: 3 }).length, 1);
});

// --out artifact output (#1471 増分B): buildCandidatesArtifact wraps the same
// per-candidate shape already used by --json stdout, plus metadata so a
// future CI artifact / improvement-flow consumer has a stable contract.
test('buildCandidatesArtifact wraps candidates with generatedAt/threshold/entries metadata', () => {
  const entries = [fp('skill-a', 10), fp('skill-a', 11)];
  const candidates = findRuleCandidates(entries, { min: 2 });
  const now = new Date('2026-07-11T00:00:00.000Z');
  const artifact = buildCandidatesArtifact({
    entriesCount: entries.length,
    min: 2,
    candidates,
    now,
  });
  assert.deepEqual(artifact, {
    generatedAt: '2026-07-11T00:00:00.000Z',
    threshold: 2,
    entries: 2,
    candidates: [
      {
        skillId: 'skill-a',
        feedbackType: 'false_positive',
        count: 2,
        prs: [10, 11],
        suggestedAction: candidates[0].suggestedAction,
      },
    ],
  });
});

test('buildCandidatesArtifact preserves the minimal per-candidate shape when there are no candidates', () => {
  const artifact = buildCandidatesArtifact({ entriesCount: 0, min: 2, candidates: [] });
  assert.deepEqual(artifact.candidates, []);
  assert.equal(artifact.entries, 0);
  assert.equal(artifact.threshold, 2);
  assert.match(artifact.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('writeCandidatesArtifact writes structured JSON to disk, creating parent directories', async () => {
  const dir = await createTempDirAsync({ prefix: 'feedback-rule-out-' });
  try {
    const outPath = path.join(dir, 'nested', 'promotion-candidates.json');
    const payload = buildCandidatesArtifact({
      entriesCount: 3,
      min: 2,
      candidates: findRuleCandidates([fp('skill-a', 1), fp('skill-a', 2)], { min: 2 }),
      now: new Date('2026-07-11T00:00:00.000Z'),
    });

    await writeCandidatesArtifact(outPath, payload);

    const written = JSON.parse(await fs.readFile(outPath, 'utf8'));
    assert.deepEqual(written, payload);
    assert.equal(written.candidates.length, 1);
    assert.deepEqual(Object.keys(written.candidates[0]).sort(), [
      'count',
      'feedbackType',
      'prs',
      'skillId',
      'suggestedAction',
    ]);
  } finally {
    await cleanupTempDirAsync(dir);
  }
});

// #1568-A / #1621: promotionCandidate contract generation (Phase 1).
const NOW = new Date('2026-07-20T00:00:00.000Z');
const evEntry = (feedbackType, { pr = null, findingFingerprint = null } = {}) => ({
  skillId: 'repository-layer-boundary',
  feedbackType,
  pr,
  findingFingerprint,
});

test('buildPromotionCandidate: min>=2 recurrence produces the full auditable contract', () => {
  const pc = buildPromotionCandidate({
    skillId: 'repository-layer-boundary',
    feedbackType: 'false_positive',
    group: [
      evEntry('false_positive', { pr: 123, findingFingerprint: '0a1b2c3d4e5f6071' }),
      evEntry('false_positive', { pr: 146 }),
    ],
  });
  // All required contract fields present.
  for (const field of [
    'recurrenceCount',
    'clusterKey',
    'evidence',
    'rationale',
    'proposedTarget',
    'scope',
    'exceptions',
    'requiresHumanApproval',
    'promotionStatus',
  ]) {
    assert.ok(pc[field] !== undefined, `missing ${field}`);
  }
  assert.equal(pc.recurrenceCount, 2);
  assert.equal(pc.clusterKey, 'repository-layer-boundary::false_positive'); // (skillId, feedbackType)
  assert.equal(pc.detector, 'feedback-rule-candidates');
  assert.equal(pc.requiresHumanApproval, true);
  assert.equal(pc.promotionStatus, 'candidate'); // generation only — not approved
  assert.deepEqual(pc.proposedTarget, { kind: 'fixture', id: 'repository-layer-boundary-guard' });
  assert.deepEqual(pc.scope, { paths: [] }); // human narrows at approval
  assert.deepEqual(pc.exceptions, []);
});

test('buildPromotionCandidate: evidence carries pr, feedbackType, and nullable findingFingerprint', () => {
  const pc = buildPromotionCandidate({
    skillId: 'skill-a',
    feedbackType: 'false_positive',
    group: [
      evEntry('false_positive', { pr: 10, findingFingerprint: '0a1b2c3d4e5f6071' }),
      evEntry('false_positive', { pr: 11 }), // no fingerprint → null
    ],
  });
  assert.deepEqual(pc.evidence, [
    { pr: 10, findingFingerprint: '0a1b2c3d4e5f6071', feedbackType: 'false_positive' },
    { pr: 11, findingFingerprint: null, feedbackType: 'false_positive' },
  ]);
});

test('buildPromotionCandidateEntry: injected now drives a deterministic 90-day expiresAt', () => {
  const entry = buildPromotionCandidateEntry({
    skillId: 'skill-a',
    feedbackType: 'missed_issue',
    group: [evEntry('missed_issue', { pr: 1 }), evEntry('missed_issue', { pr: 2 })],
    now: NOW,
  });
  assert.equal(entry.type, 'promotion_candidate');
  assert.equal(entry.status, 'active');
  assert.equal(entry.metadata.createdAt, '2026-07-20T00:00:00.000Z');
  assert.equal(entry.expiresAt, '2026-10-18T00:00:00.000Z'); // NOW + 90 days
  assert.equal(DEFAULT_EXPIRY_DAYS, 90);
});

test('buildPromotionCandidateEntry: expiresInDays overrides the default', () => {
  const entry = buildPromotionCandidateEntry({
    skillId: 'skill-a',
    feedbackType: 'false_positive',
    group: [evEntry('false_positive'), evEntry('false_positive')],
    now: NOW,
    expiresInDays: 30,
  });
  assert.equal(entry.expiresAt, '2026-08-19T00:00:00.000Z'); // NOW + 30 days
});

test('buildPromotionCandidates: only recurring (>=min) classes become candidates, sorted by recurrence', () => {
  const entries = [
    evEntry('false_positive', { pr: 1 }),
    evEntry('false_positive', { pr: 2 }),
    evEntry('false_positive', { pr: 3 }),
    { skillId: 'skill-b', feedbackType: 'missed_issue', pr: 4 },
    { skillId: 'skill-b', feedbackType: 'missed_issue', pr: 5 },
    { skillId: 'skill-c', feedbackType: 'unclear', pr: 6 }, // singleton → dropped
    { skillId: 'skill-a', feedbackType: 'accepted', pr: 7 }, // positive → dropped
    { skillId: 'skill-a', feedbackType: 'accepted', pr: 8 },
  ];
  const built = buildPromotionCandidates(entries, { now: NOW });
  assert.equal(built.length, 2);
  assert.deepEqual(
    built.map((e) => e.context.promotionCandidate.recurrenceCount),
    [3, 2]
  );
  assert.equal(
    built[0].context.promotionCandidate.clusterKey,
    'repository-layer-boundary::false_positive'
  );
});

test('CLI: --out with an invalid path reports a clean error and exits 1 instead of crashing', async () => {
  // A blocking file at the parent path makes fs.mkdir(..., {recursive:true})
  // fail with ENOTDIR/EEXIST — exercising the writeCandidatesArtifact
  // try/catch in the direct-run block (gemini-code-assist review on #1492).
  const dir = await createTempDirAsync({ prefix: 'feedback-rule-out-err-' });
  try {
    const blockerPath = path.join(dir, 'blocker');
    await fs.writeFile(blockerPath, 'not a directory', 'utf8');
    const outPath = path.join(blockerPath, 'out.json');

    const result = spawnSync(process.execPath, [SCRIPT, '--month', '1999-01', '--out', outPath], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Error: Failed to write artifact to/);
    assert.doesNotMatch(result.stderr, /at (Object\.|writeFile|async)/); // no raw Node stack trace
  } finally {
    await cleanupTempDirAsync(dir);
  }
});
