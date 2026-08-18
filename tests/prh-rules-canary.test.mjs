// tests/prh-rules-canary.test.mjs
//
// Canary + unit coverage for tools/prh-rules/index.yml (issue #1786, stage 2-a).
//
// Two responsibilities, per repo principle #1070 (deterministic checks live in
// static analysis + canary; semantic judgment stays with human/AI review):
//
//   1. Canary — pin known false-positive shapes (identifiers, package names,
//      URL slugs containing "ai"/"GITHUB"/"javascript" as a substring) so a
//      future loosening of tools/prh-rules/index.yml cannot start flagging
//      them again. These are the exact 13 false positives found in docs/**
//      before the index.yml boundary tightening in #1786 stage 2-a.
//   2. Unit — confirm the true-positive detections the rule exists for are
//      still caught (bare "github"/"GITHUB", bare "javascript", prose "JS").
//
// This test runs the real textlint `prh` rule against tools/prh-rules/index.yml
// (the actual production rule file, not a re-derivation of its regex) so it
// cannot go green by drifting out of sync with the shipped rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinter, loadTextlintrc } from 'textlint';

async function lintWithPrh(text) {
  const descriptor = await loadTextlintrc({ configFilePath: '.textlintrc.json' });
  const linter = createLinter({ descriptor });
  const result = await linter.lintText(`${text}\n`, 'canary-fixture.md');
  return result.messages.filter((m) => m.ruleId === 'prh');
}

// ---------------------------------------------------------------------------
// Canary: known false-positive shapes must never be flagged.
// ---------------------------------------------------------------------------

test('canary: GITHUB_TOKEN (env var identifier) is not flagged by the GitHub rule', async () => {
  const messages = await lintWithPrh(
    'on-disk GITHUB_TOKEN 露出は actions/checkout の既定設定に起因する。'
  );
  assert.deepEqual(messages, [], 'GITHUB_TOKEN must not trip the prh GitHub rule');
});

test('canary: awesome-ai-devtools (repo name slug) is not flagged by the AI rule', async () => {
  const messages = await lintWithPrh(
    '[awesome-ai-devtools](https://github.com/jamesmurdza/awesome-ai-devtools) に掲載申請する。'
  );
  assert.deepEqual(messages, [], 'awesome-ai-devtools must not trip the prh AI rule');
});

test('canary: serialize-javascript (npm package name) is not flagged by the JavaScript rule', async () => {
  const messages = await lintWithPrh(
    'Dependabot alerts closed: js-yaml x2 dismiss, serialize-javascript / qs / uuid overrides'
  );
  assert.deepEqual(messages, [], 'serialize-javascript must not trip the prh JavaScript rule');
});

// ---------------------------------------------------------------------------
// Unit: true-positive detections must still fire.
// ---------------------------------------------------------------------------

test('unit: bare lowercase "github" in prose is still flagged', async () => {
  const messages = await lintWithPrh('コードは github で公開している。');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /GitHub/);
});

test('unit: bare all-caps "GITHUB" (not an identifier) is still flagged', async () => {
  const messages = await lintWithPrh('GITHUB を利用してホスティングする。');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /GITHUB => GitHub/);
});

test('unit: bare lowercase "javascript" in prose is still flagged', async () => {
  const messages = await lintWithPrh('このスクリプトは javascript で書かれている。');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /javascript => JavaScript/);
});

test('unit: prose "JS" abbreviation is still flagged', async () => {
  const messages = await lintWithPrh('バンドル済み JS を配布する。');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /JS => JavaScript/);
});

test('unit: bare lowercase "ai" in prose is still flagged', async () => {
  const messages = await lintWithPrh('この機能は ai を活用している。');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /ai => AI/);
});
