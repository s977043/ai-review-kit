#!/usr/bin/env node
// Generate a machine-readable skill manifest for selective adopters (#1016).
//
// Teams that port individual review viewpoints (skills) into their own agent
// definitions have no way to notice when the upstream skill changes. This
// manifest gives them a deterministic `id + path + checksum` list to diff
// against their copies (e.g. in CI) and detect drift.
//
// Output is deliberately deterministic: no timestamps, entries sorted by id,
// per-skill checksum derived from the sorted relative-path + content hashes of
// every file in the skill directory. Re-running on the same tree produces the
// same bytes, so `--check` can compare freshness byte-for-byte.
//
// Usage:
//   node scripts/generate-skill-manifest.mjs            # write the manifest
//   node scripts/generate-skill-manifest.mjs --check    # exit 1 if stale

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { listSkillPackageDirs } from '../runners/core/skill-loader.mjs';
import { isDirectRun } from './lib/is-direct-run.mjs';

const SKILLS_ROOT = 'skills';
const OUTPUT_PATH = path.join('docs', 'data', 'skill-manifest.json');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Extract the frontmatter `id:` from a SKILL.md (fallback: directory name). */
export function extractSkillId(skillMdContent, fallback) {
  // \r? keeps this working on Windows checkouts with CRLF line endings.
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMdContent);
  if (fm) {
    const m = /^id:\s*['"]?([\w.-]+)['"]?\s*\r?$/m.exec(fm[1]);
    if (m) return m[1];
  }
  return fallback;
}

async function listFilesRecursive(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Compute the composite checksum of one skill directory: the sha256 of the
 * sorted "relpath\nsha256(content)\n" lines of every file under it.
 */
export async function computeSkillEntry(skillDir, rootDir = '.') {
  const files = (await listFilesRecursive(skillDir)).sort();
  const lines = [];
  for (const file of files) {
    const rel = path.relative(skillDir, file).replaceAll('\\', '/');
    // Normalize CRLF to LF before hashing so a Windows checkout with
    // core.autocrlf produces the same checksum as Linux/macOS. Skill dirs are
    // text (md/yaml/json); treating any stray CRLF byte pair as LF keeps the
    // hash deterministic across platforms.
    const content = Buffer.from(
      (await fs.readFile(file)).toString('binary').replaceAll('\r\n', '\n'),
      'binary'
    );
    lines.push(`${rel}\n${sha256(content)}\n`);
  }
  const composite = sha256(Buffer.from(lines.join(''), 'utf8'));
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const skillMd = await fs.readFile(skillMdPath, 'utf8');
  const id = extractSkillId(skillMd, path.basename(skillDir));
  return {
    id,
    path: path.relative(rootDir, skillDir).replaceAll('\\', '/'),
    checksum: `sha256:${composite}`,
    files: files.length,
  };
}

/**
 * Find every directory under `skillsRoot` that contains a SKILL.md.
 *
 * Delegates the walk to the shared {@link listSkillPackageDirs} (skill-loader),
 * then applies this generator's default lexicographic sort. The final manifest
 * re-sorts entries by id, so the dir order here is not output-visible, but the
 * sort is kept for a stable, self-consistent return value.
 */
export async function findSkillDirs(skillsRoot = SKILLS_ROOT) {
  const dirs = await listSkillPackageDirs(skillsRoot);
  return dirs.sort();
}

export async function generateManifest({ skillsRoot = SKILLS_ROOT, rootDir = '.' } = {}) {
  const dirs = await findSkillDirs(skillsRoot);
  const skills = await Promise.all(dirs.map((dir) => computeSkillEntry(dir, rootDir)));
  skills.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    schemaVersion: 1,
    description:
      'Deterministic skill manifest for drift detection by selective adopters. ' +
      'Compare the checksum of your copied skill against this list to notice upstream changes. ' +
      'Regenerate with: npm run skills:manifest',
    skillCount: skills.length,
    skills,
  };
}

export function renderManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  const manifest = await generateManifest();
  const rendered = renderManifest(manifest);

  if (check) {
    let current = null;
    try {
      current = await fs.readFile(OUTPUT_PATH, 'utf8');
    } catch {
      // missing file falls through to the stale branch
    }
    // Normalize CRLF so a Windows checkout of the committed manifest does not
    // false-positive against the LF-rendered output.
    if (current !== null && current.replaceAll('\r\n', '\n') === rendered) {
      console.log(`skill manifest is up to date (${manifest.skillCount} skills).`);
      return 0;
    }
    console.error(
      `skill manifest is stale. Run \`npm run skills:manifest\` and commit ${OUTPUT_PATH}.`
    );
    return 1;
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, rendered, 'utf8');
  console.log(`wrote ${OUTPUT_PATH} (${manifest.skillCount} skills).`);
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
