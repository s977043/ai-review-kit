#!/usr/bin/env node
// Single-source the *structural* fields of skills/registry.yaml from each
// skill's SKILL.md frontmatter (#1562).
//
// Background: registry.yaml historically duplicated structural metadata
// (id / version / name / category / phase / tags / severity) that already
// lives in the SKILL.md frontmatter. Hand-maintaining both copies drifted
// repeatedly (#1552..#1560: id 7, severity 5, phase 1, tags 6). Prior work
// added *detection* guards (validateRegistryPaths / validateRegistryIdMatch /
// validateFixtureDrift); this script flips to *generation* so the two sources
// cannot diverge in the first place.
//
// Boundary — what this script owns vs. leaves hand-authored:
//   * GENERATED (from frontmatter, keyed by the entry's `path`):
//       id, version, name, category, phase, tags, severity
//   * HAND-AUTHORED (never touched — catalog curation):
//       recommended, description, exclude (and any other per-entry field),
//       plus the `packs:` and `recommendations:` sections and every comment.
//   * NOT mirrored into the registry at all (frontmatter stays the sole home):
//       applyTo — duplicating it would re-introduce a second source; the way to
//       single-source applyTo is to keep it out of registry.yaml entirely.
//
// The runtime skill-loader (runners/core/skill-loader.mjs) never reads the
// `skills:` list — it resolves phase/category from frontmatter directly and
// only reads registry.yaml for `packs:` and `recommendations:`. So syncing the
// structural fields changes no loader behavior; it only realigns the catalog /
// dashboard view and the drift guards.
//
// Editing strategy: an in-place, order- and comment-preserving line rewrite
// keyed by each entry's `path`. Only a managed field line whose value actually
// differs from its frontmatter is rewritten, so the diff is exactly the drift
// being resolved — no quoting churn, no reordering, no lost comments.
//
// Usage:
//   node scripts/generate-registry-fields.mjs          # write (sync) registry.yaml
//   node scripts/generate-registry-fields.mjs --check   # exit 1 if stale

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import * as yaml from 'js-yaml';

import { isDirectRun } from './lib/is-direct-run.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'skills', 'registry.yaml');

// Structural fields owned by frontmatter. `path` is the join key (never
// generated: it is the pointer to the file we read the frontmatter from).
export const MANAGED_FIELDS = ['id', 'version', 'name', 'category', 'phase', 'tags', 'severity'];

/** Parse the YAML frontmatter block of a SKILL.md into an object. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  return yaml.load(m[1]) ?? {};
}

/**
 * Normalize a value for equality comparison AND canonical rendering: a
 * single-element array collapses to its scalar (registry convention keeps
 * one-phase/one-category entries scalar; only genuinely multi-valued fields
 * stay as arrays). Everything else passes through unchanged.
 */
export function normalizeValue(value) {
  if (Array.isArray(value) && value.length === 1) return value[0];
  return value;
}

/** True when a string cannot be emitted as a YAML plain (unquoted) scalar. */
export function needsQuote(s) {
  if (s === '') return true;
  if (/^\s|\s$/.test(s)) return true; // leading/trailing whitespace
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return true; // leading indicator char
  if (/:(\s|$)/.test(s) || /\s#/.test(s)) return true; // "key: " or " #comment"
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true; // bool/null-ish
  if (/^[+-]?(\d[\d_]*)(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return true; // number-ish
  return false;
}

/** Render one scalar in the registry's quoting convention. */
export function renderScalar(value) {
  const s = String(value);
  return needsQuote(s) ? `'${s.replace(/'/g, "''")}'` : s;
}

/**
 * Render the RHS text for a managed field, matching the existing registry
 * formatting (version single-quoted; arrays as inline flow; scalars plain).
 */
export function renderFieldValue(field, value) {
  if (field === 'version') return `'${String(value)}'`;
  const normalized = normalizeValue(value);
  if (Array.isArray(normalized)) {
    return `[${normalized.map((el) => renderScalar(el)).join(', ')}]`;
  }
  return renderScalar(normalized);
}

/** Deep-equal after normalization (single-element array === scalar). */
function valuesEqual(a, b) {
  return JSON.stringify(normalizeValue(a)) === JSON.stringify(normalizeValue(b));
}

/**
 * Rewrite the managed structural fields of skills/registry.yaml in place from
 * frontmatter. Pure over its `raw` input plus filesystem reads of the
 * referenced SKILL.md files; returns the new file text and the list of
 * per-field changes (for reporting / the freshness check).
 *
 * @param {string} raw - current registry.yaml content
 * @param {{ rootDir?: string }} [options]
 * @returns {Promise<{ content: string, changes: Array<{ id: string, field: string, from: unknown, to: unknown }> }>}
 */
export async function syncRegistryFields(raw, { rootDir = ROOT } = {}) {
  const parsed = yaml.load(raw) ?? {};
  const entriesByPath = new Map();
  for (const entry of Array.isArray(parsed.skills) ? parsed.skills : []) {
    if (entry && typeof entry.path === 'string') entriesByPath.set(entry.path, entry);
  }

  const lines = raw.split('\n');
  const skillsIdx = lines.findIndex((l) => l === 'skills:');
  if (skillsIdx === -1) {
    throw new Error('registry.yaml: could not find top-level `skills:` key');
  }
  // The skills list ends at the next top-level key (packs: / recommendations:).
  let regionEnd = lines.length;
  for (let i = skillsIdx + 1; i < lines.length; i++) {
    if (/^[A-Za-z]/.test(lines[i])) {
      regionEnd = i;
      break;
    }
  }

  // Collect entry start indices (list items) within the skills region.
  const entryStarts = [];
  for (let i = skillsIdx + 1; i < regionEnd; i++) {
    if (/^ {2}- id:/.test(lines[i])) entryStarts.push(i);
  }

  const changes = [];
  for (let e = 0; e < entryStarts.length; e++) {
    const start = entryStarts[e];
    const end = e + 1 < entryStarts.length ? entryStarts[e + 1] : regionEnd;

    // Find this entry's `path:` to locate the SKILL.md.
    let skillPath = null;
    for (let i = start; i < end; i++) {
      const m = /^ {4}path:\s*(.+?)\s*$/.exec(lines[i]);
      if (m) {
        skillPath = m[1].replace(/^['"]|['"]$/g, '');
        break;
      }
    }
    if (!skillPath) continue;

    const registryEntry = entriesByPath.get(skillPath) ?? {};
    let frontmatter;
    try {
      const skillText = await fs.readFile(path.resolve(rootDir, skillPath), 'utf8');
      frontmatter = parseFrontmatter(skillText);
    } catch {
      // Missing/unreadable SKILL.md is reported by validateRegistryPaths; skip.
      continue;
    }

    for (const field of MANAGED_FIELDS) {
      if (!(field in frontmatter)) continue; // frontmatter is authoritative; nothing to sync
      const desired = frontmatter[field];
      if (valuesEqual(registryEntry[field], desired)) continue;

      // Rewrite the field's line (managed fields are always single-line in this
      // registry: scalars and inline-flow arrays).
      const fieldRe = new RegExp(`^( {4}${field}):\\s`);
      let rewritten = false;
      for (let i = start; i < end; i++) {
        const m = fieldRe.exec(lines[i]);
        if (!m) continue;
        lines[i] = `${m[1]}: ${renderFieldValue(field, desired)}`;
        rewritten = true;
        break;
      }
      if (rewritten) {
        changes.push({
          id: registryEntry.id ?? skillPath,
          field,
          from: registryEntry[field],
          to: normalizeValue(desired),
        });
      }
    }
  }

  return { content: lines.join('\n'), changes };
}

async function main() {
  const check = process.argv.includes('--check');
  const raw = await fs.readFile(REGISTRY_PATH, 'utf8');
  const { content, changes } = await syncRegistryFields(raw);

  if (check) {
    if (content === raw) {
      console.log('registry structural fields are in sync with SKILL.md frontmatter.');
      return 0;
    }
    console.error('registry structural fields are stale (drifted from SKILL.md frontmatter):');
    for (const c of changes) {
      console.error(`  - ${c.id}.${c.field}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
    }
    console.error('Run `npm run skills:registry` and commit skills/registry.yaml.');
    return 1;
  }

  if (content === raw) {
    console.log('registry structural fields already in sync; no changes.');
    return 0;
  }
  await fs.writeFile(REGISTRY_PATH, content, 'utf8');
  console.log(`Synced ${changes.length} registry field(s) from SKILL.md frontmatter:`);
  for (const c of changes) {
    console.log(`  - ${c.id}.${c.field}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
  }
  return 0;
}

if (isDirectRun(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
