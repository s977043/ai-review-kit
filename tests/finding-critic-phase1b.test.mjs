/**
 * Deterministic pins for the #1978 Phase 1b fixture set
 * (tests/fixtures/1978-phase1b/fixtures.json).
 *
 * WHAT THIS FILE CAN AND CANNOT MEASURE
 * -------------------------------------
 * The 11 fixtures here were deferred from Phase 1a because deciding them needs
 * a real LLM turn. That is true of the GENERATION half only. Once the LLM turn
 * is fixed as text — which is exactly what the fixture file stores — the
 * transition it drives through `src/lib/finding-critic.mjs` is deterministic and
 * is pinned below. So this file pins "given this Critic/Reviewer transcript, the
 * protocol lands here", and says nothing about whether a real model would emit
 * that transcript. The latter is Phase 2 and needs an API key this repository
 * deliberately does not have (docs/development/1978-phase0-gap-analysis.md § 7).
 *
 * Fixture 7 is the case where the two halves come apart: a well-formed mutual
 * hallucination reaches `confirmed` by design, and only the pre-registered
 * golden label disagrees. That gap is pinned as a gap, not papered over.
 *
 * No behaviour of src/lib/finding-critic.mjs is changed by this file.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASK_RELEVANCE,
  CRITIC_VERDICT,
  FAILSAFE_REASON,
  FINAL_STATUS,
  buildValidatedFinding,
  evaluateExchange,
  isCleanOutcome,
  isCriticEvidenceGrounded,
  parseCriticResponse,
  parseReviewerResponse,
  partitionByAskRelevance,
  preVerifyFinding,
} from '../src/lib/finding-critic.mjs';
import { verifyFinding } from '../src/lib/verifier.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(here, 'fixtures', '1978-phase1b', 'fixtures.json');
/** @type {any} */
const SET = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

/** The 11 #1978 fixture numbers Phase 1a deferred. */
const DEFERRED = [1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 17];

const ROUTING_KEYS = new Set([
  'revisionInstructions',
  'humanReviewCandidates',
  'followUpNotes',
  'dropped',
]);

/** @param {string} id */
function caseOf(id) {
  const found = SET.cases.find((/** @type {any} */ c) => c.caseId === id);
  assert.ok(found, `fixture ${id} is missing from the set`);
  return found;
}

/** @param {any} c */
function diffOf(c) {
  const lines = SET.diffs[c.diff];
  assert.ok(Array.isArray(lines), `diff ${c.diff} is not declared`);
  return lines.join('\n');
}

/** Replay the fixture's first (and only) exchange through the state machine. */
function replay(c, { deterministic, criticOverride, reviewerOverride } = {}) {
  const exchange = c.transcript.exchanges[0];
  const critic = criticOverride === undefined ? exchange.critic : { payload: criticOverride };
  const reviewer = reviewerOverride === undefined ? exchange.reviewer : reviewerOverride;
  return evaluateExchange({
    critic,
    reviewer,
    deterministic: deterministic ?? { verified: true },
    diff: diffOf(c),
  });
}

/** @param {any} c @param {any} result */
function routeOf(c, result, finding = c.candidateFinding) {
  const routed = partitionByAskRelevance([{ finding, result }]);
  const hit = [...ROUTING_KEYS].filter((k) => routed[k].length > 0);
  assert.equal(hit.length, 1, `expected exactly one routing bucket, got ${hit.join(', ')}`);
  return { bucket: hit[0], routed };
}

// ---------------------------------------------------------------------------
// The fixture file itself is a contract: shape, coverage, vocabulary
// ---------------------------------------------------------------------------

describe('the Phase 1b fixture set is well formed', () => {
  test('every deferred #1978 fixture number is covered', () => {
    const covered = [...new Set(SET.cases.map((/** @type {any} */ c) => c.issueFixture))].sort(
      (a, b) => a - b
    );
    assert.deepEqual(covered, DEFERRED);
  });

  test('case ids are unique and every declared diff exists', () => {
    const ids = SET.cases.map((/** @type {any} */ c) => c.caseId);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of SET.cases) assert.ok(SET.diffs[c.diff], `${c.caseId} cites an unknown diff`);
  });

  test('every case carries a human golden label decided before any LLM run', () => {
    for (const c of SET.cases) {
      assert.ok(c.golden?.label, `${c.caseId} has no golden label`);
      assert.match(c.golden.assignedBy, /before any LLM run/u);
      assert.ok(c.golden.rationale.length > 40, `${c.caseId} golden rationale is too thin`);
    }
  });

  test('every case states how it is graded, and never grades on the LLM saying so', () => {
    for (const c of SET.cases) {
      assert.ok(Array.isArray(c.grading?.rubric) && c.grading.rubric.length >= 2, c.caseId);
      for (const rule of c.grading.rubric) {
        assert.ok(rule.method && rule.pass && rule.fail, `${c.caseId} ${rule.id} is incomplete`);
      }
      assert.ok(Array.isArray(c.grading.llmDependent) && c.grading.llmDependent.length >= 1);
    }
  });

  test('expected states use the vocabulary the module actually exports', () => {
    const finalStatuses = new Set(Object.values(FINAL_STATUS));
    const relevances = new Set(Object.values(ASK_RELEVANCE));
    const verdicts = new Set(Object.values(CRITIC_VERDICT));
    for (const c of SET.cases) {
      assert.ok(
        finalStatuses.has(c.expected.finalStatus),
        `${c.caseId}: ${c.expected.finalStatus}`
      );
      assert.ok(relevances.has(c.expected.critic.askRelevance), c.caseId);
      assert.ok(verdicts.has(c.expected.critic.verdict), c.caseId);
      assert.ok(ROUTING_KEYS.has(c.expected.routing), c.caseId);
      // `not-confirmed` is the one golden value that is deliberately NOT a
      // FINAL_STATUS: fixture 7's golden says "anything but confirmed".
      assert.ok(
        finalStatuses.has(c.golden.finalStatus) || c.golden.finalStatus === 'not-confirmed',
        `${c.caseId}: ${c.golden.finalStatus}`
      );
    }
  });

  test('no transcript uses the issue draft spellings the module refuses to alias', () => {
    for (const c of SET.cases) {
      const wire = JSON.stringify(c.transcript);
      for (const spelling of ['IN_SCOPE', 'SCOPE_UNCERTAIN', 'OUT_OF_SCOPE', 'IN_ASK']) {
        assert.equal(
          wire.includes(spelling),
          false,
          `${c.caseId} uses ${spelling}; Phase 1a normalizes it to uncertain on purpose`
        );
      }
      assert.match(c.transcript.exchanges[0].critic.payload.ask_relevance, /^[a-z]+(-[a-z]+)*$/u);
    }
  });
});

// ---------------------------------------------------------------------------
// Table-driven replay: the transition each fixture's fixed transcript drives
// ---------------------------------------------------------------------------

describe('replaying each fixture transcript through the Phase 1a state machine', () => {
  for (const c of SET.cases) {
    test(`${c.caseId} (#1978 fixture ${c.issueFixture}) reaches ${c.expected.finalStatus}`, () => {
      const diff = diffOf(c);
      const pre = preVerifyFinding({
        finding: c.candidateFinding,
        diff,
        skill: SET.defaultSkill,
      });
      assert.equal(pre.verified, c.expected.deterministic.verified, `${c.caseId} pre-verification`);
      assert.equal(pre.sendToCritic, c.expected.deterministic.sendToCritic);

      const result = replay(c);
      assert.equal(result.status, c.expected.finalStatus);
      assert.equal(result.humanReview, c.expected.humanReview);
      assert.equal(result.retainFinding, c.expected.retainFinding);
      assert.equal(result.askRelevance, c.expected.critic.askRelevance);
      if (c.expected.reasonIncludes) {
        assert.ok(
          result.reasons.includes(c.expected.reasonIncludes),
          `${c.caseId} reasons: ${result.reasons.join(', ')}`
        );
      }
      const { bucket } = routeOf(c, result);
      assert.equal(bucket, c.expected.routing);
    });
  }

  test('every fixture keeps the finding visible unless a reviewer withdrew it', () => {
    for (const c of SET.cases) {
      const result = replay(c);
      const withdrawn = c.expected.reviewer?.action === 'WITHDRAW';
      assert.equal(
        isCleanOutcome(result),
        withdrawn,
        `${c.caseId}: only an explicit reviewer withdrawal may end clean`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture 1 — AGREE confirms only on top of deterministic verification
// ---------------------------------------------------------------------------

describe('fixture 1: real bug, Critic AGREE', () => {
  const c = caseOf('RR-1978-F01');

  test('the same AGREE without deterministic verification does not confirm', () => {
    const result = replay(c, { deterministic: { verified: false } });
    assert.equal(result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
    assert.ok(result.reasons.includes(FAILSAFE_REASON.AGREEMENT_WITHOUT_EVIDENCE));
    assert.equal(isCleanOutcome(result), false);
  });
});

// ---------------------------------------------------------------------------
// Fixture 3 — a grounded dismissal, and the same dismissal ungrounded
// ---------------------------------------------------------------------------

describe('fixture 3: Critic refutes a false positive with code', () => {
  const c = caseOf('RR-1978-F03');
  const diff = diffOf(c);

  test('the citation is grounded by the deterministic path, not by its prose', () => {
    const parsed = parseCriticResponse(c.transcript.exchanges[0].critic.payload);
    assert.equal(parsed.ok, true);
    assert.equal(isCriticEvidenceGrounded(parsed.response.evidence, diff), true);
  });

  test('a dismissal citing a file outside the diff escalates instead of dropping', () => {
    const result = replay(c, {
      criticOverride: {
        ...c.transcript.exchanges[0].critic.payload,
        evidence: [{ artifact: 'src/lib/imaginary.mjs', observation: 'the guard lives here' }],
      },
    });
    assert.equal(result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
    assert.ok(result.reasons.includes(FAILSAFE_REASON.DETERMINISTIC_CONTRADICTION));
    assert.equal(result.retainFinding, true);
  });

  test('the false positive is dropped, never turned into a revision instruction', () => {
    const { routed } = routeOf(c, replay(c));
    assert.equal(routed.revisionInstructions.length, 0);
    assert.equal(routed.dropped.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Fixture 4 — a bare concern does not resolve anything by itself
// ---------------------------------------------------------------------------

describe('fixture 4: concern answered with evidence', () => {
  const c = caseOf('RR-1978-F04');

  test('the concern alone leaves the finding open, it does not dismiss it', () => {
    const result = replay(c, { reviewerOverride: null });
    assert.equal(result.terminal, false);
    assert.equal(result.retainFinding, true);
    assert.equal(isCleanOutcome(result), false);
  });

  test('the reviewer turn is accepted only because it carries a citation', () => {
    const turn = c.transcript.exchanges[0].reviewer;
    assert.equal(parseReviewerResponse(turn).ok, true);
    assert.equal(parseReviewerResponse({ ...turn, evidence: [] }).ok, false);
  });
});

// ---------------------------------------------------------------------------
// Fixture 5 — the two endings of an unanswerable concern
// ---------------------------------------------------------------------------

describe('fixture 5: concern the reviewer cannot answer', () => {
  test('a withdrawal against a concern is not spelled as an evidence dismissal', () => {
    const result = replay(caseOf('RR-1978-F05a'));
    assert.equal(result.status, FINAL_STATUS.WITHDRAWN_BY_REVIEWER);
    assert.notEqual(result.status, FINAL_STATUS.DISMISSED_BY_EVIDENCE);
  });

  test('insisting without a citation escalates and names the reason', () => {
    const c = caseOf('RR-1978-F05b');
    const result = replay(c);
    assert.equal(result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
    assert.ok(result.reasons.includes(FAILSAFE_REASON.KEEP_WITHOUT_EVIDENCE));
    assert.equal(isCleanOutcome(result), false);
    const { routed } = routeOf(c, result);
    assert.equal(routed.revisionInstructions.length, 0);
    assert.equal(routed.humanReviewCandidates.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Fixture 6 — a Critic-proposed finding gets no privileged path
// ---------------------------------------------------------------------------

describe('fixture 6: Critic adds a finding the Reviewer missed', () => {
  const c = caseOf('RR-1978-F06');
  const diff = diffOf(c);

  test('the proposed finding is pre-verified by the same deterministic path', () => {
    const pre = preVerifyFinding({
      finding: c.criticProposedFinding,
      diff,
      skill: SET.defaultSkill,
    });
    assert.equal(pre.verified, c.expected.criticProposedFindingDeterministic.verified);
    assert.deepEqual(
      pre.reasons,
      verifyFinding({ finding: c.criticProposedFinding, diff, skill: SET.defaultSkill }).reasons
    );
  });

  test('a proposed finding citing a file outside the diff is rejected like any other', () => {
    const fabricated = {
      ...c.criticProposedFinding,
      message: c.criticProposedFinding.message.replace(
        'src/lib/pagination.mjs',
        'src/lib/nonexistent.mjs'
      ),
    };
    const pre = preVerifyFinding({ finding: fabricated, diff, skill: SET.defaultSkill });
    assert.equal(pre.verified, false);
    assert.equal(pre.sendToCritic, false);
    assert.equal(pre.status, FINAL_STATUS.DISMISSED_HALLUCINATION);
  });

  test('the state machine has no origin-dependent branch', () => {
    const withOrigin = evaluateExchange({
      critic: {
        payload: { ...c.transcript.exchanges[0].critic.payload, origin: 'critic' },
      },
      deterministic: { verified: true },
      diff,
    });
    assert.deepEqual(withOrigin, replay(c));
  });

  test('missed_findings is not yet surfaced by the parser (documented Phase 1b gap)', () => {
    const parsed = parseCriticResponse(c.transcript.exchanges[0].critic.payload);
    assert.equal(parsed.ok, true);
    assert.equal(
      'missedFindings' in parsed.response,
      false,
      'if this starts failing, route the proposed finding through preVerifyFinding before anything else'
    );
    assert.match(c.knownGap, /preVerifyFinding/u);
  });
});

// ---------------------------------------------------------------------------
// Fixture 7 — the limitation, pinned as a limitation
// ---------------------------------------------------------------------------

describe('fixture 7: confident mutual error', () => {
  const c = caseOf('RR-1978-F07');

  test('the deterministic layer accepts a well-formed false positive', () => {
    const pre = preVerifyFinding({
      finding: c.candidateFinding,
      diff: diffOf(c),
      skill: SET.defaultSkill,
    });
    assert.equal(
      pre.verified,
      true,
      'well formed and grounded — the verifier has no basis to stop it'
    );
  });

  test('the protocol still reaches confirmed, so the golden label is the only signal', () => {
    const result = replay(c);
    assert.equal(result.status, FINAL_STATUS.CONFIRMED);
    assert.notEqual(
      result.status,
      c.golden.finalStatus,
      'this mismatch IS the measurement; it is a false positive the state machine cannot detect'
    );
  });

  test('an in-ask variant of the same false consensus reaches revision instructions', () => {
    const result = replay(c, {
      criticOverride: {
        ...c.transcript.exchanges[0].critic.payload,
        ask_relevance: 'in-ask',
      },
    });
    const { routed } = routeOf(c, result);
    assert.equal(
      routed.revisionInstructions.length,
      1,
      'no deterministic gate stands between a confident mutual error and the caller'
    );
  });

  test('extra agreeing reviewers move neither severity nor status', () => {
    const result = replay(c);
    const alone = buildValidatedFinding(c.candidateFinding, result);
    const crowded = buildValidatedFinding(
      { ...c.candidateFinding, agreement: ['r1', 'r2', 'r3'] },
      result
    );
    assert.equal(crowded.agreementCount, 3);
    assert.equal(crowded.severity, alone.severity);
    assert.deepEqual(crowded.validation, alone.validation);
  });
});

// ---------------------------------------------------------------------------
// Fixture 9 — severity survives, and the out-of-ask kill switch is visible
// ---------------------------------------------------------------------------

describe('fixture 9: evidence-backed security critical', () => {
  const c = caseOf('RR-1978-F09');

  test('severity is copied through the protocol unchanged', () => {
    const record = buildValidatedFinding(c.candidateFinding, replay(c));
    assert.equal(record.severity, 'critical');
    assert.equal(record.severity, c.golden.severityMustNotDrop);
  });

  test('the same critical finding, called out-of-ask, is parked with no human notice', () => {
    const variant = c.adversarialVariant;
    const result = replay(c, {
      criticOverride: {
        ...c.transcript.exchanges[0].critic.payload,
        ask_relevance: 'out-of-ask',
      },
    });
    assert.equal(result.status, variant.expected.finalStatus);
    assert.equal(result.humanReview, variant.expected.humanReview);
    assert.equal(result.retainFinding, true, 'parked, not deleted');
    const { routed } = routeOf(c, result);
    assert.equal(routed.followUpNotes.length, 1);
    assert.equal(routed.revisionInstructions.length, 0);
    assert.equal(
      routed.followUpNotes[0].severity,
      'critical',
      'a critical finding can be parked by one actor; Phase 1a §6 records this on purpose'
    );
  });
});

// ---------------------------------------------------------------------------
// Fixture 11 — no ending of a plausible concern reaches the implementer
// ---------------------------------------------------------------------------

describe('fixture 11: plausible concern must not become a refactor instruction', () => {
  const c = caseOf('RR-1978-F11');
  const base = c.transcript.exchanges[0].critic.payload;

  const endings = [
    ['out-of-ask, parked', { ...base }, undefined, 'followUpNotes'],
    [
      'uncertain, human',
      { ...base, ask_relevance: 'uncertain' },
      undefined,
      'humanReviewCandidates',
    ],
    [
      'reviewer withdraws',
      { ...base, ask_relevance: 'in-ask' },
      { action: 'WITHDRAW', response_to: 'DISAGREE_CONCERN' },
      'dropped',
    ],
  ];

  for (const [label, criticOverride, reviewerOverride, expectedBucket] of endings) {
    test(`${label}: the refactor proposal never becomes a revision instruction`, () => {
      const result = replay(c, { criticOverride, reviewerOverride });
      const { bucket, routed } = routeOf(c, result, c.criticProposedFinding);
      assert.equal(routed.revisionInstructions.length, 0);
      assert.equal(bucket, expectedBucket);
    });
  }
});

// ---------------------------------------------------------------------------
// Fixture 12 — an undecidable relevance says so
// ---------------------------------------------------------------------------

describe('fixture 12: the original ask is missing', () => {
  const c = caseOf('RR-1978-F12');

  test('the escalation carries the ask-relevance reason code', () => {
    const result = replay(c);
    assert.equal(result.humanReview, true);
    assert.ok(result.reasons.includes(FAILSAFE_REASON.ASK_RELEVANCE_UNCERTAIN));
  });

  test('a missing relevance field falls back to uncertain, never to in-ask', () => {
    const { ask_relevance: _dropped, ...withoutRelevance } =
      c.transcript.exchanges[0].critic.payload;
    const result = replay(c, { criticOverride: withoutRelevance });
    assert.equal(result.askRelevance, ASK_RELEVANCE.UNCERTAIN);
    const { routed } = routeOf(c, result);
    assert.equal(routed.revisionInstructions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Fixture 17 — the protocol is artifact-kind agnostic
// ---------------------------------------------------------------------------

describe('fixture 17: the same protocol over a plan artifact', () => {
  const plan = caseOf('RR-1978-F17');
  const code = caseOf('RR-1978-F01');

  test('a plan case and a code case with the same transcript shape land identically', () => {
    const planResult = replay(plan);
    const codeResult = replay(code);
    assert.deepEqual(
      {
        status: planResult.status,
        humanReview: planResult.humanReview,
        retainFinding: planResult.retainFinding,
        askRelevance: planResult.askRelevance,
      },
      {
        status: codeResult.status,
        humanReview: codeResult.humanReview,
        retainFinding: codeResult.retainFinding,
        askRelevance: codeResult.askRelevance,
      }
    );
    assert.equal(plan.artifactKind, 'plan');
  });

  test('grounding works on a document path and still fails closed on a fabricated one', () => {
    const diff = diffOf(plan);
    assert.equal(
      isCriticEvidenceGrounded([{ artifact: 'docs/plans/2101-export-plan.md' }], diff),
      true
    );
    assert.equal(isCriticEvidenceGrounded([{ artifact: 'docs/plans/nope.md' }], diff), false);
    assert.equal(isCriticEvidenceGrounded([{ artifact: 'the export plan' }], diff), false);
  });
});
