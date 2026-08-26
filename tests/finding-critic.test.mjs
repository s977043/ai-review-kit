/**
 * Tests for src/lib/finding-critic.mjs (#1978 Phase 1a).
 *
 * Pins the 7 of the 18 required fixtures that are decidable without an LLM.
 * Fixture numbers below are #1978's own numbering.
 *
 *  2  hallucinated path        → deterministic verifier rejects, Critic never called
 *  8  multi-reviewer detection → agreement grows, severity is not voted on
 * 13  critic timeout           → not clean
 * 14  critic parse failure     → not clean
 * 15  inner loop cap reached   → human-review candidate
 * 16  critic dismissal contradicts deterministic evidence → human / fail-safe
 * 18  no routing / name collision with the `adversarial-review` skill
 *
 * The remaining 11 fixtures need real LLM responses and belong to Phase 1b;
 * see docs/development/1978-phase1a-deterministic-skeleton.md.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyFinding } from '../src/lib/verifier.mjs';
import {
  ASK_RELEVANCE,
  CRITIC_VERDICT,
  DEFAULT_MAX_INNER_ROUNDS,
  FAILSAFE_REASON,
  FINAL_STATUS,
  HARD_CAP_INNER_ROUNDS,
  MODULE_ID,
  PROTOCOL_ID,
  buildValidatedFinding,
  evaluateExchange,
  isCleanOutcome,
  parseCriticResponse,
  parseReviewerResponse,
  partitionByAskRelevance,
  preVerifyFinding,
  runValidationLoop,
} from '../src/lib/finding-critic.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A diff that really touches src/lib/real.mjs and nothing else.
const DIFF = [
  'diff --git a/src/lib/real.mjs b/src/lib/real.mjs',
  '--- a/src/lib/real.mjs',
  '+++ b/src/lib/real.mjs',
  '@@ -1,3 +1,4 @@',
  ' export function run() {',
  '+  return fetch(url);',
  ' }',
].join('\n');

const REAL_FINDING = {
  id: 'RR-F-001',
  severity: 'major',
  message:
    'Finding: unvalidated url\nEvidence: src/lib/real.mjs line 2 calls fetch(url) with no validation\nSeverity: warning\nFix: validate url against an allowlist before calling fetch',
};

const HALLUCINATED_FINDING = {
  id: 'RR-F-002',
  severity: 'critical',
  message:
    'Finding: missing auth check\nEvidence: src/lib/ghost.mjs line 40 skips the auth guard\nSeverity: blocker\nFix: add the auth guard before the handler runs',
};

const SKILL = { metadata: { phase: 'midstream', severity: 'critical' } };

// ---------------------------------------------------------------------------
// Fixture 2 — hallucinated path is rejected deterministically
// ---------------------------------------------------------------------------

describe('fixture 2: hallucinated evidence path', () => {
  test('the existing verifier rejects it (no reimplementation here)', () => {
    const result = verifyFinding({ finding: HALLUCINATED_FINDING, diff: DIFF, skill: SKILL });
    assert.equal(result.verified, false);
    assert.ok(result.reasons.includes('Evidence references file not found in diff'));
  });

  test('preVerifyFinding blocks the Critic call and reuses the verifier reasons', () => {
    const pre = preVerifyFinding({ finding: HALLUCINATED_FINDING, diff: DIFF, skill: SKILL });
    assert.equal(pre.verified, false);
    assert.equal(pre.sendToCritic, false);
    assert.equal(pre.status, FINAL_STATUS.DISMISSED_HALLUCINATION);
    assert.deepEqual(
      pre.reasons,
      verifyFinding({ finding: HALLUCINATED_FINDING, diff: DIFF, skill: SKILL }).reasons
    );
  });

  test('a grounded finding does reach the Critic', () => {
    const pre = preVerifyFinding({ finding: REAL_FINDING, diff: DIFF, skill: SKILL });
    assert.equal(pre.verified, true);
    assert.equal(pre.sendToCritic, true);
    assert.equal(pre.status, null);
  });
});

// ---------------------------------------------------------------------------
// Fixture 8 — agreement is provenance, never a vote
// ---------------------------------------------------------------------------

describe('fixture 8: multiple reviewers detect the same finding', () => {
  test('agreement count grows but severity is copied through unchanged', () => {
    const single = buildValidatedFinding(
      { id: 'RR-F-001', severity: 'minor', agreement: ['bug-hunter'] },
      {
        status: FINAL_STATUS.CONFIRMED,
        humanReview: false,
        retainFinding: true,
        reasons: [],
        rounds: 1,
        askRelevance: ASK_RELEVANCE.IN_ASK,
      }
    );
    const many = buildValidatedFinding(
      {
        id: 'RR-F-001',
        severity: 'minor',
        agreement: ['bug-hunter', 'security-scanner', 'test-gap'],
      },
      {
        status: FINAL_STATUS.CONFIRMED,
        humanReview: false,
        retainFinding: true,
        reasons: [],
        rounds: 1,
        askRelevance: ASK_RELEVANCE.IN_ASK,
      }
    );
    assert.equal(single.agreementCount, 1);
    assert.equal(many.agreementCount, 3);
    assert.equal(single.severity, 'minor');
    assert.equal(many.severity, 'minor', 'severity must not rise with agreement count');
    assert.equal(single.validation.finalStatus, many.validation.finalStatus);
  });

  test('the exchange verdict does not depend on agreement count', () => {
    const critic = {
      payload: { verdict: CRITIC_VERDICT.AGREE, ask_relevance: ASK_RELEVANCE.IN_ASK },
    };
    const one = evaluateExchange({ critic, deterministic: { verified: true }, diff: DIFF });
    const three = evaluateExchange({ critic, deterministic: { verified: true }, diff: DIFF });
    assert.equal(one.status, three.status);
    assert.equal(one.status, FINAL_STATUS.CONFIRMED);
  });

  test('agreement without deterministic evidence does not confirm', () => {
    const result = evaluateExchange({
      critic: { payload: { verdict: CRITIC_VERDICT.AGREE, ask_relevance: ASK_RELEVANCE.IN_ASK } },
      deterministic: { verified: false },
      diff: DIFF,
    });
    assert.equal(result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
    assert.ok(result.reasons.includes(FAILSAFE_REASON.AGREEMENT_WITHOUT_EVIDENCE));
    assert.equal(isCleanOutcome(result), false);
  });
});

// ---------------------------------------------------------------------------
// Fixture 13 — critic timeout must not read as clean
// ---------------------------------------------------------------------------

describe('fixture 13: critic timeout', () => {
  for (const kind of ['timeout', 'error']) {
    test(`kind=${kind} retains the finding and escalates`, () => {
      const result = evaluateExchange({
        critic: { kind },
        deterministic: { verified: true },
        diff: DIFF,
      });
      assert.equal(result.status, FINAL_STATUS.CRITIC_TIMEOUT);
      assert.equal(result.retainFinding, true, 'a silent Critic must not drop the finding');
      assert.equal(result.humanReview, true);
      assert.equal(isCleanOutcome(result), false);
      assert.notEqual(result.status, FINAL_STATUS.CONFIRMED);
    });
  }

  test('a timed-out finding is routed to human review, not to revision instructions', () => {
    const result = evaluateExchange({
      critic: { kind: 'timeout' },
      deterministic: { verified: true },
    });
    const routed = partitionByAskRelevance([{ finding: REAL_FINDING, result }]);
    assert.equal(routed.revisionInstructions.length, 0);
    assert.equal(routed.humanReviewCandidates.length, 1);
    assert.equal(routed.dropped.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Fixture 14 — parse failure must not read as clean
// ---------------------------------------------------------------------------

describe('fixture 14: critic parse failure', () => {
  const unparseable = [
    '',
    '   ',
    'I think this finding is probably fine, honestly.',
    '{ "verdict": ',
    { verdict: 'LGTM' },
    { verdict: 'agree_ish' },
    null,
    42,
  ];

  for (const [i, payload] of unparseable.entries()) {
    test(`payload #${i} does not parse into a verdict`, () => {
      assert.equal(parseCriticResponse(payload).ok, false);
    });

    test(`payload #${i} escalates instead of passing clean`, () => {
      const result = evaluateExchange({
        critic: { payload },
        deterministic: { verified: true },
        diff: DIFF,
      });
      assert.equal(result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
      assert.equal(result.retainFinding, true);
      assert.equal(result.humanReview, true);
      assert.equal(isCleanOutcome(result), false);
      assert.ok(result.reasons.includes(FAILSAFE_REASON.CRITIC_PARSE_FAILURE));
    });
  }

  test('a well-formed protocol block does parse', () => {
    const parsed = parseCriticResponse(
      [
        'finding_id: RR-F-001',
        'verdict: DISAGREE_EVIDENCE',
        'reason: the url is validated upstream',
        'evidence:',
        '  - artifact: src/lib/real.mjs',
        '    line_start: 1',
        '    line_end: 3',
        '    observation: validation happens in the caller',
        'ask_relevance: in-ask',
      ].join('\n')
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.response.verdict, CRITIC_VERDICT.DISAGREE_EVIDENCE);
    assert.equal(parsed.response.askRelevance, ASK_RELEVANCE.IN_ASK);
    assert.equal(parsed.response.evidence.length, 1);
    assert.equal(parsed.response.evidence[0].artifact, 'src/lib/real.mjs');
    assert.equal(parsed.response.evidence[0].lineStart, 1);
  });

  test('an unreadable ask_relevance falls back to uncertain, never to in-ask', () => {
    const parsed = parseCriticResponse({ verdict: 'AGREE', ask_relevance: 'IN_SCOPE' });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.response.askRelevance, ASK_RELEVANCE.UNCERTAIN);
  });

  test('DISAGREE_EVIDENCE without a citation is downgraded, not honoured as a dismissal', () => {
    const parsed = parseCriticResponse({ verdict: 'DISAGREE_EVIDENCE', ask_relevance: 'in-ask' });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.response.verdict, CRITIC_VERDICT.DISAGREE_CONCERN);
    assert.equal(parsed.response.downgraded, true);
  });

  test('KEEP without evidence is not a valid reviewer response', () => {
    const parsed = parseReviewerResponse({ action: 'KEEP' });
    assert.equal(parsed.ok, false);
    const result = evaluateExchange({
      critic: {
        payload: {
          verdict: 'DISAGREE_CONCERN',
          ask_relevance: 'in-ask',
        },
      },
      reviewer: { action: 'KEEP' },
      deterministic: { verified: true },
      diff: DIFF,
    });
    assert.equal(result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
    assert.ok(result.reasons.includes(FAILSAFE_REASON.KEEP_WITHOUT_EVIDENCE));
    assert.equal(isCleanOutcome(result), false);
  });
});

// ---------------------------------------------------------------------------
// Fixture 15 — inner loop cap
// ---------------------------------------------------------------------------

describe('fixture 15: inner loop cap reached', () => {
  const contested = {
    critic: {
      payload: {
        verdict: 'DISAGREE_EVIDENCE',
        ask_relevance: 'in-ask',
        evidence: [{ artifact: 'src/lib/real.mjs', observation: 'validated upstream' }],
      },
    },
    reviewer: {
      action: 'KEEP',
      evidence: [{ artifact: 'src/lib/real.mjs', observation: 'the caller does not validate' }],
    },
  };

  test('an endlessly contested finding hits the cap and escalates', () => {
    const result = runValidationLoop({
      exchanges: Array.from({ length: 10 }, () => contested),
      deterministic: { verified: true },
      diff: DIFF,
    });
    assert.equal(result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
    assert.ok(result.reasons.includes(FAILSAFE_REASON.INNER_LOOP_CAP_REACHED));
    assert.equal(result.humanReview, true);
    assert.equal(result.retainFinding, true);
    assert.equal(isCleanOutcome(result), false);
  });

  test('rounds never exceed the default max, and the default is below the hard cap', () => {
    const result = runValidationLoop({
      exchanges: Array.from({ length: 10 }, () => contested),
      deterministic: { verified: true },
      diff: DIFF,
    });
    assert.equal(result.rounds, DEFAULT_MAX_INNER_ROUNDS);
    assert.ok(DEFAULT_MAX_INNER_ROUNDS < HARD_CAP_INNER_ROUNDS);
  });

  test('maxInnerRounds is clamped to the hard cap', () => {
    const result = runValidationLoop({
      exchanges: Array.from({ length: 50 }, () => contested),
      deterministic: { verified: true },
      diff: DIFF,
      maxInnerRounds: 99,
    });
    assert.equal(result.rounds, HARD_CAP_INNER_ROUNDS);
    assert.equal(result.humanReview, true);
  });

  test('running out of exchanges before the cap is also an escalation, not a pass', () => {
    const result = runValidationLoop({
      exchanges: [],
      deterministic: { verified: true },
      diff: DIFF,
    });
    assert.equal(result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
    assert.equal(isCleanOutcome(result), false);
  });

  test('a converging loop still terminates early', () => {
    const result = runValidationLoop({
      exchanges: [
        {
          critic: {
            payload: {
              verdict: 'DISAGREE_EVIDENCE',
              ask_relevance: 'in-ask',
              evidence: [{ artifact: 'src/lib/real.mjs' }],
            },
          },
          reviewer: { action: 'WITHDRAW' },
        },
        contested,
      ],
      deterministic: { verified: true },
      diff: DIFF,
    });
    assert.equal(result.status, FINAL_STATUS.DISMISSED_BY_EVIDENCE);
    assert.equal(result.rounds, 1);
  });
});

// ---------------------------------------------------------------------------
// Fixture 16 — Critic dismissal contradicting the deterministic verifier
// ---------------------------------------------------------------------------

describe('fixture 16: critic dismissal contradicts deterministic evidence', () => {
  test('an ungrounded dismissal of a verified finding goes to a human', () => {
    const result = evaluateExchange({
      critic: {
        payload: {
          verdict: 'DISAGREE_EVIDENCE',
          ask_relevance: 'in-ask',
          reason: 'this file does not exist',
          evidence: [{ artifact: 'src/lib/ghost.mjs', observation: 'no such call' }],
        },
      },
      reviewer: { action: 'WITHDRAW' },
      deterministic: { verified: true },
      diff: DIFF,
    });
    assert.equal(result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
    assert.ok(result.reasons.includes(FAILSAFE_REASON.DETERMINISTIC_CONTRADICTION));
    assert.equal(result.retainFinding, true, 'the finding survives an ungrounded dismissal');
    assert.equal(result.humanReview, true);
    assert.equal(isCleanOutcome(result), false);
  });

  test('the contradiction check outranks the reviewer withdrawal', () => {
    const grounded = evaluateExchange({
      critic: {
        payload: {
          verdict: 'DISAGREE_EVIDENCE',
          ask_relevance: 'in-ask',
          evidence: [{ artifact: 'src/lib/real.mjs', observation: 'validated in the caller' }],
        },
      },
      reviewer: { action: 'WITHDRAW' },
      deterministic: { verified: true },
      diff: DIFF,
    });
    assert.equal(
      grounded.status,
      FINAL_STATUS.DISMISSED_BY_EVIDENCE,
      'a grounded dismissal still resolves normally'
    );
    assert.equal(grounded.retainFinding, false);
  });
});

// ---------------------------------------------------------------------------
// Fixture 18 — no routing / name collision with adversarial-review
// ---------------------------------------------------------------------------

describe('fixture 18: no name or routing collision with adversarial-review', () => {
  /** @returns {string[]} every `id:` declared in a skills/**\/SKILL.md frontmatter */
  function collectSkillIds() {
    /** @type {string[]} */
    const ids = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'SKILL.md') {
          const head = fs.readFileSync(full, 'utf8').split('\n').slice(0, 40);
          const line = head.find((l) => /^id:\s*\S/u.test(l));
          if (line) ids.push(line.replace(/^id:\s*/u, '').trim());
        }
      }
    };
    walk(path.join(repoRoot, 'skills'));
    return ids;
  }

  test('the module id collides with no existing skill id', () => {
    const ids = collectSkillIds();
    assert.ok(ids.length > 0, 'expected to find skill ids');
    assert.ok(ids.includes('adversarial-review'), 'adversarial-review must still exist');
    assert.equal(ids.includes(MODULE_ID), false, `${MODULE_ID} must not shadow a skill id`);
    assert.equal(ids.includes(PROTOCOL_ID), false);
  });

  test('this module registers no skill and no command of its own', () => {
    assert.equal(fs.existsSync(path.join(repoRoot, 'skills', MODULE_ID)), false);
    assert.equal(
      fs.existsSync(path.join(repoRoot, 'skills', 'agent-skills', MODULE_ID)),
      false,
      'Phase 1a adds no SKILL.md, so it cannot take a planner top-1 slot'
    );
  });

  test('adversarial-review keeps its artifact-facing inputContext', () => {
    const skill = fs.readFileSync(
      path.join(repoRoot, 'skills', 'agent-skills', 'adversarial-review', 'SKILL.md'),
      'utf8'
    );
    assert.match(skill, /inputContext:\s*\[diff, fullFile\]/u);
    assert.equal(
      skill.includes(PROTOCOL_ID),
      false,
      'the artifact lens must not claim the review-of-review protocol'
    );
  });

  test('the module is not wired into the CLI (integration is Phase 3)', () => {
    const cliDir = path.join(repoRoot, 'src', 'cli');
    const hits = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith('.mjs') &&
          fs.readFileSync(full, 'utf8').includes('finding-critic')
        ) {
          hits.push(full);
        }
      }
    };
    walk(cliDir);
    assert.deepEqual(hits, []);
  });
});

// ---------------------------------------------------------------------------
// askRelevance gate (supporting behaviour for the fixtures above)
// ---------------------------------------------------------------------------

describe('askRelevance gate', () => {
  test('out-of-ask is held as a follow-up note, never a revision instruction', () => {
    const result = evaluateExchange({
      critic: { payload: { verdict: 'AGREE', ask_relevance: 'out-of-ask' } },
      deterministic: { verified: true },
      diff: DIFF,
    });
    assert.equal(result.status, FINAL_STATUS.OUT_OF_ASK);
    const routed = partitionByAskRelevance([{ finding: REAL_FINDING, result }]);
    assert.equal(routed.revisionInstructions.length, 0);
    assert.equal(routed.followUpNotes.length, 1);
  });

  test('uncertain becomes a human-review candidate, not a revision instruction', () => {
    const result = evaluateExchange({
      critic: { payload: { verdict: 'AGREE', ask_relevance: 'uncertain' } },
      deterministic: { verified: true },
      diff: DIFF,
    });
    assert.equal(result.askRelevance, ASK_RELEVANCE.UNCERTAIN);
    const routed = partitionByAskRelevance([{ finding: REAL_FINDING, result }]);
    assert.equal(routed.revisionInstructions.length, 0);
    assert.equal(routed.humanReviewCandidates.length, 1);
  });

  test('in-ask and confirmed does reach revision instructions', () => {
    const result = evaluateExchange({
      critic: { payload: { verdict: 'AGREE', ask_relevance: 'in-ask' } },
      deterministic: { verified: true },
      diff: DIFF,
    });
    const routed = partitionByAskRelevance([{ finding: REAL_FINDING, result }]);
    assert.equal(routed.revisionInstructions.length, 1);
    assert.equal(routed.revisionInstructions[0].validation.protocol, PROTOCOL_ID);
  });

  test('the askRelevance vocabulary is hyphen-lowercase and disjoint from scope', () => {
    for (const value of Object.values(ASK_RELEVANCE)) {
      assert.match(value, /^[a-z]+(-[a-z]+)*$/u);
      assert.notEqual(value, 'in-diff');
      assert.notEqual(value, 'pre-existing');
    }
  });
});
