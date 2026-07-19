#!/usr/bin/env node
// Offline structural validator for community skill promptfoo configs.
// Catches schema breakage before someone burns LLM tokens on a broken yaml.
// Does NOT call any LLM. Run by `npm run skills:validate:promptfoo` or directly.
//
// Validates:
// - YAML parses
// - `prompts`, `providers`, `tests` arrays exist and are non-empty
// - Every `file://...` reference resolves to an existing file
// - Every test has `description`, `vars`, `assert`
//
// Background: #929 (post-#868 quality gate). Lets contributors validate
// authoring changes locally without an API key.

import { readFileSync, existsSync, globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { isDirectRun } from './lib/is-direct-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export function resolveFileRef(ref, configPath) {
  // file://../prompt/system.md → relative to configPath's directory
  if (!ref.startsWith('file://')) return null;
  const rel = ref.slice('file://'.length);
  return path.resolve(path.dirname(configPath), rel);
}

export function validateConfig(configPath) {
  const errors = [];
  const text = readFileSync(configPath, 'utf8');
  let doc;
  try {
    doc = YAML.parse(text);
  } catch (err) {
    return [`YAML parse error: ${err.message}`];
  }

  for (const key of ['prompts', 'providers', 'tests']) {
    if (!Array.isArray(doc?.[key]) || doc[key].length === 0) {
      errors.push(`Missing or empty required array: ${key}`);
    }
  }

  for (const ref of doc.prompts ?? []) {
    if (typeof ref !== 'string') continue;
    const resolved = resolveFileRef(ref, configPath);
    if (resolved && !existsSync(resolved)) {
      errors.push(`prompts: file reference not found: ${ref} (resolved: ${resolved})`);
    }
  }

  for (const [i, test] of (doc.tests ?? []).entries()) {
    if (!test || typeof test !== 'object') {
      errors.push(`tests[${i}]: must be an object`);
      continue;
    }
    if (typeof test.description !== 'string' || !test.description) {
      errors.push(`tests[${i}]: missing description`);
    }
    if (!test.vars || typeof test.vars !== 'object') {
      errors.push(`tests[${i}]: missing vars`);
    } else {
      for (const [k, v] of Object.entries(test.vars)) {
        if (typeof v !== 'string' || !v.startsWith('file://')) continue;
        const resolved = resolveFileRef(v, configPath);
        if (resolved && !existsSync(resolved)) {
          errors.push(`tests[${i}].vars.${k}: file reference not found: ${v}`);
        }
      }
    }
    if (!Array.isArray(test.assert) || test.assert.length === 0) {
      errors.push(`tests[${i}]: missing or empty assert[]`);
    }
  }

  return errors;
}

export function main() {
  const configs = globSync('skills/midstream/*/eval/promptfoo.yaml', {
    cwd: REPO_ROOT,
  });
  if (configs.length === 0) {
    console.error('error: no community skill promptfoo.yaml found.');
    process.exit(1);
  }

  let total = 0;
  let bad = 0;
  for (const rel of configs.sort()) {
    const full = path.join(REPO_ROOT, rel);
    const errors = validateConfig(full);
    total += 1;
    if (errors.length === 0) {
      console.log(`✅ ${rel}`);
    } else {
      bad += 1;
      console.log(`❌ ${rel}`);
      for (const e of errors) console.log(`   - ${e}`);
    }
  }

  console.log(`\n${total - bad}/${total} configs valid.`);
  if (bad > 0) process.exit(1);
}

if (isDirectRun(import.meta.url)) {
  main();
}
