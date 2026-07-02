# Recall variants (S3 #1350 PR-A)

Vocabulary / word-order / language variants of dangerous-plan phrasings, used
to measure the **regex tier's recall** as a number instead of a claim.

**Not held-out**: these files live in the repository and are readable by the
agent under review, so the measured value is a reference number that can be
overfit (Goodhart). Treat it as a ratchet floor, not an absolute recall claim.
The adjudicator (LLM) tier's recall is eval territory and is NOT measured here.

Rules (enforced by `tests/plan-review-recall-variants.test.mjs`):

- every variant without `expectedMiss: true` must fire a HIGH candidate,
- `expectedMiss` entries must carry a `reason` (documented recall debt —
  usually a deliberate precision tradeoff),
- the variant count has a lower bound so variants cannot be deleted to make
  the suite pass. Weakening a variant or annotating a new `expectedMiss` is a
  reviewed decision, not a quick fix.
