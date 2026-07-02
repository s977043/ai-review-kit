/**
 * Regex-tier recall measurement over vocabulary/word-order/language variants
 * (S3 #1350 PR-A). Complements the canary suite: canaries pin known-good
 * detections at 100% (regression guard), while this suite measures recall
 * against phrasings the patterns were NOT written from, as a ratcheted floor.
 *
 * Gaming resistance: minimum variant count, mandatory `reason` on every
 * expectedMiss, and all non-expectedMiss variants must HIT (adding a new
 * missing variant forces either a pattern improvement or a reviewed
 * expectedMiss annotation — not a threshold tweak).
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectHumanApprovalCandidates } from '../src/lib/plan-review/human-approval-policy.mjs';

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'plan-review',
  'recall-variants'
);
const MIN_VARIANTS = 10;
const MAX_EXPECTED_MISSES = 3; // documented recall debt must stay bounded

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();
const variants = files.map((f) => ({
  file: f,
  ...JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')),
}));

describe('plan-review regex-tier recall variants (S3 #1350)', () => {
  test(`suite has at least ${MIN_VARIANTS} variants (deletion resistance)`, () => {
    assert.ok(variants.length >= MIN_VARIANTS, `found ${variants.length}`);
  });

  test('every expectedMiss documents its reason (bounded recall debt)', () => {
    const misses = variants.filter((v) => v.expectedMiss === true);
    assert.ok(misses.length <= MAX_EXPECTED_MISSES, `${misses.length} expected misses`);
    for (const v of misses) {
      assert.ok(
        typeof v.reason === 'string' && v.reason.length > 20,
        `${v.file}: expectedMiss requires a substantive reason`
      );
    }
  });

  let hits = 0;
  const eligible = variants.filter((v) => v.expectedMiss !== true);
  for (const v of eligible) {
    test(`${v.file}: fires a HIGH candidate (${v.category})`, () => {
      const highs = detectHumanApprovalCandidates(v.text).candidates.filter(
        (c) => c.confidence === 'high'
      );
      if (highs.length > 0) hits += 1;
      assert.ok(highs.length > 0, `no HIGH candidate for: ${v.text}`);
    });
  }

  after(() => {
    // Reference number (includes documented misses in the denominator).
    const rate = Math.round((hits / variants.length) * 1000) / 10;
    console.log(
      `plan-review regex-tier recall (reference, overfit-able): ${hits}/${variants.length} (${rate}%)` +
        ` — expected misses: ${variants.length - eligible.length}`
    );
  });
});
