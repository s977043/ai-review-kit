#!/usr/bin/env node
// Skill changelog generator (#1016).
//
// Diffs the deterministic skill manifest (docs/data/skill-manifest.json) between
// two git refs and renders a Markdown "Skills changed" section. Selective
// adopters (who port viewpoints into their own skills rather than installing the
// plugin) use this to see which upstream skills changed between releases.
//
// Pure functions (diffManifests / renderSkillChangelog) are exported for tests.
// The CLI reads each side's manifest via `git show <ref>:<path>`.
//
// Usage:
//   node scripts/skill-changelog.mjs --base <ref> [--head <ref>]
//     --base   required. Previous git ref (e.g. the previous release tag).
//     --head   optional. Newer git ref. Defaults to the working-tree manifest.
//
// Robustness: if a side's manifest is missing or unparseable (e.g. an old tag
// from before the manifest existed), the CLI prints a short note and exits 0 so
// it never fails a release pipeline.

import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { isDirectRun } from './lib/is-direct-run.mjs';

const MANIFEST_PATH = 'docs/data/skill-manifest.json';

/**
 * Diff two manifest skill arrays by id + checksum.
 * @param {Array<{id:string,checksum:string}>} prevSkills
 * @param {Array<{id:string,checksum:string}>} currSkills
 * @returns {{added:string[], removed:string[], changed:string[]}} sorted id lists
 */
export function diffManifests(prevSkills, currSkills) {
  // Filter out malformed entries (null / undefined / missing id) defensively so
  // a corrupt manifest can never crash the release pipeline.
  const prev = new Map((prevSkills ?? []).filter((s) => s?.id).map((s) => [s.id, s.checksum]));
  const curr = new Map((currSkills ?? []).filter((s) => s?.id).map((s) => [s.id, s.checksum]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, checksum] of curr) {
    if (!prev.has(id)) {
      added.push(id);
    } else if (prev.get(id) !== checksum) {
      changed.push(id);
    }
  }
  for (const id of prev.keys()) {
    if (!curr.has(id)) {
      removed.push(id);
    }
  }

  const sort = (arr) => arr.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { added: sort(added), removed: sort(removed), changed: sort(changed) };
}

/**
 * Render a Markdown "Skills changed" section from a diff. Returns an empty
 * string when there are no changes.
 * @param {{added:string[], removed:string[], changed:string[]}} diff
 * @returns {string}
 */
export function renderSkillChangelog(diff) {
  const { added = [], removed = [], changed = [] } = diff ?? {};
  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    return '';
  }

  const lines = ['### Skills changed', ''];
  const section = (title, ids) => {
    if (ids.length === 0) return;
    lines.push(`**${title}** (${ids.length})`);
    lines.push('');
    for (const id of ids) lines.push(`- \`${id}\``);
    lines.push('');
  };
  section('Changed', changed);
  section('Added', added);
  section('Removed', removed);

  lines.push(
    'Selective adopters: compare the `checksum` of your copied skill against ' +
      `\`${MANIFEST_PATH}\` to detect upstream drift.`
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Load the manifest's skill array from a git ref, or the working tree when ref
 * is null/undefined. Returns null when the manifest is absent or unparseable.
 */
export async function loadSkillsAtRef(ref) {
  let raw;
  try {
    if (ref) {
      raw = execFileSync('git', ['show', `${ref}:${MANIFEST_PATH}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } else {
      raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    }
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.skills) ? parsed.skills : null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { base: null, head: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i];
    else if (argv[i] === '--head') args.head = argv[++i];
  }
  return args;
}

async function main() {
  const { base, head } = parseArgs(process.argv.slice(2));
  if (!base) {
    console.error('Usage: node scripts/skill-changelog.mjs --base <ref> [--head <ref>]');
    return 2;
  }

  const prevSkills = await loadSkillsAtRef(base);
  const currSkills = await loadSkillsAtRef(head);

  if (prevSkills === null) {
    console.error(`skill-changelog: no parseable manifest at base ref "${base}", skipping.`);
    return 0;
  }
  if (currSkills === null) {
    console.error(
      `skill-changelog: no parseable manifest at head ref "${head ?? 'working tree'}", skipping.`
    );
    return 0;
  }

  const section = renderSkillChangelog(diffManifests(prevSkills, currSkills));
  if (section) process.stdout.write(section);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
