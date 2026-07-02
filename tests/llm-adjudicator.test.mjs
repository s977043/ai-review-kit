// tests/llm-adjudicator.test.mjs
//
// LLM adjudicator for human-approval candidates (#1348 S1, Epic #1347):
// availability gating (regex-only fallback when no LLM), prompt shape,
// verdict parsing, and the OpenAI-compatible call contract.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createHumanApprovalAdjudicator,
  buildAdjudicationPrompt,
  parseAdjudicationVerdict,
} from '../src/lib/plan-review/llm-adjudicator.mjs';

const ENV_KEYS = [
  'RIVER_OFFLINE',
  'RIVER_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY',
  'RIVER_ANTHROPIC_API_KEY',
  'RIVER_OPENAI_MODEL',
  'OPENAI_MODEL',
  'RIVER_OPENAI_BASE_URL',
];

describe('createHumanApprovalAdjudicator — availability gating', () => {
  let saved;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns null when no LLM key is configured (regex-only mode)', () => {
    assert.equal(createHumanApprovalAdjudicator(), null);
  });

  it('returns null in offline mode even with a key (ADR-002 rules-only)', () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.RIVER_OFFLINE = '1';
    assert.equal(createHumanApprovalAdjudicator(), null);
  });

  it('returns null when only a non-OpenAI-compatible key exists', () => {
    process.env.ANTHROPIC_API_KEY = 'ak-something';
    assert.equal(createHumanApprovalAdjudicator(), null);
  });

  it('returns a function when an OpenAI-compatible key is configured', () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    assert.equal(typeof createHumanApprovalAdjudicator(), 'function');
  });

  it('adjudicator posts to the endpoint and parses a YES verdict', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.RIVER_OPENAI_BASE_URL = 'https://example.test/v1/chat/completions';
    let captured = null;
    const fetchImpl = async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'YES' } }] }),
      };
    };
    const adjudicator = createHumanApprovalAdjudicator({ fetchImpl });
    const verdict = await adjudicator(
      [{ trigger: 'cron', snippet: 'register cron entry', confidence: 'low' }],
      'Register a cron entry that posts to the customer webhook',
      'plan'
    );
    assert.equal(verdict, true);
    assert.equal(captured.url, 'https://example.test/v1/chat/completions');
    assert.equal(captured.body.temperature, 0);
    assert.match(captured.body.messages[1].content, /trigger=cron/);
    assert.match(captured.body.messages[1].content, /artifact kind: plan/);
    assert.equal(captured.headers.Authorization, 'Bearer sk-test-key');
  });

  it('adjudicator throws on non-2xx so the policy layer can fall back', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const adjudicator = createHumanApprovalAdjudicator({ fetchImpl });
    await assert.rejects(() => adjudicator([], 'text', 'plan'), /HTTP 500/);
  });
});

describe('buildAdjudicationPrompt', () => {
  it('includes candidates, artifact kind, and the plan text', () => {
    const prompt = buildAdjudicationPrompt({
      candidates: [{ trigger: 'auth', snippet: 'modify auth flow', confidence: 'low' }],
      text: 'Modify auth flow for SSO',
      artifactKind: 'pbi-input',
    });
    assert.match(prompt, /trigger=auth/);
    assert.match(prompt, /artifact kind: pbi-input/);
    assert.match(prompt, /Modify auth flow for SSO/);
    assert.match(prompt, /YES/);
  });

  it('truncates oversized plan text', () => {
    const prompt = buildAdjudicationPrompt({ candidates: [], text: 'x'.repeat(10000) });
    assert.match(prompt, /\[truncated\]/);
    assert.ok(prompt.length < 10000);
  });
});

describe('parseAdjudicationVerdict', () => {
  it('parses YES / NO (case-insensitive, tolerant of trailing text)', () => {
    assert.equal(parseAdjudicationVerdict('YES'), true);
    assert.equal(parseAdjudicationVerdict('yes'), true);
    assert.equal(parseAdjudicationVerdict('  YES. Approval is required'), true);
    assert.equal(parseAdjudicationVerdict('NO'), false);
    assert.equal(parseAdjudicationVerdict('No, this is safe'), false);
  });

  it('throws on unparseable output (policy layer treats as failure)', () => {
    assert.throws(() => parseAdjudicationVerdict('MAYBE'), /Unparseable/);
    assert.throws(() => parseAdjudicationVerdict(''), /Unparseable/);
    assert.throws(() => parseAdjudicationVerdict(null), /Unparseable/);
  });
});
