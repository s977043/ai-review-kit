// Ensures schemas/riverbed-index.schema.json matches what src/lib/riverbed-memory.mjs writes.
// If the index schema drifts from the v1 implementation again (see #563/#565), this test catches it.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { loadMemory, appendEntry, supersede, expireEntries } from '../src/lib/riverbed-memory.mjs';
import {
  buildPromotionCandidateEntry,
  buildPromotionCandidates,
} from '../scripts/feedback-rule-candidates.mjs';
import { createTempMemory, makeMemoryEntry } from './helpers/memory.mjs';
import { compileRiverbedIndexValidator } from './helpers/schema-validator.mjs';

const wrapIndex = (entries) => ({ version: '1', entries });
const fpEntry = (fingerprint, pr) => ({
  skillId: 'repository-layer-boundary',
  feedbackType: 'false_positive',
  findingFingerprint: fingerprint,
  pr,
});

// Compiled once at module scope (ajv compile is expensive, schemas are
// static). strict mode stays on so future schema typos surface here; the
// riverbed-entry $ref wiring lives in the shared helper.
const validate = compileRiverbedIndexValidator();

describe('riverbed-index.schema.json', () => {
  test('empty index from loadMemory conforms to schema', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-idx-' });
    try {
      const mem = loadMemory(indexPath);
      assert.equal(validate(mem), true, JSON.stringify(validate.errors, null, 2));
    } finally {
      cleanup();
    }
  });

  test('index after appendEntry conforms to schema', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-idx-' });
    try {
      appendEntry(indexPath, makeMemoryEntry({ type: 'review' }));
      appendEntry(indexPath, makeMemoryEntry({ type: 'wontfix' }));
      const mem = loadMemory(indexPath);
      assert.equal(validate(mem), true, JSON.stringify(validate.errors, null, 2));
      assert.equal(mem.entries.length, 2);
    } finally {
      cleanup();
    }
  });

  test('index after supersede conforms to schema', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-idx-' });
    try {
      const oldEntry = makeMemoryEntry({ id: 'old-1' });
      const newEntry = makeMemoryEntry({ id: 'new-1' });
      appendEntry(indexPath, oldEntry);
      appendEntry(indexPath, newEntry);
      supersede(indexPath, 'old-1', 'new-1');
      const mem = loadMemory(indexPath);
      assert.equal(validate(mem), true, JSON.stringify(validate.errors, null, 2));
      const superseded = mem.entries.find((e) => e.id === 'old-1');
      assert.equal(superseded.status, 'superseded');
      assert.equal(superseded.supersededBy, 'new-1');
    } finally {
      cleanup();
    }
  });

  test('index after expireEntries conforms to schema', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-idx-' });
    try {
      appendEntry(
        indexPath,
        makeMemoryEntry({ id: 'expired-1', expiresAt: '2020-01-01T00:00:00Z' })
      );
      appendEntry(indexPath, makeMemoryEntry({ id: 'active-1' }));
      expireEntries(indexPath);
      const mem = loadMemory(indexPath);
      assert.equal(validate(mem), true, JSON.stringify(validate.errors, null, 2));
      assert.equal(mem.entries.find((e) => e.id === 'expired-1').status, 'archived');
    } finally {
      cleanup();
    }
  });

  test('missing version field is rejected', () => {
    assert.equal(validate({ entries: [] }), false);
  });

  test('extra top-level property is rejected', () => {
    assert.equal(validate({ version: '1', entries: [], unexpected: true }), false);
  });
});

// #1568-A / #1621: promotion_candidate additive type + structured contract.
describe('riverbed-entry.schema.json: promotion_candidate (#1621)', () => {
  const now = new Date('2026-07-20T00:00:00.000Z');

  test('a built promotion_candidate entry conforms to schema (auditable fields on JSON)', () => {
    const entry = buildPromotionCandidateEntry({
      skillId: 'repository-layer-boundary',
      feedbackType: 'false_positive',
      group: [fpEntry('0a1b2c3d4e5f6071', 123), fpEntry(null, 146)],
      now,
    });
    assert.equal(validate(wrapIndex([entry])), true, JSON.stringify(validate.errors, null, 2));
    const pc = entry.context.promotionCandidate;
    // Auditable contract fields are present on the persisted JSON.
    for (const field of ['rationale', 'scope', 'exceptions', 'evidence', 'proposedTarget']) {
      assert.ok(pc[field] !== undefined, `missing ${field}`);
    }
    assert.equal(entry.type, 'promotion_candidate');
    assert.equal(entry.expiresAt, '2026-10-18T00:00:00.000Z'); // now + 90 days
    assert.equal(pc.promotionStatus, 'candidate');
    // findingFingerprint is nullable in Phase 1.
    assert.equal(pc.evidence[1].findingFingerprint, null);
  });

  test('missing context.promotionCandidate is rejected for promotion_candidate type', () => {
    const bad = {
      id: 'RR-PC-x',
      type: 'promotion_candidate',
      content: 'x',
      status: 'active',
      expiresAt: '2026-10-18T00:00:00.000Z',
      context: {},
      metadata: { createdAt: now.toISOString(), author: 'test' },
    };
    assert.equal(validate(wrapIndex([bad])), false);
  });

  test('missing expiresAt is rejected for promotion_candidate type', () => {
    const entry = buildPromotionCandidateEntry({
      skillId: 'skill-a',
      feedbackType: 'false_positive',
      group: [fpEntry(null, 1), fpEntry(null, 2)],
      now,
    });
    delete entry.expiresAt;
    assert.equal(validate(wrapIndex([entry])), false);
  });

  test('invalid promotionStatus value is rejected', () => {
    const entry = buildPromotionCandidateEntry({
      skillId: 'skill-a',
      feedbackType: 'false_positive',
      group: [fpEntry(null, 1), fpEntry(null, 2)],
      now,
    });
    entry.context.promotionCandidate.promotionStatus = 'bogus';
    assert.equal(validate(wrapIndex([entry])), false);
  });

  test('malformed findingFingerprint (not 16 hex) is rejected', () => {
    const entry = buildPromotionCandidateEntry({
      skillId: 'skill-a',
      feedbackType: 'false_positive',
      group: [fpEntry(null, 1), fpEntry(null, 2)],
      now,
    });
    entry.context.promotionCandidate.evidence[0].findingFingerprint = 'ZZZ';
    assert.equal(validate(wrapIndex([entry])), false);
  });

  test('existing entry types remain valid (additive change is non-breaking)', () => {
    const entries = [makeMemoryEntry({ type: 'review' }), makeMemoryEntry({ type: 'decision' })];
    assert.equal(validate(wrapIndex(entries)), true, JSON.stringify(validate.errors, null, 2));
  });

  test('buildPromotionCandidates entries append into a Riverbed index that conforms to schema', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-pc-' });
    try {
      const built = buildPromotionCandidates(
        [fpEntry('0a1b2c3d4e5f6071', 1), fpEntry(null, 2), fpEntry(null, 3)],
        { now }
      );
      assert.equal(built.length, 1);
      for (const entry of built) appendEntry(indexPath, entry);
      const mem = loadMemory(indexPath);
      assert.equal(validate(mem), true, JSON.stringify(validate.errors, null, 2));
      assert.equal(mem.entries[0].context.promotionCandidate.recurrenceCount, 3);
    } finally {
      cleanup();
    }
  });
});
