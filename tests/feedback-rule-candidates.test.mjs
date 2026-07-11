import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';

import {
  findRuleCandidates,
  buildCandidatesArtifact,
  writeCandidatesArtifact,
} from '../scripts/feedback-rule-candidates.mjs';
import { createTempDirAsync, cleanupTempDirAsync } from './helpers/temp-dir.mjs';

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
