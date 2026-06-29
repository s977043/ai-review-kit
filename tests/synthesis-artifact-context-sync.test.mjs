// Contract test for #911 Phase 3 slice A+D (per Codex slice judgment).
//
// The synthesis skill (`independent-review-synthesis`) declares
// `inputContext: [reviewSelf, reviewExternal, findingsPool]` (camelCase, in
// `schemas/skill.schema.json` enum). The artifact resolver
// (`src/config/artifact-resolver.mjs` `CWD_DEFAULTS`) keys files by kebab-case
// IDs (`review-self`, `review-external`, `findings-pool`).
//
// These two surfaces must stay in lockstep. This test fails if either side
// drops one of the three synthesis-related entries — catching the silent-skip
// failure mode that would otherwise let the synthesis skill never get its
// inputs at runtime.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test, { describe } from 'node:test';

import { CWD_DEFAULTS } from '../src/config/artifact-resolver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_SCHEMA_PATH = resolve(__dirname, '../schemas/skill.schema.json');

const skillSchema = JSON.parse(readFileSync(SKILL_SCHEMA_PATH, 'utf8'));

// Map: camelCase inputContext value → kebab-case artifact ID expected in CWD_DEFAULTS
const SYNTHESIS_PAIRS = [
  ['reviewSelf', 'review-self'],
  ['reviewExternal', 'review-external'],
  ['findingsPool', 'findings-pool'],
];

function getInputContextEnum() {
  const def = skillSchema.$defs?.inputContext ?? skillSchema.properties?.inputContext;
  // Both the $defs entry (string + enum) and the property reference resolve to
  // the same enum. Read whichever has it.
  const raw = skillSchema.$defs?.inputContext?.enum ?? (Array.isArray(def?.enum) ? def.enum : null);
  assert.ok(Array.isArray(raw), 'inputContext enum not found in skill.schema.json');
  return raw;
}

describe('synthesis artifact ↔ inputContext sync (#911 Phase 3 A+D)', () => {
  const enumValues = getInputContextEnum();

  test('every synthesis inputContext value is in skill.schema.json enum', () => {
    for (const [camel] of SYNTHESIS_PAIRS) {
      assert.ok(
        enumValues.includes(camel),
        `skill.schema.json inputContext is missing "${camel}". This breaks #911 Phase 1 skill declaration.`
      );
    }
  });

  test('every synthesis inputContext value has a kebab-case artifact ID in CWD_DEFAULTS', () => {
    for (const [camel, kebab] of SYNTHESIS_PAIRS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CWD_DEFAULTS, kebab),
        `artifact-resolver CWD_DEFAULTS is missing "${kebab}" (paired with inputContext "${camel}"). The synthesis skill would resolve no inputs at runtime.`
      );
    }
  });

  test('the synthesis skill itself declares the three new inputContexts', () => {
    const skillMd = readFileSync(
      resolve(__dirname, '../skills/midstream/independent-review-synthesis/SKILL.md'),
      'utf8'
    );
    for (const [camel] of SYNTHESIS_PAIRS) {
      assert.ok(
        skillMd.includes(`- ${camel}`),
        `SKILL.md does not declare inputContext "${camel}". Phase 2 schema enum exists but the skill cannot consume it.`
      );
    }
  });
});
