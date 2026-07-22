// Judgment Promotion Loop Phase 3 (#1568-C / #1623): retire lifecycle —
// expiresAt auto-retire + promotionStatus sync, and effectiveness review
// (post-activation false-positive / reversal signals -> needs_review).

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  applyPromotionDecision,
  planPromotionRetire,
  applyPromotionRetire,
  retirePromotions,
  skillIdFromClusterKey,
  isNegativeFeedback,
  computeEffectivenessMetrics,
  applyEffectivenessReview,
  reviewPromotionEffectiveness,
  DEFAULT_EFFECTIVENESS_THRESHOLD,
} from '../src/lib/promotion.mjs';
import { buildPromotionCandidateEntry } from '../scripts/feedback-rule-candidates.mjs';
import { loadMemory, appendEntry, supersede } from '../src/lib/riverbed-memory.mjs';
import { createTempMemory } from './helpers/memory.mjs';
import { compileRiverbedIndexValidator } from './helpers/schema-validator.mjs';

const validate = compileRiverbedIndexValidator();
const wrapIndex = (entries) => ({ version: '1', entries });
const now = new Date('2026-07-20T00:00:00.000Z'); // candidate createdAt; expiresAt = +90d
const fp = (pr) => ({ pr, findingFingerprint: null, feedbackType: 'false_positive' });

const makeCandidate = (skillId, feedbackType, group, opts = {}) =>
  buildPromotionCandidateEntry({ skillId, feedbackType, group, now, ...opts });

const approve = (entry, decidedAt) =>
  applyPromotionDecision(entry, {
    decision: 'approved',
    approver: 'alice',
    now: new Date(decidedAt),
  });

// A feedback entry (feedback.mjs shape) for a given skill / type / time.
const feedback = ({ skillId, feedbackType = 'accepted', timestamp, reversedBy }) => {
  const e = { timestamp, trigger: 'pr-comment', feedbackType, skillId, findingFingerprint: null };
  if (reversedBy) e.reversedBy = reversedBy;
  return e;
};

describe('planPromotionRetire / applyPromotionRetire', () => {
  test('expiresAt reached: archives entry and syncs promotionStatus to archived', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, '2026-07-21T00:00:00.000Z');
    // 91 days after createdAt -> past the 90-day expiresAt.
    const after = new Date('2026-10-20T00:00:00.000Z');
    const plan = planPromotionRetire(entry, { now: after });
    assert.equal(plan.willChange, true);
    assert.equal(plan.willExpire, true);
    assert.deepEqual(plan.statusSync, { from: 'approved', to: 'archived' });

    const res = applyPromotionRetire(entry, { now: after });
    assert.equal(res.changed, true);
    assert.equal(entry.status, 'archived');
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'archived');
    assert.equal(entry.context.lifecycleHistory.length, 1);
    assert.equal(entry.context.lifecycleHistory[0].event, 'retire');
    assert.equal(entry.metadata.updatedAt, after.toISOString());
    assert.equal(validate(wrapIndex([entry])), true, JSON.stringify(validate.errors, null, 2));
  });

  test('not yet expired: no change', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, '2026-07-21T00:00:00.000Z');
    const before = new Date('2026-08-01T00:00:00.000Z'); // well within 90 days
    assert.equal(planPromotionRetire(entry, { now: before }).willChange, false);
    const res = applyPromotionRetire(entry, { now: before });
    assert.equal(res.changed, false);
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'approved');
    assert.equal(entry.status, 'active');
  });

  test('boundary: expiresAt exactly equal to now retires (<=)', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    const at = new Date(entry.expiresAt);
    assert.equal(planPromotionRetire(entry, { now: at }).willExpire, true);
    // one millisecond earlier does not.
    const justBefore = new Date(at.getTime() - 1);
    assert.equal(planPromotionRetire(entry, { now: justBefore }).willExpire, false);
  });

  test('superseded entry syncs promotionStatus to superseded (no expiry)', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, '2026-07-21T00:00:00.000Z');
    entry.status = 'superseded'; // as supersede() would set at the entry level
    entry.supersededBy = 'RR-PC-new';
    const res = applyPromotionRetire(entry, { now: new Date('2026-07-25T00:00:00.000Z') });
    assert.equal(res.changed, true);
    assert.equal(res.willExpire, false);
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'superseded');
  });

  test('idempotent: a second retire finds nothing to change', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    const after = new Date('2026-10-20T00:00:00.000Z');
    applyPromotionRetire(entry, { now: after });
    const second = applyPromotionRetire(entry, { now: after });
    assert.equal(second.changed, false);
    assert.equal(entry.context.lifecycleHistory.length, 1);
  });

  test('already-terminal promotionStatus is never overwritten', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    entry.context.promotionCandidate.promotionStatus = 'archived';
    entry.status = 'superseded';
    // entry is superseded but promotionStatus already archived (terminal) -> untouched.
    const res = applyPromotionRetire(entry, { now: new Date('2026-10-20T00:00:00.000Z') });
    assert.equal(res.changed, false);
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'archived');
  });

  test('non-promotion entry is a no-op', () => {
    const other = { id: 'x', type: 'review', status: 'active', context: {} };
    assert.equal(planPromotionRetire(other, { now }).willChange, false);
    assert.equal(applyPromotionRetire(other, { now }).changed, false);
  });
});

describe('retirePromotions (persisting wrapper)', () => {
  test('archives every expired candidate and persists; idempotent', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-retire-' });
    try {
      const expired = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
      const fresh = makeCandidate('skill-b', 'missed_issue', [fp(3), fp(4)]);
      appendEntry(indexPath, expired);
      appendEntry(indexPath, fresh);
      // Supersede one at the entry level to exercise the sync-only path.
      supersede(indexPath, fresh.id, 'RR-PC-newer');

      const after = new Date('2026-10-20T00:00:00.000Z');
      const out = retirePromotions({ indexPath, now: after });
      assert.equal(out.count, 2);

      const reloaded = loadMemory(indexPath).entries;
      const a = reloaded.find((e) => e.id === expired.id);
      const b = reloaded.find((e) => e.id === fresh.id);
      assert.equal(a.status, 'archived');
      assert.equal(a.context.promotionCandidate.promotionStatus, 'archived');
      assert.equal(b.context.promotionCandidate.promotionStatus, 'superseded');

      // Second run is a no-op.
      assert.equal(retirePromotions({ indexPath, now: after }).count, 0);
    } finally {
      cleanup();
    }
  });
});

describe('effectiveness helpers', () => {
  test('skillIdFromClusterKey splits on ::', () => {
    assert.equal(skillIdFromClusterKey('repo-boundary::false_positive'), 'repo-boundary');
    assert.equal(skillIdFromClusterKey('lonely'), 'lonely');
    assert.equal(skillIdFromClusterKey(''), null);
    assert.equal(skillIdFromClusterKey(null), null);
  });

  test('isNegativeFeedback: false_positive or reversal', () => {
    assert.equal(isNegativeFeedback({ feedbackType: 'false_positive' }), true);
    assert.equal(isNegativeFeedback({ feedbackType: 'accepted', reversedBy: 'x' }), true);
    assert.equal(isNegativeFeedback({ feedbackType: 'accepted' }), false);
    assert.equal(isNegativeFeedback(null), false);
  });

  test('computeEffectivenessMetrics filters by skill and strict since cutoff', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    const feedbackEntries = [
      feedback({
        skillId: 'skill-a',
        feedbackType: 'false_positive',
        timestamp: '2026-07-25T00:00:00.000Z',
      }),
      feedback({
        skillId: 'skill-a',
        feedbackType: 'accepted',
        timestamp: '2026-07-26T00:00:00.000Z',
        reversedBy: 'pr-9',
      }),
      feedback({
        skillId: 'skill-a',
        feedbackType: 'accepted',
        timestamp: '2026-07-27T00:00:00.000Z',
      }),
      // before the cutoff -> excluded
      feedback({
        skillId: 'skill-a',
        feedbackType: 'false_positive',
        timestamp: '2026-07-01T00:00:00.000Z',
      }),
      // other skill -> excluded
      feedback({
        skillId: 'skill-b',
        feedbackType: 'false_positive',
        timestamp: '2026-07-28T00:00:00.000Z',
      }),
    ];
    const m = computeEffectivenessMetrics(entry, feedbackEntries, {
      since: '2026-07-21T00:00:00.000Z',
    });
    assert.equal(m.skillId, 'skill-a');
    assert.equal(m.related, 3);
    assert.equal(m.falsePositiveCount, 1);
    assert.equal(m.reversalCount, 1);
    assert.equal(m.negativeCount, 2);
  });
});

describe('applyEffectivenessReview', () => {
  const decidedAt = '2026-07-21T00:00:00.000Z';
  const twoNegatives = [
    feedback({
      skillId: 'skill-a',
      feedbackType: 'false_positive',
      timestamp: '2026-07-25T00:00:00.000Z',
    }),
    feedback({
      skillId: 'skill-a',
      feedbackType: 'accepted',
      timestamp: '2026-07-26T00:00:00.000Z',
      reversedBy: 'pr-9',
    }),
  ];

  test('threshold breach flips approved -> needs_review with audit record', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, decidedAt);
    const res = applyEffectivenessReview(entry, twoNegatives, {
      now: new Date('2026-07-30T00:00:00.000Z'),
      threshold: 2,
    });
    assert.equal(res.changed, true);
    assert.equal(res.breached, true);
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'needs_review');
    assert.equal(entry.context.effectivenessHistory.length, 1);
    assert.equal(entry.context.effectiveness.decision, 'needs_review');
    assert.equal(entry.status, 'active'); // entry stays live, only promotion-level flagged
    assert.equal(validate(wrapIndex([entry])), true, JSON.stringify(validate.errors, null, 2));
  });

  test('boundary: one below threshold is retained (no mutation)', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, decidedAt);
    const oneNegative = twoNegatives.slice(0, 1);
    const res = applyEffectivenessReview(entry, oneNegative, {
      now: new Date('2026-07-30T00:00:00.000Z'),
      threshold: 2,
    });
    assert.equal(res.changed, false);
    assert.equal(res.eligible, true);
    assert.equal(res.breached, false);
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'approved');
    assert.equal(entry.context.effectivenessHistory, undefined);
  });

  test('default threshold is 2', () => {
    assert.equal(DEFAULT_EFFECTIVENESS_THRESHOLD, 2);
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, decidedAt);
    const res = applyEffectivenessReview(entry, twoNegatives, {
      now: new Date('2026-07-30T00:00:00.000Z'),
    });
    assert.equal(res.breached, true);
  });

  test('idempotent: needs_review is not re-reviewed', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, decidedAt);
    applyEffectivenessReview(entry, twoNegatives, { now: new Date('2026-07-30T00:00:00.000Z') });
    const second = applyEffectivenessReview(entry, twoNegatives, {
      now: new Date('2026-08-05T00:00:00.000Z'),
    });
    assert.equal(second.changed, false);
    assert.equal(second.eligible, false);
    assert.equal(entry.context.effectivenessHistory.length, 1);
  });

  test('non-promoted (candidate) status is not eligible', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]); // status: candidate
    const res = applyEffectivenessReview(entry, twoNegatives, {
      now: new Date('2026-07-30T00:00:00.000Z'),
    });
    assert.equal(res.eligible, false);
    assert.equal(res.changed, false);
    assert.match(res.note, /not in effect/);
  });

  test('other-type feedback does not interfere', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, decidedAt);
    const benign = [
      feedback({
        skillId: 'skill-a',
        feedbackType: 'accepted',
        timestamp: '2026-07-25T00:00:00.000Z',
      }),
      feedback({
        skillId: 'skill-a',
        feedbackType: 'not_actionable',
        timestamp: '2026-07-26T00:00:00.000Z',
      }),
      feedback({
        skillId: 'skill-a',
        feedbackType: 'duplicate',
        timestamp: '2026-07-27T00:00:00.000Z',
      }),
    ];
    const res = applyEffectivenessReview(entry, benign, {
      now: new Date('2026-07-30T00:00:00.000Z'),
      threshold: 2,
    });
    assert.equal(res.metrics.negativeCount, 0);
    assert.equal(res.breached, false);
  });
});

describe('reviewPromotionEffectiveness (persisting wrapper)', () => {
  const decidedAt = '2026-07-21T00:00:00.000Z';
  const twoNegatives = [
    feedback({
      skillId: 'skill-a',
      feedbackType: 'false_positive',
      timestamp: '2026-07-25T00:00:00.000Z',
    }),
    feedback({
      skillId: 'skill-a',
      feedbackType: 'false_positive',
      timestamp: '2026-07-26T00:00:00.000Z',
    }),
  ];

  test('persists needs_review flip only for breaching candidates; idempotent', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-eff-' });
    try {
      const flagged = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
      const clean = makeCandidate('skill-b', 'missed_issue', [fp(3), fp(4)]);
      // Seed both already in the approved (in-effect) state.
      approve(flagged, decidedAt);
      approve(clean, decidedAt);
      appendEntry(indexPath, flagged);
      appendEntry(indexPath, clean);

      const out = reviewPromotionEffectiveness({
        indexPath,
        feedbackEntries: twoNegatives,
        now: new Date('2026-07-30T00:00:00.000Z'),
        threshold: 2,
      });
      assert.equal(out.count, 2);
      assert.equal(out.flagged, 1);

      const reloaded = loadMemory(indexPath).entries;
      assert.equal(
        reloaded.find((e) => e.id === flagged.id).context.promotionCandidate.promotionStatus,
        'needs_review'
      );
      assert.equal(
        reloaded.find((e) => e.id === clean.id).context.promotionCandidate.promotionStatus,
        'approved'
      );

      // Idempotent: re-running flags nothing new.
      const again = reviewPromotionEffectiveness({
        indexPath,
        feedbackEntries: twoNegatives,
        now: new Date('2026-08-05T00:00:00.000Z'),
        threshold: 2,
      });
      assert.equal(again.flagged, 0);
    } finally {
      cleanup();
    }
  });

  test('throws for an unknown id', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-eff-' });
    try {
      assert.throws(
        () =>
          reviewPromotionEffectiveness({
            indexPath,
            feedbackEntries: [],
            id: 'nope',
          }),
        /No promotion_candidate entry/
      );
    } finally {
      cleanup();
    }
  });
});
