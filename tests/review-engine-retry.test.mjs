/**
 * Tests for LLM-call retry policy helpers in review-engine.mjs.
 *
 * Adopted from the Gemma concurrent demo review: the orchestrator→parallel→merge
 * pattern already exists (Promise.allSettled in reviewer-orchestrator); retry on
 * transient LLM failures was the one gap. These cover the pure decision/backoff
 * helpers so a 429/503/timeout retries instead of silently dropping a reviewer's
 * findings.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isRetryableStatus,
  isRetryableNetworkError,
  computeBackoffMs,
} from '../src/lib/review-engine.mjs';

describe('isRetryableStatus', () => {
  test('retries rate-limit and transient server/gateway errors', () => {
    for (const s of [429, 500, 502, 503, 504])
      assert.equal(isRetryableStatus(s), true, `status ${s}`);
  });

  test('does not retry client errors or success', () => {
    for (const s of [200, 400, 401, 403, 404, 422])
      assert.equal(isRetryableStatus(s), false, `status ${s}`);
  });
});

describe('isRetryableNetworkError', () => {
  test('retries timeouts and aborts', () => {
    assert.equal(isRetryableNetworkError({ name: 'TimeoutError' }), true);
    assert.equal(isRetryableNetworkError({ name: 'AbortError' }), true);
  });

  test('retries connection-level errors by code/message', () => {
    assert.equal(isRetryableNetworkError({ message: 'fetch failed' }), true);
    assert.equal(isRetryableNetworkError({ code: 'ECONNRESET', message: 'socket' }), true);
    assert.equal(isRetryableNetworkError({ message: 'getaddrinfo EAI_AGAIN api' }), true);
  });

  test('does not retry unrelated errors / null', () => {
    assert.equal(isRetryableNetworkError(null), false);
    assert.equal(isRetryableNetworkError({ message: 'invalid JSON' }), false);
  });
});

describe('computeBackoffMs', () => {
  test('exponential backoff by attempt', () => {
    assert.equal(computeBackoffMs(1, { baseMs: 500 }), 500);
    assert.equal(computeBackoffMs(2, { baseMs: 500 }), 1000);
    assert.equal(computeBackoffMs(3, { baseMs: 500 }), 2000);
  });

  test('honors Retry-After seconds when present', () => {
    assert.equal(computeBackoffMs(1, { retryAfterSec: '2' }), 2000);
    assert.equal(computeBackoffMs(5, { retryAfterSec: 0 }), 0);
  });

  test('falls back to exponential when Retry-After is invalid', () => {
    assert.equal(computeBackoffMs(2, { baseMs: 100, retryAfterSec: 'abc' }), 200);
    assert.equal(computeBackoffMs(2, { baseMs: 100, retryAfterSec: null }), 200);
  });
});
