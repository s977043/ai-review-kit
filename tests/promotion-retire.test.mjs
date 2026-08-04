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
const feedback = ({
  skillId,
  feedbackType = 'accepted',
  timestamp,
  reversedBy,
  findingFingerprint = null,
}) => {
  const e = { timestamp, trigger: 'pr-comment', feedbackType, skillId, findingFingerprint };
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

  // #1756: archiving a candidate discards it, so an expiresAt that Date cannot
  // parse must not trigger it, and the append-only trail must not record an
  // expiry that never happened.
  test('unparseable expiresAt: no archive, no lifecycle record, flagged instead', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, '2026-07-21T00:00:00.000Z');
    entry.expiresAt = 'notadate'; // hand-edited / external writer
    const after = new Date('2026-10-20T00:00:00.000Z');

    const plan = planPromotionRetire(entry, { now: after });
    assert.equal(plan.unparseableExpiresAt, true);
    assert.equal(plan.willExpire, false);
    assert.equal(plan.willChange, false);
    assert.equal(plan.statusSync, null);

    const res = applyPromotionRetire(entry, { now: after });
    assert.equal(res.changed, false);
    assert.equal(res.unparseableExpiresAt, true);
    assert.equal(entry.status, 'active');
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'approved');
    assert.equal(entry.context.lifecycleHistory, undefined);
  });

  test('unparseable expiresAt on a superseded entry: syncs without claiming expiry', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, '2026-07-21T00:00:00.000Z');
    entry.expiresAt = 'notadate';
    entry.status = 'superseded';
    entry.supersededBy = 'RR-PC-new';
    const res = applyPromotionRetire(entry, { now: new Date('2026-10-20T00:00:00.000Z') });
    assert.equal(res.changed, true);
    assert.equal(res.willExpire, false);
    // Not flagged: expiry never applied to a superseded entry, so there was no
    // archive to skip and nothing truthful to warn about.
    assert.equal(res.unparseableExpiresAt, false);
    assert.equal(entry.status, 'superseded');
    // The audit reason states what actually happened, never "expiresAt reached".
    assert.equal(entry.context.lifecycleHistory[0].reason, 'promotionStatus sync');
  });

  // #1756 follow-up: the flag drives a user-facing warning that says the expiry
  // archive was "skipped". That is only true for an entry the expiry applies to.
  test('unparseableExpiresAt is flagged for ACTIVE entries only', () => {
    const at = new Date('2026-10-20T00:00:00.000Z');
    const statuses = { active: true, archived: false, superseded: false };
    for (const [entryStatus, expected] of Object.entries(statuses)) {
      const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
      entry.expiresAt = 'notadate';
      entry.status = entryStatus;
      assert.equal(
        planPromotionRetire(entry, { now: at }).unparseableExpiresAt,
        expected,
        `status=${entryStatus}`
      );
    }
    // status omitted entirely defaults to active, so it is flagged.
    const noStatus = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    noStatus.expiresAt = 'notadate';
    delete noStatus.status;
    assert.equal(planPromotionRetire(noStatus, { now: at }).unparseableExpiresAt, true);
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
      assert.deepEqual(out.warnings, []);
    } finally {
      cleanup();
    }
  });

  // #1756 regression: the reproduction from the issue — a hand-edited index
  // whose candidate carries expiresAt "notadate". Before the fix this archived
  // the candidate and wrote `reason: "expiresAt reached"` into the audit trail.
  test('unparseable expiresAt is reported, not archived', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-retire-bad-' });
    try {
      const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
      entry.expiresAt = 'notadate';
      appendEntry(indexPath, entry);

      const out = retirePromotions({ indexPath, now: new Date('2026-10-20T00:00:00.000Z') });
      assert.equal(out.count, 0);
      assert.equal(out.warnings.length, 1);
      assert.match(out.warnings[0], /notadate/);

      const reloaded = loadMemory(indexPath).entries.find((e) => e.id === entry.id);
      assert.equal(reloaded.status, 'active');
      assert.equal(reloaded.context.promotionCandidate.promotionStatus, 'candidate');
      assert.equal(reloaded.context.lifecycleHistory, undefined);
      // The advice has to be executable: propose is idempotent on the content
      // hash, so "re-issue the candidate" would not repair anything.
      assert.doesNotMatch(out.warnings[0], /re-issue/);
    } finally {
      cleanup();
    }
  });

  // #1756 follow-up: only a candidate the expiry would have archived belongs in
  // warnings, and repeated runs must not accumulate untrue ones.
  test('warnings cover ACTIVE candidates only and stay stable across runs', () => {
    const { cleanup, indexPath } = createTempMemory({ layout: 'flat', prefix: 'rr-retire-mix-' });
    try {
      const active = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
      active.id = 'cand-active-bad';
      active.expiresAt = 'notadate';

      const archived = makeCandidate('skill-b', 'missed_issue', [fp(3), fp(4)]);
      archived.id = 'cand-archived-bad';
      archived.expiresAt = 'notadate';
      archived.status = 'archived';
      archived.context.promotionCandidate.promotionStatus = 'archived';

      const superseded = makeCandidate('skill-c', 'false_positive', [fp(5), fp(6)]);
      superseded.id = 'cand-superseded-bad';
      superseded.expiresAt = 'notadate';
      superseded.status = 'superseded';

      appendEntry(indexPath, active);
      appendEntry(indexPath, archived);
      appendEntry(indexPath, superseded);

      const at = new Date('2026-10-20T00:00:00.000Z');
      const first = retirePromotions({ indexPath, now: at });
      // The superseded candidate still syncs its promotionStatus (a real change).
      assert.equal(first.count, 1);
      assert.deepEqual(
        first.results.map((r) => r.id),
        ['cand-superseded-bad']
      );
      assert.equal(first.warnings.length, 1);
      assert.match(first.warnings[0], /cand-active-bad/);

      // Second run: no changes left, and the same single warning — not a
      // growing stream of claims about entries that were never skipped.
      const second = retirePromotions({ indexPath, now: at });
      assert.equal(second.count, 0);
      assert.deepEqual(second.warnings, first.warnings);

      const reloaded = loadMemory(indexPath).entries;
      assert.equal(reloaded.find((e) => e.id === 'cand-active-bad').status, 'active');
      assert.equal(reloaded.find((e) => e.id === 'cand-archived-bad').status, 'archived');
      assert.equal(reloaded.find((e) => e.id === 'cand-superseded-bad').status, 'superseded');
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

  test('isNegativeFeedback: cluster-scoped recurrence or skill-scoped reversal', () => {
    // Recurrence: only feedback of the cluster's own feedbackType counts.
    assert.equal(
      isNegativeFeedback({ feedbackType: 'missed_issue' }, { clusterFeedbackType: 'missed_issue' }),
      true
    );
    // A different feedbackType for the same skill is NOT a recurrence signal.
    assert.equal(
      isNegativeFeedback(
        { feedbackType: 'false_positive' },
        { clusterFeedbackType: 'missed_issue' }
      ),
      false
    );
    // Reversal crosses feedbackType boundaries (skill-scoped).
    assert.equal(
      isNegativeFeedback(
        { feedbackType: 'accepted', reversedBy: 'x' },
        { clusterFeedbackType: 'missed_issue' }
      ),
      true
    );
    assert.equal(isNegativeFeedback({ feedbackType: 'accepted' }, {}), false);
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
    assert.equal(m.feedbackType, 'false_positive');
    assert.equal(m.related, 3);
    assert.equal(m.clusterRecurrenceCount, 1);
    assert.equal(m.reversalCount, 1);
    assert.equal(m.negativeCount, 2);
  });

  // warning-1 probe: a candidate clustered on skill-x::missed_issue must NOT be
  // flagged by unrelated false_positive feedback on the same skill.
  test('recurrence is cluster-scoped: off-cluster feedbackType is not negative', () => {
    const entry = makeCandidate('skill-x', 'missed_issue', [
      { pr: 1, findingFingerprint: null, feedbackType: 'missed_issue' },
      { pr: 2, findingFingerprint: null, feedbackType: 'missed_issue' },
    ]);
    const offCluster = [
      feedback({
        skillId: 'skill-x',
        feedbackType: 'false_positive',
        timestamp: '2026-07-25T00:00:00.000Z',
      }),
      feedback({
        skillId: 'skill-x',
        feedbackType: 'false_positive',
        timestamp: '2026-07-26T00:00:00.000Z',
      }),
    ];
    const m = computeEffectivenessMetrics(entry, offCluster, { since: '2026-07-21T00:00:00.000Z' });
    assert.equal(m.feedbackType, 'missed_issue');
    assert.equal(m.related, 2); // same skill, after cutoff
    assert.equal(m.clusterRecurrenceCount, 0); // different feedbackType
    assert.equal(m.negativeCount, 0); // not over-detected
  });

  // warning-1: on-cluster recurrence IS counted.
  test('recurrence is cluster-scoped: on-cluster feedbackType counts', () => {
    const entry = makeCandidate('skill-x', 'missed_issue', [
      { pr: 1, findingFingerprint: null, feedbackType: 'missed_issue' },
      { pr: 2, findingFingerprint: null, feedbackType: 'missed_issue' },
    ]);
    const onCluster = [
      feedback({
        skillId: 'skill-x',
        feedbackType: 'missed_issue',
        timestamp: '2026-07-25T00:00:00.000Z',
      }),
      feedback({
        skillId: 'skill-x',
        feedbackType: 'missed_issue',
        timestamp: '2026-07-26T00:00:00.000Z',
      }),
    ];
    const m = computeEffectivenessMetrics(entry, onCluster, { since: '2026-07-21T00:00:00.000Z' });
    assert.equal(m.clusterRecurrenceCount, 2);
    assert.equal(m.negativeCount, 2);
  });

  // warning-2 probe: findingFingerprint dedup — same fingerprint x2 = 1 distinct.
  test('negativeCount deduplicates by findingFingerprint (same fp x2 = 1)', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    const dupFingerprint = [
      feedback({
        skillId: 'skill-a',
        feedbackType: 'false_positive',
        timestamp: '2026-07-25T00:00:00.000Z',
        findingFingerprint: 'abcdef0123456789',
      }),
      feedback({
        skillId: 'skill-a',
        feedbackType: 'false_positive',
        timestamp: '2026-07-26T00:00:00.000Z',
        findingFingerprint: 'abcdef0123456789',
      }),
    ];
    const m = computeEffectivenessMetrics(entry, dupFingerprint, {
      since: '2026-07-21T00:00:00.000Z',
    });
    assert.equal(m.clusterRecurrenceCount, 2); // raw component tally is not deduped
    assert.equal(m.negativeCount, 1); // distinct finding
  });

  // warning-2: null fingerprints fall back to per-entry counting (null x2 = 2).
  test('null findingFingerprint negatives count per entry (null x2 = 2)', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    const nullFingerprints = [
      feedback({
        skillId: 'skill-a',
        feedbackType: 'false_positive',
        timestamp: '2026-07-25T00:00:00.000Z',
        findingFingerprint: null,
      }),
      feedback({
        skillId: 'skill-a',
        feedbackType: 'false_positive',
        timestamp: '2026-07-26T00:00:00.000Z',
        findingFingerprint: null,
      }),
    ];
    const m = computeEffectivenessMetrics(entry, nullFingerprints, {
      since: '2026-07-21T00:00:00.000Z',
    });
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

// warning-3: needs_review is not a dead end — re-approving revives the candidate.
describe('needs_review -> approve revival (applyPromotionDecision)', () => {
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

  test('re-approving a needs_review candidate returns it to approved and resets the cutoff', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, decidedAt);
    // An effectiveness review flags it (approval.decision stays 'approved').
    applyEffectivenessReview(entry, twoNegatives, { now: new Date('2026-07-30T00:00:00.000Z') });
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'needs_review');
    assert.equal(entry.context.approval.decision, 'approved');

    // Re-approve at a later time: NOT a silent no-op despite decision === 'approved'.
    const revivedAt = '2026-08-10T00:00:00.000Z';
    const res = applyPromotionDecision(entry, {
      decision: 'approved',
      approver: 'carol',
      reason: 'recurrence resolved',
      now: new Date(revivedAt),
    });
    assert.equal(res.changed, true);
    assert.equal(res.warning, null); // same decision, not an override
    assert.equal(entry.context.promotionCandidate.promotionStatus, 'approved'); // back in effect
    // A fresh approval record is appended and becomes the new cutoff baseline.
    assert.equal(entry.context.approvalHistory.length, 2);
    assert.equal(entry.context.approval.approver, 'carol');
    assert.equal(entry.context.approval.decidedAt, revivedAt);

    // The reset cutoff excludes the pre-revival feedback, so a re-review retains it.
    const afterRevive = applyEffectivenessReview(entry, twoNegatives, {
      now: new Date('2026-08-15T00:00:00.000Z'),
      threshold: 2,
    });
    assert.equal(afterRevive.eligible, true);
    assert.equal(afterRevive.breached, false); // old feedback is before the new decidedAt
    assert.equal(afterRevive.metrics.negativeCount, 0);
  });

  test('genuine idempotent re-approve (still approved) remains a no-op', () => {
    const entry = makeCandidate('skill-a', 'false_positive', [fp(1), fp(2)]);
    approve(entry, decidedAt);
    const res = applyPromotionDecision(entry, {
      decision: 'approved',
      approver: 'bob',
      now: new Date('2026-08-01T00:00:00.000Z'),
    });
    assert.equal(res.changed, false);
    assert.equal(entry.context.approvalHistory.length, 1);
    assert.equal(entry.context.approval.approver, 'alice');
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
