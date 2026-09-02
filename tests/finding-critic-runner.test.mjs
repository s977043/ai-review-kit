/**
 * End-to-end wiring pin for src/lib/finding-critic-runner.mjs (#1978).
 *
 * WHAT THIS FILE MEASURES
 * -----------------------
 * tests/finding-critic-phase1b.test.mjs pins the state machine by calling
 * `evaluateExchange` / `partitionByAskRelevance` DIRECTLY with the fixture
 * transcript. That leaves the wiring between them uncovered: prompt build →
 * LLM call boundary → parse → loop → routing. A break anywhere in that path
 * (swallowing the parsed response, never asking for the Reviewer turn, routing
 * the wrong record) would not move a single assertion in that file.
 *
 * This file closes that gap by driving the SAME fixtures through
 * `runFindingCritic`, with a `callImpl` stub that serves the fixture's
 * `transcript.exchanges[].critic.payload` as JSON TEXT — the shape a real
 * chat-completion boundary returns. No API key, no network, so it runs on
 * every CI leg.
 *
 * It does NOT measure whether a real model would emit that transcript. That is
 * Phase 2 and needs a key this repository deliberately does not have.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FINAL_STATUS } from '../src/lib/finding-critic.mjs';
import {
  CRITIC_TURN,
  partitionRunnerResults,
  runFindingCritic,
} from '../src/lib/finding-critic-runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(here, 'fixtures', '1978-phase1b', 'fixtures.json');
/** @type {any} */
const SET = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

const ROUTING_KEYS = ['revisionInstructions', 'humanReviewCandidates', 'followUpNotes', 'dropped'];

/** @param {any} c */
function diffOf(c) {
  return SET.diffs[c.diff].join('\n');
}

/**
 * A `callImpl` that replays the fixture transcript as raw JSON text, and
 * records every turn it was asked for.
 * @param {any} c
 */
function stubFor(c, calls = []) {
  return async ({ role, round, prompt, systemMessage }) => {
    assert.ok(typeof prompt === 'string' && prompt.length > 0, 'prompt must be built');
    assert.ok(typeof systemMessage === 'string' && systemMessage.length > 0);
    calls.push({ role, round, prompt });
    const exchange = c.transcript.exchanges[round - 1];
    if (!exchange) return null;
    if (role === CRITIC_TURN.CRITIC) return JSON.stringify(exchange.critic.payload);
    // The fixture only carries a Reviewer turn for the cases that need one;
    // `null` is the honest "the Reviewer did not answer" signal.
    return exchange.reviewer === undefined ? null : JSON.stringify(exchange.reviewer);
  };
}

/** @param {any} run */
function bucketOf(run) {
  const hit = ROUTING_KEYS.filter((k) => run.routed[k].length > 0);
  assert.equal(
    hit.length,
    1,
    `expected exactly one routing bucket, got ${hit.join(', ') || 'none'}`
  );
  return hit[0];
}

/** @param {any} c */
function runCase(c, overrides = {}) {
  const calls = [];
  return runFindingCritic({
    finding: c.candidateFinding,
    diff: diffOf(c),
    originalAsk: c.originalAsk,
    acceptanceCriteria: c.acceptanceCriteria,
    skill: SET.defaultSkill,
    callImpl: stubFor(c, calls),
    ...overrides,
  }).then((run) => ({ run, calls }));
}

describe('runFindingCritic reproduces every Phase 1b fixture end to end', () => {
  for (const c of SET.cases) {
    test(`${c.caseId}: ${c.title}`, async () => {
      const { run } = await runCase(c);

      assert.equal(
        run.deterministic.verified,
        c.expected.deterministic.verified,
        'deterministic pre-verification disagrees with the fixture'
      );
      assert.equal(run.deterministic.sendToCritic, c.expected.deterministic.sendToCritic);
      assert.equal(run.result.status, c.expected.finalStatus, 'terminal status');
      assert.equal(run.result.humanReview, c.expected.humanReview, 'humanReview');
      assert.equal(run.result.retainFinding, c.expected.retainFinding, 'retainFinding');
      assert.equal(run.result.askRelevance, c.expected.critic.askRelevance, 'askRelevance');
      assert.equal(bucketOf(run), c.expected.routing, 'routing bucket');

      // The routed record is the finding's own, not a placeholder.
      const record = run.routed[c.expected.routing][0];
      assert.equal(record.id, c.candidateFinding.id);
      assert.equal(record.validation.finalStatus, c.expected.finalStatus);
    });
  }

  test('every case in the set was exercised', () => {
    assert.equal(SET.cases.length, 12);
  });
});

describe('the wiring asks for exactly the turns the protocol needs', () => {
  for (const c of SET.cases) {
    const needsReviewer = c.expected.reviewer !== null && c.expected.reviewer !== undefined;
    test(`${c.caseId} ${needsReviewer ? 'asks' : 'does not ask'} for a Reviewer turn`, async () => {
      const { calls } = await runCase(c);
      const reviewerTurns = calls.filter((t) => t.role === CRITIC_TURN.REVIEWER);
      assert.equal(reviewerTurns.length > 0, needsReviewer);
      assert.ok(
        calls.some((t) => t.role === CRITIC_TURN.CRITIC),
        'a Critic turn is always requested when the finding is sent to the Critic'
      );
    });
  }

  test('the Critic prompt carries the finding, the ask, and the diff', async () => {
    const c = SET.cases[0];
    const { calls } = await runCase(c);
    const criticPrompt = calls.find((t) => t.role === CRITIC_TURN.CRITIC).prompt;
    assert.ok(criticPrompt.includes(c.candidateFinding.id), 'finding id is missing');
    assert.ok(criticPrompt.includes(c.originalAsk), 'original ask is missing');
    assert.ok(criticPrompt.includes(c.acceptanceCriteria[0]), 'acceptance criteria are missing');
    assert.ok(criticPrompt.includes(diffOf(c).split('\n')[0]), 'diff is missing');
  });

  test('the Reviewer prompt carries the Critic response it must answer', async () => {
    const c = SET.cases.find((x) => x.caseId === 'RR-1978-F04');
    const { calls } = await runCase(c);
    const reviewerPrompt = calls.find((t) => t.role === CRITIC_TURN.REVIEWER).prompt;
    assert.ok(reviewerPrompt.includes(c.transcript.exchanges[0].critic.payload.verdict));
  });
});

describe('call-boundary failures reach the state machine as fail-safes', () => {
  test('a thrown call is escalated, never silently cleaned', async () => {
    const c = SET.cases[0];
    const { run } = await runCase(c, {
      callImpl: async () => {
        throw new Error('connection reset');
      },
    });
    assert.equal(run.result.status, FINAL_STATUS.CRITIC_TIMEOUT);
    assert.equal(run.result.humanReview, true);
    assert.equal(run.result.retainFinding, true);
    assert.equal(bucketOf(run), 'humanReviewCandidates');
  });

  test('an unparseable Critic answer is escalated', async () => {
    const c = SET.cases[0];
    const { run } = await runCase(c, { callImpl: async () => 'not json at all' });
    assert.equal(run.result.status, FINAL_STATUS.NEEDS_HUMAN_JUDGMENT);
    assert.equal(run.result.humanReview, true);
    assert.equal(run.result.retainFinding, true);
  });
});

describe('deterministic pre-verification short-circuits the Critic', () => {
  test('a hallucinated finding is dropped without any LLM call', async () => {
    const c = SET.cases[0];
    let called = 0;
    const run = await runFindingCritic({
      finding: { id: 'RR-F-999', severity: 'major', message: 'Finding: nothing here' },
      diff: diffOf(c),
      skill: SET.defaultSkill,
      callImpl: async () => {
        called += 1;
        return '{}';
      },
    });
    assert.equal(
      called,
      0,
      'the Critic must not be called for a finding that failed pre-verification'
    );
    assert.equal(run.deterministic.sendToCritic, false);
    assert.equal(run.exchanges.length, 0);
    assert.ok(
      [FINAL_STATUS.DISMISSED_HALLUCINATION, FINAL_STATUS.DISMISSED_BY_EVIDENCE].includes(
        run.result.status
      ),
      `unexpected status ${run.result.status}`
    );
  });
});

describe('trace and batch routing', () => {
  test('the prompt kept in the trace is redacted', async () => {
    const c = SET.cases[0];
    const secret = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
    const { run } = await runCase(c, { originalAsk: `${c.originalAsk} token=${secret}` });
    const criticTrace = run.trace.find((t) => t.role === CRITIC_TURN.CRITIC);
    assert.ok(criticTrace, 'the Critic turn is missing from the trace');
    assert.ok(!criticTrace.promptPreview.includes(secret), 'the trace leaked a secret');
  });

  test('partitionRunnerResults routes a batch the same way as a single run', async () => {
    const runs = [];
    for (const c of SET.cases) {
      const { run } = await runCase(c);
      runs.push(run);
    }
    const routed = partitionRunnerResults(runs);
    const total = ROUTING_KEYS.reduce((n, k) => n + routed[k].length, 0);
    assert.equal(total, SET.cases.length);
    for (const key of ROUTING_KEYS) {
      const expected = SET.cases.filter((c) => c.expected.routing === key).length;
      assert.equal(routed[key].length, expected, `${key} count`);
    }
  });
});
