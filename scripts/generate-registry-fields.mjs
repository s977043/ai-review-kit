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
// Known boundary: this script only syncs fields of entries ALREADY present in
// registry.yaml. A SKILL.md on disk that is absent from the catalog is not
// added here — that reverse gap stays a warn-only signal in
// validateRegistryPaths() (scripts/validate-skills.mjs), by existing design.
//
// The runtime skill-loader (runners/core/skill-loader.mjs) never reads the
// `skills:` list — it resolves phase/category from frontmatter directly and
// only reads registry.yaml for `packs:` and `recommendations:`. So syncing the
// structural fields changes no loader behavior; it only realigns the catalog /
// dashboard view and the drift guards.
//
// Editing strategy: an in-place, order- and comment-preserving line rewrite
// keyed by each entry's `path`. Only a managed field whose value actually
// differs from its frontmatter is rewritten, so the diff is exactly the drift
// being resolved — no reordering, no lost comments.
//
// Wrapped (multi-line flow) values: prettier (printWidth 100) wraps long `tags`
// arrays across several lines (`tags:` on its own line, then the flow array).
// A naive same-line rewrite would silently miss those (drift detected but never
// realized in text → CI reports "in sync" — the #1580 W1 hole). So the rewrite
// consumes the field's FULL span (its line plus any deeper-indented
// continuation lines) and, as a backstop, a drift that cannot be located as a
// `    <field>:` line is a HARD ERROR rather than a silent skip.
//
// Formatting: the rewrite always emits the inline form; the whole result is
// then run through prettier (the repo's single source of truth for formatting)
// so the output is byte-identical to what CI's format:check / the pre-commit
// hook would produce — long arrays get re-wrapped canonically, short ones stay
// inline. This keeps `--check` a pure drift signal: on an already-synced,
// prettier-clean registry it is a no-op (prettier is idempotent).
//
// Usage:
//   node scripts/generate-registry-fields.mjs          # write (sync) registry.yaml
//   node scripts/generate-registry-fields.mjs --check   # exit 1 if stale

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import * as yaml from 'js-yaml';
import prettier from 'prettier';

import { isDirectRun } from './lib/is-direct-run.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'skills', 'registry.yaml');

// Structural fields owned by frontmatter. `path` is the join key (never
// generated: it is the pointer to the file we read the frontmatter from).
export const MANAGED_FIELDS = ['id', 'version', 'name', 'category', 'phase', 'tags', 'severity'];

/**
 * Parse the YAML frontmatter block of a SKILL.md into an object. Tolerates a
 * leading UTF-8 BOM and leading blank lines/whitespace before the opening `---`
 * so a stray editor artifact does not make a real skill's frontmatter vanish
 * (which would look like "no drift" — a silent miss).
 */
export function parseFrontmatter(text) {
  // Strip a leading UTF-8 BOM (U+FEFF) and any leading whitespace in one pass.
  const cleaned = String(text ?? '').replace(/^[﻿\s]+/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(cleaned);
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
 * True when `line` is a continuation of a wrapped managed-field value, i.e.
 * indented DEEPER than the 4-space field indent (the flow array's `[`, its
 * per-element lines, and the closing `]` prettier emits at 6+ spaces).
 */
function isContinuationLine(line) {
  return /^ {6,}\S/.test(line) || /^ {6,}$/.test(line);
}

/**
 * Rewrite the managed structural fields of skills/registry.yaml from
 * frontmatter, then re-render through prettier. Reads the referenced SKILL.md
 * files; returns the new (prettier-formatted) file text, the list of per-field
 * changes, and any hard errors (drift that could not be located in the text).
 *
 * @param {string} raw - current registry.yaml content
 * @param {{ rootDir?: string, prettierConfig?: object|null }} [options]
 * @returns {Promise<{ content: string, changes: Array<{ id: string, field: string, from: unknown, to: unknown }>, errors: string[] }>}
 */
export async function syncRegistryFields(raw, { rootDir = ROOT, prettierConfig } = {}) {
  // Normalize CRLF → LF up front: on an autocrlf checkout `raw` may carry `\r`,
  // which would make `l === 'skills:'` and the field regexes miss, and — since
  // prettier always emits LF — make `--check` see a phantom diff. `.gitattributes`
  // only pins LF for dist/*.sh, not registry.yaml, so this is load-bearing.
  const normalizedRaw = raw.replaceAll('\r\n', '\n');
  const parsed = yaml.load(normalizedRaw) ?? {};
  const entriesByPath = new Map();
  for (const entry of Array.isArray(parsed.skills) ? parsed.skills : []) {
    if (entry && typeof entry.path === 'string') entriesByPath.set(entry.path, entry);
  }

  const lines = normalizedRaw.split('\n');
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

  // Collect entry spans (list items) within the skills region.
  const entryStarts = [];
  for (let i = skillsIdx + 1; i < regionEnd; i++) {
    if (/^ {2}- id:/.test(lines[i])) entryStarts.push(i);
  }

  const changes = [];
  const errors = [];
  // Plan replacements as {index, span, text} so multi-line spans collapse
  // cleanly; apply them after scanning so index bookkeeping stays simple.
  const replacements = [];

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
    let skillText;
    try {
      skillText = await fs.readFile(path.resolve(rootDir, skillPath), 'utf8');
    } catch (err) {
      // A genuinely missing file is reported by validateRegistryPaths — skip it
      // here. Any OTHER read error (permissions, IO) is unexpected: fail loudly
      // rather than pretend there is no drift.
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    let frontmatter;
    try {
      frontmatter = parseFrontmatter(skillText);
    } catch (err) {
      // Malformed frontmatter YAML must not be swallowed as "no drift" — record
      // a hard error so the sync/check fails visibly (gemini #3609683789).
      errors.push(`${skillPath}: SKILL.md frontmatter is not valid YAML: ${err.message}`);
      continue;
    }

    for (const field of MANAGED_FIELDS) {
      if (!(field in frontmatter)) continue; // frontmatter is authoritative; nothing to sync
      const desired = frontmatter[field];
      if (valuesEqual(registryEntry[field], desired)) continue;

      // Locate the field line. Two shapes exist: a normal 4-space field
      // (`    tags: ...`) and the list-item first field, which in this registry
      // is always `  - id: ...`. Match both and keep whichever prefix was used
      // so an `id` (or any future first-field) drift can actually be rewritten
      // rather than falling through to the backstop error (gemini #3609683783).
      const fieldRe = new RegExp(`^( {4}|  - )${field}:`);
      let fieldIdx = -1;
      let prefix = '    ';
      for (let i = start; i < end; i++) {
        const m = fieldRe.exec(lines[i]);
        if (m) {
          fieldIdx = i;
          prefix = m[1];
          break;
        }
      }
      if (fieldIdx === -1) {
        // Backstop: real drift we cannot realize in text (e.g. a malformed
        // entry missing this managed field line). Fail loudly instead of the
        // silent skip that let #1580 W1 slip through.
        errors.push(
          `${registryEntry.id ?? skillPath}: frontmatter sets ${field}=` +
            `${JSON.stringify(normalizeValue(desired))} but no "${field}:" line exists in ` +
            'its registry entry to update'
        );
        continue;
      }
      let spanEnd = fieldIdx + 1;
      while (spanEnd < end && isContinuationLine(lines[spanEnd])) spanEnd++;

      replacements.push({
        index: fieldIdx,
        span: spanEnd - fieldIdx,
        text: `${prefix}${field}: ${renderFieldValue(field, desired)}`,
      });
      changes.push({
        id: registryEntry.id ?? skillPath,
        field,
        from: registryEntry[field],
        to: normalizeValue(desired),
      });
    }
  }

  // Apply replacements bottom-up so earlier indices stay valid.
  replacements.sort((a, b) => b.index - a.index);
  for (const r of replacements) lines.splice(r.index, r.span, r.text);

  let content = lines.join('\n');
  // Canonicalize with prettier so the output matches CI's format:check exactly
  // (long tag arrays re-wrap; short ones stay inline). Idempotent on an
  // already-clean file, so a no-drift run returns byte-identical content.
  const cfg =
    prettierConfig !== undefined
      ? prettierConfig
      : await prettier.resolveConfig(path.join(rootDir, 'skills', 'registry.yaml'));
  content = await prettier.format(content, { ...(cfg ?? {}), parser: 'yaml' });

  return { content, changes, errors };
}

async function main() {
  const check = process.argv.includes('--check');
  const raw = await fs.readFile(REGISTRY_PATH, 'utf8');
  // Compare against the LF-normalized input: prettier emits LF, so a CRLF
  // checkout must not read as "stale". syncRegistryFields normalizes internally.
  const rawLf = raw.replaceAll('\r\n', '\n');
  const { content, changes, errors } = await syncRegistryFields(raw);

  // Hard errors (unrealizable drift) fail both modes — never write a partial file.
  if (errors.length) {
    console.error('registry structural-field sync could not proceed:');
    for (const msg of errors) console.error(`  - ${msg}`);
    return 1;
  }

  if (check) {
    if (content === rawLf) {
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

  if (content === rawLf) {
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
