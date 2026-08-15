// resolveProfile（ADR-006 / #1859）の決定論と fallback のテスト。
//
// 期待する profile id はこのファイルにベタ書きする。実装から読んで比較すると
// 「resolver が返したものと同じ」しか言えず、id を書き換えても緑のまま通る。
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PROFILE, PROFILES, resolveProfile } from '../src/prompt/profile-resolver.mjs';

const GENERIC_ID = 'generic-review-v1';
const OPENAI_ID = 'openai-review-v1';

test('profile は 2 本だけである（ADR-006 初回導入範囲）', () => {
  assert.deepEqual(Object.keys(PROFILES).sort(), [GENERIC_ID, OPENAI_ID].sort());
});

test('openai は openai profile へ解決する', () => {
  assert.equal(resolveProfile({ provider: 'openai' }).id, OPENAI_ID);
  assert.equal(resolveProfile({ provider: 'openai', model: 'gpt-4o-mini' }).id, OPENAI_ID);
  // 表記ゆれは正規化して同じ結果になる。
  assert.equal(resolveProfile({ provider: ' OpenAI ' }).id, OPENAI_ID);
});

test('unknown provider は generic へ落ちる', () => {
  for (const provider of ['anthropic', 'google', 'ollama', 'totally-unknown', '', '   ']) {
    assert.equal(
      resolveProfile({ provider }).id,
      GENERIC_ID,
      `provider=${JSON.stringify(provider)} must fall back to generic`
    );
  }
});

test('null / undefined / 非文字列 / 引数なしでも例外にせず generic へ落ちる', () => {
  assert.equal(resolveProfile({ provider: null }).id, GENERIC_ID);
  assert.equal(resolveProfile({ provider: undefined }).id, GENERIC_ID);
  assert.equal(resolveProfile({ provider: 42 }).id, GENERIC_ID);
  assert.equal(resolveProfile({}).id, GENERIC_ID);
  assert.equal(resolveProfile(null).id, GENERIC_ID);
  assert.equal(resolveProfile().id, GENERIC_ID);
  assert.equal(DEFAULT_PROFILE.id, GENERIC_ID);
});

test('unknown model は provider の解決結果を変えない', () => {
  assert.equal(resolveProfile({ provider: 'openai', model: 'no-such-model' }).id, OPENAI_ID);
  assert.equal(resolveProfile({ provider: 'anthropic', model: 'no-such-model' }).id, GENERIC_ID);
});

test('決定論である（同じ入力は常に同じ profile 参照を返す）', () => {
  const inputs = [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'anthropic', model: 'claude' },
    { provider: null },
  ];
  for (const input of inputs) {
    const first = resolveProfile(input);
    for (let i = 0; i < 20; i += 1) {
      assert.equal(resolveProfile(input), first);
    }
  }
});

test('profile は凍結されており、呼び出し側から書き換えられない', () => {
  const profile = resolveProfile({ provider: 'openai' });
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.capabilities), true);
  assert.throws(() => {
    profile.rendererId = 'generic';
  }, TypeError);
  assert.equal(profile.rendererId, 'openai');
});

test('profile は宣言だけを持つ（判断側のキーを持たない）', () => {
  for (const profile of Object.values(PROFILES)) {
    assert.deepEqual(Object.keys(profile).sort(), ['capabilities', 'id', 'rendererId', 'version']);
  }
});
