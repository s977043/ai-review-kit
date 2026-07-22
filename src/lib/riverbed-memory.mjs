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
 * Whether an entry's expiresAt timestamp has passed relative to `now`. Shared by
 * expireEntries and the Phase 3 promotion retire lifecycle so the expiry rule
 * (`expiresAt <= now`) is defined once.
 *
 * @param {{ expiresAt?: string }} entry
 * @param {Date} now
 * @returns {boolean}
 */
export function isExpired(entry, now) {
  return Boolean(entry?.expiresAt) && new Date(entry.expiresAt).getTime() <= now.getTime();
}

/**
 * Archive active entries whose expiresAt timestamp has passed.
 *
 * @param {string} indexPath - Path to the index.json file
 * @param {{ now?: Date }} [opts] - injectable clock (defaults to real time)
 * @returns {number} Number of entries archived
 */
export function expireEntries(indexPath, { now = new Date() } = {}) {
  const index = loadMemory(indexPath);
  let count = 0;
  for (const entry of index.entries) {
    if (isExpired(entry, now) && (entry.status ?? 'active') === 'active') {
      entry.status = 'archived';
      count++;
    }
  }
  if (count > 0) {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  }
  return count;
}
