import fs from 'node:fs';
import path from 'node:path';

/**
 * Load the Riverbed Memory index from disk.
 * Returns empty structure if file doesn't exist (stateless fallback).
 *
 * @param {string} indexPath - Path to the index.json file
 * @returns {{ entries: object[], version: string }}
 */
export function loadMemory(indexPath) {
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { entries: [], version: '1' };
    }
    throw err;
  }
}

/**
 * Append a memory entry to the index.
 * Creates the directory and file if they don't exist.
 *
 * @param {string} indexPath - Path to the index.json file
 * @param {object} entry - Entry conforming to riverbed-entry.schema.json
 */
export function appendEntry(indexPath, entry) {
  const index = loadMemory(indexPath);

  // Validate required fields
  if (!entry.id || !entry.type || !entry.content || !entry.metadata) {
    throw new Error('Entry must have id, type, content, and metadata fields');
  }

  // Prevent duplicate IDs
  if (index.entries.some((e) => e.id === entry.id)) {
    throw new Error(`Duplicate entry ID: ${entry.id}`);
  }

  index.entries.push(entry);

  const dir = path.dirname(indexPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
}

/**
 * Load the index, apply a mutator to the entry with the given id, and persist.
 * The mutator receives the live entry object and mutates it in place (return
 * value is ignored). Kept deliberately small and generic so callers own the
 * transition semantics (e.g. promotion approval) while the load/write plumbing
 * and JSON formatting stay identical to appendEntry/supersede.
 *
 * @param {string} indexPath - Path to the index.json file
 * @param {string} id - id of the entry to update
 * @param {(entry: object) => void} mutate - in-place mutator
 * @returns {object} the updated entry
 */
export function updateEntry(indexPath, id, mutate) {
  const index = loadMemory(indexPath);
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) {
    throw new Error(`Entry not found: ${id}`);
  }
  mutate(entry);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  return entry;
}

/**
 * Query memory entries by filter criteria.
 * All filter fields are optional; entries must match ALL provided criteria.
 * By default, only active entries are returned.
 *
 * @param {{ entries: object[] }} index - Loaded memory index
 * @param {{ type?: string, tags?: string[], phase?: string, includeInactive?: boolean }} filter
 * @returns {object[]}
 */
export function queryMemory(index, { type, tags, phase, includeInactive = false } = {}) {
  return index.entries.filter((entry) => {
    if (!includeInactive) {
      const status = entry.status ?? 'active';
      if (status !== 'active') return false;
    }
    if (type && entry.type !== type) return false;
    if (phase && entry.metadata?.phase !== phase) return false;
    if (tags && tags.length > 0) {
      const entryTags = entry.metadata?.tags ?? [];
      if (!tags.every((t) => entryTags.includes(t))) return false;
    }
    return true;
  });
}

/**
 * Supersede an entry by marking it as superseded and pointing to the new entry.
 *
 * @param {string} indexPath - Path to the index.json file
 * @param {string} oldId - ID of the entry to supersede
 * @param {string} newId - ID of the superseding entry
 */
export function supersede(indexPath, oldId, newId) {
  const index = loadMemory(indexPath);
  const entry = index.entries.find((e) => e.id === oldId);
  if (!entry) {
    throw new Error(`Entry not found: ${oldId}`);
  }
  entry.status = 'superseded';
  entry.supersededBy = newId;
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
}

/**
 * Whether `entry.expiresAt` is present but cannot be parsed as a timestamp.
 * The single definition of "unparseable" — consumers that must branch on it (to
 * warn, or to refuse a destructive transition) call this instead of re-deriving
 * the `new Date(...)` parse.
 *
 * @param {{ expiresAt?: string }} entry
 * @returns {boolean}
 */
export function hasUnparseableExpiresAt(entry) {
  if (!entry?.expiresAt) return false;
  return Number.isNaN(new Date(entry.expiresAt).getTime());
}

/**
 * Whether an entry's expiresAt timestamp has passed relative to `now`. Shared by
 * expireEntries, the Phase 3 promotion retire lifecycle and the suppression
 * lifecycle (isSuppressionExpired) so the expiry rule (`expiresAt <= now`) is
 * defined once.
 *
 * An unparseable timestamp has no single safe answer, so the caller declares one
 * through `onUnparseable` (#1756). Comparing NaN is never among the choices: it
 * answers `false` for every operator, which hides the malformed value instead of
 * deciding about it.
 *
 * - `'expired'` (default) — for READ-SIDE effect gating, where "expired" means
 *   the entry stops taking effect. `isSuppressionExpired` uses it: a suppression
 *   whose expiresAt is unparseable (e.g. the `--expires notadate` values that
 *   reached disk before #1746 was fixed) must not keep hiding findings forever.
 * - `'not-expired'` — for WRITE-SIDE lifecycle transitions that archive an
 *   entry. Archiving discards a promotion_candidate, and an unparseable string
 *   is no evidence that the deadline passed, so those call sites leave the entry
 *   alone and warn instead — which keeps the malformed value visible.
 *
 * @param {{ expiresAt?: string }} entry
 * @param {Date} now
 * @param {{ onUnparseable?: 'expired'|'not-expired' }} [opts]
 * @returns {boolean}
 */
export function isExpired(entry, now, { onUnparseable = 'expired' } = {}) {
  if (onUnparseable !== 'expired' && onUnparseable !== 'not-expired') {
    // Fail fast rather than fall back: a typo must not silently hand a
    // write-side caller the destructive direction.
    throw new TypeError(
      `isExpired: onUnparseable must be 'expired' or 'not-expired' (got ${JSON.stringify(onUnparseable)}).`
    );
  }
  if (!entry?.expiresAt) return false;
  const timestamp = new Date(entry.expiresAt).getTime();
  if (Number.isNaN(timestamp)) return onUnparseable === 'expired';
  return timestamp <= now.getTime();
}

/**
 * Archive active entries whose expiresAt timestamp has passed.
 *
 * Archiving is a write-side transition (for a promotion_candidate it amounts to
 * a discard), so an entry whose expiresAt cannot be parsed stays untouched and
 * is reported through `warn` — never archived on the strength of a string that
 * proves nothing about the deadline (#1756).
 *
 * @param {string} indexPath - Path to the index.json file
 * @param {{ now?: Date, warn?: (msg: string) => void }} [opts] - injectable clock
 *   (defaults to real time) and warning sink (defaults to console.warn)
 * @returns {number} Number of entries archived
 */
export function expireEntries(
  indexPath,
  { now = new Date(), warn = (msg) => console.warn(msg) } = {}
) {
  const index = loadMemory(indexPath);
  let count = 0;
  for (const entry of index.entries) {
    if (hasUnparseableExpiresAt(entry)) {
      warn(
        `Warning: entry ${entry.id} has an unparseable expiresAt (${JSON.stringify(entry.expiresAt)}); left as-is instead of archived.`
      );
      continue;
    }
    if (
      isExpired(entry, now, { onUnparseable: 'not-expired' }) &&
      (entry.status ?? 'active') === 'active'
    ) {
      entry.status = 'archived';
      count++;
    }
  }
  if (count > 0) {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  }
  return count;
}
