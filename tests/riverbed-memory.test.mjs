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
  assert.equal(isExpired({ expiresAt: at.toISOString() }, at), true); // boundary: equal
  assert.equal(isExpired({ expiresAt: at.toISOString() }, new Date(at.getTime() - 1)), false);
  assert.equal(isExpired({ expiresAt: at.toISOString() }, new Date(at.getTime() + 1)), true);
  assert.equal(isExpired({}, at), false); // no expiresAt
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
