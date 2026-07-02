/**
 * LLM adjudicator for human-approval candidates (#1348 S1, Epic #1347).
 *
 * Provides the `adjudicator` callback consumed by `adjudicateHumanApproval`
 * (./human-approval-policy.mjs). The adjudicator answers ONE narrow question:
 * "do the LOW-confidence regex candidates in this plan describe an operation
 * that needs human approval before an AI agent executes it?"
 *
 * Design constraints (Epic #1347 design principles):
 *   - Escalation-only: the boolean returned here can only ADD a human-approval
 *     requirement. `adjudicateHumanApproval` ORs it with the HIGH-confidence
 *     regex verdict, so this module can never loosen the gate.
 *   - Regex-only fallback: when no LLM is available (offline mode, no
 *     OpenAI-compatible key) `createHumanApprovalAdjudicator` returns `null`
 *     and callers keep the pre-#1348 regex-only behavior unchanged.
 *   - Fail-safe: any runtime failure (HTTP error, timeout, unparseable output)
 *     throws; `adjudicateHumanApproval` catches it and degrades to the
 *     regex verdict (`mode: 'regex-fallback'`).
 */

import { isLlmEnabled } from '../utils.mjs';

const ADJUDICATOR_TIMEOUT_MS = 15000;
const ADJUDICATOR_MAX_TOKENS = 8;
const MAX_TEXT_CHARS = 4000;

const SYSTEM_MESSAGE =
  'You are the safety adjudicator of an AI code-review gate. ' +
  'You decide whether a plan needs human approval before an AI agent executes it. ' +
  'Answer with exactly one word: YES or NO.';

/**
 * Build the adjudication prompt from regex candidates + plan text.
 * Exported for unit testing.
 *
 * @param {object} opts
 * @param {Array<{trigger: string, snippet: string, confidence: string}>} opts.candidates
 * @param {string} opts.text
 * @param {string} [opts.artifactKind]
 * @returns {string}
 */
export function buildAdjudicationPrompt({ candidates = [], text = '', artifactKind = '' } = {}) {
  const body =
    String(text).length > MAX_TEXT_CHARS
      ? `${String(text).slice(0, MAX_TEXT_CHARS)}\n...[truncated]`
      : String(text);
  const candidateLines = candidates
    .map((c) => `- trigger=${c.trigger} confidence=${c.confidence} snippet="${c.snippet}"`)
    .join('\n');
  return `An automated regex scan of an implementation plan (artifact kind: ${
    artifactKind || 'unknown'
  }) found these candidate risk keywords:

${candidateLines || '- (no candidates)'}

Plan text:
---
${body}
---

Question: does this plan describe an operation that requires HUMAN APPROVAL before an AI agent executes it autonomously? Approval is required for: production / live-environment impact, destructive or irreversible changes (including euphemistic phrasings), secret or credential handling, permission changes, billing, or externally visible side effects (posting, notifications, scheduled jobs with external impact).

Answer with exactly one word: YES (approval required) or NO (safe to proceed).`;
}

/**
 * Parse the adjudicator model output into a boolean verdict.
 * Exported for unit testing.
 *
 * @param {string} output
 * @returns {boolean}
 * @throws {Error} when the output is neither YES nor NO — callers
 *   (adjudicateHumanApproval) treat this as adjudicator failure and fall
 *   back to the regex verdict.
 */
export function parseAdjudicationVerdict(output) {
  const head = String(output ?? '')
    .trim()
    .split(/\s/)[0]
    ?.toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (head === 'YES') return true;
  if (head === 'NO') return false;
  throw new Error(`Unparseable adjudicator verdict: "${String(output ?? '').slice(0, 80)}"`);
}

/**
 * Create the default LLM adjudicator, or `null` when no LLM is usable.
 *
 * `null` is the documented "regex-only mode" sentinel: callers pass it as
 * `adjudicator` to `adjudicateHumanApproval`, which then behaves exactly as
 * before #1348 (backward compatible). Only the OpenAI-compatible chat
 * endpoint is supported here — the same env contract as review-engine.mjs
 * (`RIVER_OPENAI_API_KEY` / `OPENAI_API_KEY`, `RIVER_OPENAI_BASE_URL`,
 * `RIVER_OPENAI_MODEL` / `OPENAI_MODEL`). Other providers fall back to
 * regex-only rather than guessing an incompatible API shape.
 *
 * @param {object} [opts]
 * @param {object} [opts.config] - loaded river config (config.model.modelName used as model fallback)
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchImpl] - injectable for tests
 * @returns {((candidates: object[], text: string, artifactKind: string) => Promise<boolean>)|null}
 */
export function createHumanApprovalAdjudicator({
  config = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!isLlmEnabled()) return null;
  const apiKey = env.RIVER_OPENAI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null; // only OpenAI-compatible endpoints are wired here
  const model =
    env.RIVER_OPENAI_MODEL || env.OPENAI_MODEL || config?.model?.modelName || 'gpt-4o-mini';
  const endpoint = env.RIVER_OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';

  return async function humanApprovalAdjudicator(candidates, text, artifactKind) {
    const prompt = buildAdjudicationPrompt({ candidates, text, artifactKind });
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(ADJUDICATOR_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: ADJUDICATOR_MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`Human-approval adjudicator HTTP ${res.status}`);
    }
    const json = await res.json();
    const output = json?.choices?.[0]?.message?.content ?? '';
    return parseAdjudicationVerdict(output);
  };
}
