#!/usr/bin/env node
/**
 * Sync shared metadata fields between package.json and both plugin manifests.
 *
 * Source of truth: package.json
 * Targets: .claude-plugin/plugin.json, .codex-plugin/plugin.json
 *
 * Synced fields: keywords, homepage, repository, author, license
 * Not synced: description (intentionally differs per platform), version (release-please owns it)
 *
 * Usage:
 *   node scripts/sync-plugin-fields.mjs          # sync (writes files if changed)
 *   node scripts/sync-plugin-fields.mjs --check  # check only (exit 1 if drift found)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
// repository is excluded: package.json uses {type, url} object; plugins use plain string URL.
const SYNCED_FIELDS = ['keywords', 'homepage', 'author', 'license'];

const CHECK_MODE = process.argv.includes('--check');

async function readJson(rel) {
  const raw = await fs.readFile(path.join(ROOT, rel), 'utf8');
  return JSON.parse(raw);
}

async function writeJson(rel, data) {
  const out = JSON.stringify(data, null, 2) + '\n';
  await fs.writeFile(path.join(ROOT, rel), out, 'utf8');
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function syncPluginFile(pluginPath, source) {
  const manifest = await readJson(pluginPath);
  const drifted = [];

  for (const field of SYNCED_FIELDS) {
    if (source[field] === undefined) continue;
    if (!deepEqual(manifest[field], source[field])) {
      drifted.push(field);
    }
  }

  if (drifted.length === 0) {
    console.log(`  ${pluginPath}: OK (no drift)`);
    return false;
  }

  if (CHECK_MODE) {
    for (const field of drifted) {
      console.error(`  ${pluginPath}: drift in "${field}"`);
      console.error(`    package.json: ${JSON.stringify(source[field])}`);
      console.error(`    plugin.json:  ${JSON.stringify(manifest[field])}`);
    }
    return true;
  }

  for (const field of drifted) {
    manifest[field] = source[field];
  }
  await writeJson(pluginPath, manifest);
  console.log(`  ${pluginPath}: synced [${drifted.join(', ')}]`);
  return false;
}

const pkg = await readJson('package.json');

console.log(CHECK_MODE ? 'Checking plugin field parity...' : 'Syncing plugin fields...');
const ccDrift = await syncPluginFile('.claude-plugin/plugin.json', pkg);
const codexDrift = await syncPluginFile('.codex-plugin/plugin.json', pkg);

if (ccDrift || codexDrift) {
  console.error('\nDrift detected. Run `npm run plugin:sync` to fix.');
  process.exitCode = 1;
} else if (!CHECK_MODE) {
  console.log('Done.');
}
