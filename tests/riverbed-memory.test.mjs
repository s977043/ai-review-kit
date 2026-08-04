import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  loadMemory,
  appendEntry,
  queryMemory,
  supersede,
  expireEntries,
  isExpired,
  hasUnparseableExpiresAt,
} from '../src/lib/riverbed-memory.mjs';
import { createTempMemory, makeMemoryEntry as makeEntry } from './helpers/memory.mjs';

const tmpIndex = () => createTempMemory({ layout: 'flat', prefix: 'rr-memory-' });

test('loadMemory: returns empty structure for missing file', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const mem = loadMemory(indexPath);
    assert.deepEqual(mem.entries, []);
    assert.equal(mem.version, '1');
  } finally {
    cleanup();
  }
});

test('loadMemory: reads existing index', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const data = { entries: [makeEntry()], version: '1' };
    fs.writeFileSync(indexPath, JSON.stringify(data));
    const mem = loadMemory(indexPath);
    assert.equal(mem.entries.length, 1);
  } finally {
    cleanup();
  }
});

test('appendEntry: creates file and adds entry', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const entry = makeEntry({ id: 'e1' });
    appendEntry(indexPath, entry);
    const mem = loadMemory(indexPath);
    assert.equal(mem.entries.length, 1);
    assert.equal(mem.entries[0].id, 'e1');
  } finally {
    cleanup();
  }
});

test('appendEntry: rejects duplicate ID', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    appendEntry(indexPath, makeEntry({ id: 'dup' }));
    assert.throws(() => appendEntry(indexPath, makeEntry({ id: 'dup' })), /Duplicate/);
  } finally {
    cleanup();
  }
});

test('appendEntry: rejects entry without required fields', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    assert.throws(() => appendEntry(indexPath, { id: 'x' }), /must have/);
  } finally {
    cleanup();
  }
});

test('queryMemory: filters by type', () => {
  const entries = [
    makeEntry({ id: 'a', type: 'adr' }),
    makeEntry({ id: 'b', type: 'review' }),
    makeEntry({ id: 'c', type: 'adr' }),
  ];
  const result = queryMemory({ entries }, { type: 'adr' });
  assert.equal(result.length, 2);
});

test('queryMemory: filters by phase', () => {
  const entries = [
    makeEntry({ id: 'a', metadata: { createdAt: '', author: '', phase: 'upstream' } }),
    makeEntry({ id: 'b', metadata: { createdAt: '', author: '', phase: 'midstream' } }),
  ];
  const result = queryMemory({ entries }, { phase: 'upstream' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'a');
});

test('queryMemory: filters by tags', () => {
  const entries = [
    makeEntry({ id: 'a', metadata: { createdAt: '', author: '', tags: ['security', 'auth'] } }),
    makeEntry({ id: 'b', metadata: { createdAt: '', author: '', tags: ['perf'] } }),
  ];
  const result = queryMemory({ entries }, { tags: ['security'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'a');
});

test('queryMemory: empty filter returns all active', () => {
  const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })];
  const result = queryMemory({ entries });
  assert.equal(result.length, 2);
});

test('queryMemory: combined filters are AND', () => {
  const entries = [
    makeEntry({
      id: 'a',
      type: 'adr',
      metadata: { createdAt: '', author: '', phase: 'upstream' },
    }),
    makeEntry({
      id: 'b',
      type: 'adr',
      metadata: { createdAt: '', author: '', phase: 'midstream' },
    }),
    makeEntry({
      id: 'c',
      type: 'review',
      metadata: { createdAt: '', author: '', phase: 'upstream' },
    }),
  ];
  const result = queryMemory({ entries }, { type: 'adr', phase: 'upstream' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'a');
});

test('queryMemory: filters out non-active by default', () => {
  const entries = [
    makeEntry({ id: 'a', status: 'active' }),
    makeEntry({ id: 'b', status: 'superseded' }),
    makeEntry({ id: 'c' }), // no status = active
  ];
  const result = queryMemory({ entries });
  assert.equal(result.length, 2);
});

test('queryMemory: includeInactive returns all', () => {
  const entries = [
    makeEntry({ id: 'a', status: 'active' }),
    makeEntry({ id: 'b', status: 'superseded' }),
    makeEntry({ id: 'c', status: 'archived' }),
  ];
  const result = queryMemory({ entries }, { includeInactive: true });
  assert.equal(result.length, 3);
});

test('supersede: marks entry as superseded', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    appendEntry(indexPath, makeEntry({ id: 'old-adr' }));
    appendEntry(indexPath, makeEntry({ id: 'new-adr' }));
    supersede(indexPath, 'old-adr', 'new-adr');
    const mem = loadMemory(indexPath);
    const old = mem.entries.find((e) => e.id === 'old-adr');
    assert.equal(old.status, 'superseded');
    assert.equal(old.supersededBy, 'new-adr');
  } finally {
    cleanup();
  }
});

test('supersede: throws for unknown id', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    appendEntry(indexPath, makeEntry({ id: 'exists' }));
    assert.throws(() => supersede(indexPath, 'missing', 'exists'), /not found/);
  } finally {
    cleanup();
  }
});

test('expireEntries: archives expired entries', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    appendEntry(indexPath, makeEntry({ id: 'expired', expiresAt: past }));
    appendEntry(indexPath, makeEntry({ id: 'valid', expiresAt: future }));
    appendEntry(indexPath, makeEntry({ id: 'no-expiry' }));
    const count = expireEntries(indexPath);
    assert.equal(count, 1);
    const mem = loadMemory(indexPath);
    assert.equal(mem.entries.find((e) => e.id === 'expired').status, 'archived');
    assert.equal(mem.entries.find((e) => e.id === 'valid').status, undefined);
  } finally {
    cleanup();
  }
});

test('isExpired: shared expiry predicate (expiresAt <= now)', () => {
  const at = new Date('2026-07-20T00:00:00.000Z');
  const opts = { onUnparseable: 'expired' };
  assert.equal(isExpired({ expiresAt: at.toISOString() }, at, opts), true); // boundary: equal
  assert.equal(isExpired({ expiresAt: at.toISOString() }, new Date(at.getTime() - 1), opts), false);
  assert.equal(isExpired({ expiresAt: at.toISOString() }, new Date(at.getTime() + 1), opts), true);
  assert.equal(isExpired({}, at, opts), false); // no expiresAt
});

// #1756: the answer for an unparseable expiresAt belongs to the caller, because
// "expired" means "stops taking effect" on the read side and "gets archived"
// (a discard, for a promotion_candidate) on the write side.
test('isExpired: onUnparseable selects the direction for a malformed timestamp', () => {
  const now = new Date('2026-07-20T00:00:00.000Z');
  const bad = { expiresAt: 'notadate' };
  assert.equal(isExpired(bad, now, { onUnparseable: 'expired' }), true);
  assert.equal(isExpired(bad, now, { onUnparseable: 'not-expired' }), false);
  // Parseable values are unaffected by the option, in both directions.
  const past = { expiresAt: '2026-07-19T00:00:00.000Z' };
  const future = { expiresAt: '2026-07-21T00:00:00.000Z' };
  const tz = { expiresAt: '2026-07-20T00:00:00+09:00' }; // = 2026-07-19T15:00Z, already past
  for (const onUnparseable of ['expired', 'not-expired']) {
    assert.equal(isExpired(past, now, { onUnparseable }), true);
    assert.equal(isExpired(future, now, { onUnparseable }), false);
    assert.equal(isExpired(tz, now, { onUnparseable }), true);
    assert.equal(isExpired({}, now, { onUnparseable }), false);
  }
});

// #1756: no default direction. A write-side call site that forgets the option
// would otherwise inherit the read-side answer and reintroduce the bug in
// silence, so an omission has to be as loud as a typo.
test('isExpired: onUnparseable is required — omission and typos both throw', () => {
  const now = new Date('2026-07-20T00:00:00.000Z');
  const bad = { expiresAt: 'notadate' };
  assert.throws(() => isExpired(bad, now), TypeError);
  assert.throws(() => isExpired(bad, now, {}), TypeError);
  assert.throws(() => isExpired(bad, now, { onUnparseable: undefined }), TypeError);
  assert.throws(() => isExpired(bad, now, { onUnparseable: 'not_expired' }), TypeError);
  // The guard runs before the expiresAt check, so even a well-formed entry throws.
  assert.throws(() => isExpired({ expiresAt: now.toISOString() }, now), TypeError);
});

test('hasUnparseableExpiresAt: present but unparseable only', () => {
  assert.equal(hasUnparseableExpiresAt({ expiresAt: 'notadate' }), true);
  assert.equal(hasUnparseableExpiresAt({ expiresAt: '2026-13-45' }), true);
  assert.equal(hasUnparseableExpiresAt({ expiresAt: '2026-07-20T00:00:00.000Z' }), false);
  assert.equal(hasUnparseableExpiresAt({}), false);
  assert.equal(hasUnparseableExpiresAt(undefined), false);
});

// #1756: archiving is a write-side transition, so a value that proves nothing
// about the deadline must not trigger it — and the skip must not be silent.
test('expireEntries: leaves an unparseable expiresAt alone and warns', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const past = new Date(Date.now() - 86400000).toISOString();
    appendEntry(indexPath, makeEntry({ id: 'malformed', expiresAt: 'notadate' }));
    appendEntry(indexPath, makeEntry({ id: 'really-expired', expiresAt: past }));
    const warnings = [];
    const count = expireEntries(indexPath, { warn: (msg) => warnings.push(msg) });
    assert.equal(count, 1);
    const mem = loadMemory(indexPath);
    assert.equal(mem.entries.find((e) => e.id === 'malformed').status, undefined);
    assert.equal(mem.entries.find((e) => e.id === 'really-expired').status, 'archived');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /malformed/);
    assert.match(warnings[0], /notadate/);
  } finally {
    cleanup();
  }
});

// #1756 follow-up: the warning claims the entry was "left as-is instead of
// archived", which is only true for an entry this function would have archived.
// An archived / superseded entry was never a candidate for the transition.
test('expireEntries: warns only for an ACTIVE unparseable entry', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    appendEntry(indexPath, makeEntry({ id: 'active-bad', expiresAt: 'notadate' }));
    appendEntry(
      indexPath,
      makeEntry({ id: 'archived-bad', expiresAt: 'notadate', status: 'archived' })
    );
    appendEntry(
      indexPath,
      makeEntry({ id: 'superseded-bad', expiresAt: 'notadate', status: 'superseded' })
    );
    const warnings = [];
    assert.equal(expireEntries(indexPath, { warn: (msg) => warnings.push(msg) }), 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /active-bad/);
    // Idempotent: a second run repeats exactly the same single warning, never
    // an accumulating stream of untrue ones.
    const second = [];
    assert.equal(expireEntries(indexPath, { warn: (msg) => second.push(msg) }), 0);
    assert.deepEqual(second, warnings);
    // No status was touched by either run.
    const mem = loadMemory(indexPath);
    assert.equal(mem.entries.find((e) => e.id === 'active-bad').status, undefined);
    assert.equal(mem.entries.find((e) => e.id === 'archived-bad').status, 'archived');
    assert.equal(mem.entries.find((e) => e.id === 'superseded-bad').status, 'superseded');
  } finally {
    cleanup();
  }
});

test('expireEntries: honors an injected now', () => {
  const { cleanup, indexPath } = tmpIndex();
  try {
    const expiresAt = '2026-07-20T00:00:00.000Z';
    appendEntry(indexPath, makeEntry({ id: 'e', expiresAt }));
    // Before expiry: nothing archived.
    assert.equal(expireEntries(indexPath, { now: new Date('2026-07-19T00:00:00.000Z') }), 0);
    // After expiry: archived.
    assert.equal(expireEntries(indexPath, { now: new Date('2026-07-21T00:00:00.000Z') }), 1);
    assert.equal(loadMemory(indexPath).entries.find((e) => e.id === 'e').status, 'archived');
  } finally {
    cleanup();
  }
});
