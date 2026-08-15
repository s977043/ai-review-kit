// Prompt Compiler の observe モード配線（ADR-006 / #1859）のテスト。
//
// ADR-006 が observe に課す不変条件を、そのまま assert に落とす。
//   - mode=off（既定）で挙動が変わらない
//   - 追加の LLM 呼び出しを発生させない（実測: fetch 呼び出し回数）
//   - candidate プロンプトを provider へ送らない（送信 body を実測）
//   - 記録するのは hash と推定長と profile の来歴だけである
//   - diff 全文を debug へ複製しない
//
// LLM 呼び出しの計測は globalThis.fetch を差し替えて数える。
// callChatCompletion の fetchImpl は既定引数で globalThis.fetch を読むため、
// 差し替えが効く（src/lib/llm-pipeline.mjs）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { generateReview } from '../src/lib/review-engine.mjs';
import { defaultConfig } from '../src/config/default.mjs';
import { reviewConfigSchema } from '../src/config/schema.mjs';
import { compileReviewPrompt } from '../src/prompt/compiler.mjs';
import { buildReviewRequest } from '../src/prompt/review-request.mjs';
import { resolveProfile } from '../src/prompt/profile-resolver.mjs';
import { getReviewDepthConfig } from '../src/lib/review-plan-generator.mjs';
import { buildSystemMessage } from '../src/prompt/sections.mjs';

/** debug に現れてはならない、diff / rules に仕込む目印。 */
const DIFF_MARKER = 'ZZ_DIFF_MARKER_9f3a';
const RULES_MARKER = 'ZZ_RULES_MARKER_7c1b';

const diffText = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,0 +11,2 @@
+const value = 1; // ${DIFF_MARKER}
+console.log(value);
`;

const diff = {
  diffText,
  files: [
    {
      path: 'src/app.ts',
      hunks: [
        { newStart: 11, addedLines: [11, 12], lines: [], oldStart: 10, oldLines: 0, newLines: 2 },
      ],
      addedLines: [11, 12],
    },
  ],
  changedFiles: ['src/app.ts'],
};

const plan = {
  selected: [
    { metadata: { id: 'skill-1', name: 'Skill One', phase: 'midstream', applyTo: ['src/**'] } },
  ],
  skipped: [],
};

function baseArgs(extra = {}) {
  return {
    diff,
    plan,
    phase: 'midstream',
    includeFallback: false,
    projectRules: RULES_MARKER,
    ...extra,
  };
}

/** globalThis.fetch を数える stub に差し替え、後始末まで面倒を見る。 */
async function withCountedFetch(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: init?.body ?? null });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'NO_ISSUES' } }] }),
      text: async () => '',
      headers: { get: () => null },
    };
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('既定は off である（config の既定値を pin する）', () => {
  assert.equal(defaultConfig.review.promptCompiler.mode, 'off');
  // 未指定でも off として扱えること（キー自体が無い設定も受理する）。
  assert.equal(reviewConfigSchema.parse({}).promptCompiler, undefined);
  assert.equal(reviewConfigSchema.parse({ promptCompiler: {} }).promptCompiler.mode, undefined);
});

test('schema は 3 値だけを受理し、shadow を拒否する', () => {
  for (const mode of ['off', 'observe', 'active']) {
    assert.equal(reviewConfigSchema.parse({ promptCompiler: { mode } }).promptCompiler.mode, mode);
  }
  // `shadow` は shadow-aggregate.mjs が別概念で使う語。採らない（ADR-006）。
  assert.throws(() => reviewConfigSchema.parse({ promptCompiler: { mode: 'shadow' } }));
});

test('mode=off（既定）では debug.execution.promptCompiler が付かない', async () => {
  const implicit = await generateReview(baseArgs({ dryRun: true }));
  assert.equal(implicit.debug.execution, undefined);

  const explicit = await generateReview(
    baseArgs({ dryRun: true, config: { review: { promptCompiler: { mode: 'off' } } } })
  );
  assert.equal(explicit.debug.execution, undefined);
});

test('mode=off と mode=observe で既存の返却値が一致する（挙動不変）', async () => {
  const off = await generateReview(baseArgs({ dryRun: true }));
  const observe = await generateReview(
    baseArgs({ dryRun: true, config: { review: { promptCompiler: { mode: 'observe' } } } })
  );
  assert.equal(observe.prompt, off.prompt);
  assert.equal(observe.debug.promptPreview, off.debug.promptPreview);
  assert.equal(observe.debug.llmSkipped, off.debug.llmSkipped);
  assert.deepEqual(observe.comments, off.comments);
  assert.deepEqual(observe.findings, off.findings);
});

test('mode=observe は LLM 呼び出し回数を増やさず、送るのは legacy prompt のまま', async () => {
  const config = (mode) => ({
    review: { promptCompiler: { mode } },
    model: { provider: 'openai', modelName: 'test-model' },
  });

  const offCalls = await withCountedFetch(async (calls) => {
    await generateReview(baseArgs({ apiKey: 'test-key', config: config('off') }));
    return calls;
  });
  const observeResult = {};
  const observeCalls = await withCountedFetch(async (calls) => {
    const r = await generateReview(baseArgs({ apiKey: 'test-key', config: config('observe') }));
    observeResult.value = r;
    return calls;
  });

  // 実測値で比較する。off が 1 回であることも同時に pin しておく。
  assert.equal(offCalls.length, 1);
  assert.equal(observeCalls.length, offCalls.length);

  // 送信された user message は legacy の prompt そのものである。
  const sent = JSON.parse(observeCalls[0].body);
  const userMessage = sent.messages.find((m) => m.role === 'user').content;
  const systemMessage = sent.messages.find((m) => m.role === 'system').content;
  const observed = observeResult.value.debug.execution.promptCompiler;
  const legacyText = `${systemMessage}\n${userMessage}`;
  const legacyHash = createHash('sha256').update(legacyText, 'utf8').digest('hex').slice(0, 16);
  assert.equal(observed.legacyPromptHash, legacyHash);
  assert.notEqual(observed.compiledPromptHash, observed.legacyPromptHash);
  assert.equal(observed.sentPrompt, 'legacy');
});

test('mode=active は受理するが本 PR では有効化せず、legacy を送る（#1861）', async () => {
  const calls = await withCountedFetch(async (c) => {
    const r = await generateReview(
      baseArgs({
        apiKey: 'test-key',
        config: {
          review: { promptCompiler: { mode: 'active' } },
          model: { provider: 'openai', modelName: 'test-model' },
        },
      })
    );
    c.result = r;
    return c;
  });
  const observed = calls.result.debug.execution.promptCompiler;
  assert.equal(observed.mode, 'active');
  assert.equal(observed.sentPrompt, 'legacy');
  assert.equal(observed.activeNotEnabled, true);
  const sent = JSON.parse(calls[0].body);
  const userMessage = sent.messages.find((m) => m.role === 'user').content;
  assert.equal(userMessage, calls.result.prompt);
});

test('記録するのは hash と推定長と profile の来歴だけである', async () => {
  const result = await generateReview(
    baseArgs({ dryRun: true, config: { review: { promptCompiler: { mode: 'observe' } } } })
  );
  const observed = result.debug.execution.promptCompiler;
  assert.deepEqual(Object.keys(observed).sort(), [
    'compiledPromptEstimate',
    'compiledPromptHash',
    'compilerVersion',
    'legacyPromptEstimate',
    'legacyPromptHash',
    'mode',
    'profileId',
    'profileVersion',
    'sentPrompt',
  ]);
  assert.equal(observed.mode, 'observe');
  assert.equal(observed.profileId, 'openai-review-v1');
  assert.equal(observed.profileVersion, '1');
  assert.equal(observed.compilerVersion, '1');
  assert.equal(Number.isInteger(observed.legacyPromptEstimate), true);
  assert.equal(Number.isInteger(observed.compiledPromptEstimate), true);
  assert.ok(observed.legacyPromptEstimate > 0);
  assert.ok(observed.compiledPromptEstimate > 0);
  assert.match(observed.legacyPromptHash, /^[0-9a-f]{16}$/);
  assert.match(observed.compiledPromptHash, /^[0-9a-f]{16}$/);
});

test('debug.execution に raw prompt / diff 本文が現れない', async () => {
  const result = await generateReview(
    baseArgs({ dryRun: true, config: { review: { promptCompiler: { mode: 'observe' } } } })
  );
  const serialized = JSON.stringify(result.debug.execution);
  // 目印が prompt には確かに載っていることを先に確認する（対照）。
  assert.ok(result.prompt.includes(DIFF_MARKER));
  assert.ok(result.prompt.includes(RULES_MARKER));
  assert.equal(serialized.includes(DIFF_MARKER), false);
  assert.equal(serialized.includes(RULES_MARKER), false);
  assert.equal(serialized.includes('console.log'), false);
  assert.equal(serialized.includes('You are River Review'), false);
});

test('差分が上限を超えたとき、compiled 側の diff 本文は legacy と一致する', async () => {
  const bigDiff = {
    ...diff,
    diffText: `${diffText}${'+// filler\n'.repeat(400)}`,
  };
  const maxPromptChars = 500;
  const result = await generateReview(
    baseArgs({
      diff: bigDiff,
      dryRun: true,
      maxPromptChars,
      config: { review: { promptCompiler: { mode: 'observe' } } },
    })
  );
  assert.equal(result.debug.promptTruncated, true);

  // legacy prompt が実際に載せた diff 本文を取り出し、それを IR に入れて
  // 独立に compile する。得られる hash が記録値と一致すれば、配線側の
  // 上限適用が buildPrompt と同じ結果になっている。
  const legacyDiffBody = result.prompt.slice(
    result.prompt.indexOf('\nDiff:\n') + '\nDiff:\n'.length
  );
  assert.ok(legacyDiffBody.endsWith('...[truncated]'));

  const depth = getReviewDepthConfig('medium');
  const ir = buildReviewRequest({
    subject: { phase: 'midstream', changedFiles: bigDiff.files },
    judgment: { skillIds: ['skill-1'], severity: 'normal', plan },
    context: { diff: legacyDiffBody, projectRules: RULES_MARKER },
    constraints: {
      maxFindings: depth.maxFindings,
      focusHint: depth.focusHint,
      additionalInstructions: [],
    },
    outputContract: { language: 'ja' },
    execution: { provider: 'openai', model: defaultConfig.model.modelName },
  });
  const compiled = compileReviewPrompt(ir, resolveProfile({ provider: 'openai' }));
  const expectedHash = createHash('sha256')
    .update(`${compiled.systemMessage}\n${compiled.prompt}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
  assert.equal(result.debug.execution.promptCompiler.compiledPromptHash, expectedHash);
  // 対照: legacy 側の hash は system message + user prompt から作られている。
  const legacyHash = createHash('sha256')
    .update(`${buildSystemMessage('ja')}\n${result.prompt}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
  assert.equal(result.debug.execution.promptCompiler.legacyPromptHash, legacyHash);
});
