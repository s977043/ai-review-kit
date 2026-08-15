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

/** mode=off のとき debug が持つべきキーの完全集合。 */
const OFF_DEBUG_KEYS = [
  'fallbackIncluded',
  'fileClassification',
  'findingFormat',
  'heuristicsCount',
  'heuristicsUsed',
  'llmModel',
  'llmProvider',
  'llmSkipped',
  'llmUsed',
  'promptPreview',
  'promptTruncated',
  'repoContext',
  'reviewLanguage',
  'reviewSeverity',
  'scopeStats',
  'verifierRejected',
  'verifierStats',
];

test('mode=off（既定）では debug.execution.promptCompiler が付かない', async () => {
  const implicit = await generateReview(baseArgs({ dryRun: true }));
  assert.equal(implicit.debug.execution, undefined);

  const explicit = await generateReview(
    baseArgs({ dryRun: true, config: { review: { promptCompiler: { mode: 'off' } } } })
  );
  assert.equal(explicit.debug.execution, undefined);

  // キー列挙で pin する。observe のガードの **外側** に debug を書き足す変更を
  // 検出するため。debug は src/lib/result-store.mjs 経由で artifact へそのまま
  // 永続化されるので、off の artifact が静かに変わると誰も気づかない。
  assert.deepEqual(Object.keys(implicit.debug).sort(), OFF_DEBUG_KEYS);
  assert.deepEqual(Object.keys(explicit.debug).sort(), OFF_DEBUG_KEYS);
});

test('mode=off と mode=observe で、debug.execution 以外の戻り値が完全一致する', async () => {
  const off = await generateReview(baseArgs({ dryRun: true }));
  const observe = await generateReview(
    baseArgs({ dryRun: true, config: { review: { promptCompiler: { mode: 'observe' } } } })
  );

  // 項目を列挙せず、戻り値まるごとを比べる。observe が足してよいのは
  // debug.execution だけであり、それ以外の差はすべて挙動変化である。
  const strip = (result) => {
    const { debug, ...rest } = result;
    const { execution, ...debugRest } = debug;
    void execution;
    return { ...rest, debug: debugRest };
  };
  assert.deepEqual(strip(observe), strip(off));

  // 対照: off 側には execution が無く、observe 側にはある。
  assert.equal(off.debug.execution, undefined);
  assert.ok(observe.debug.execution.promptCompiler);
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
  assert.equal(observed.sentPrompt, 'legacy');

  // 上の hash 比較だけでは足りない。送信物と記録値のどちらも「実際に送られた
  // もの」由来なので、送信物を compiled へ差し替えると期待値も一緒に動く。
  // 送信物を legacy 側の独立な観測点（返却された prompt）と直接突き合わせ、
  // さらに送信物が compiled と **一致しない** ことも見る。
  assert.equal(userMessage, observeResult.value.prompt);
  const sentHash = createHash('sha256')
    .update(`${systemMessage}\n${userMessage}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
  // この assert に力があるのは compiled と legacy がバイト単位で違う profile の
  // ときだけである。generic は legacy と同一描画なので、openai であることを先に
  // 確かめる（provider=openai を config で固定してある）。
  assert.equal(observed.profileId, 'openai-review-v1');
  assert.notEqual(observed.compiledPromptHash, observed.legacyPromptHash);
  assert.notEqual(sentHash, observed.compiledPromptHash);
  assert.equal(sentHash, observed.legacyPromptHash);
});

// active の配線（compiled を実際に送る）は tests/prompt-compiler-active.test.mjs
// が持つ。本ファイルは observe の不変条件だけを見る。

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

test('observe が debug のどこにも raw prompt / diff 本文を残さない', async () => {
  const result = await generateReview(
    baseArgs({ dryRun: true, config: { review: { promptCompiler: { mode: 'observe' } } } })
  );

  // 検査対象は debug.execution ではなく **debug 全体** である。
  // src/lib/result-store.mjs は「発生源で redact 済み」として debug をそのまま
  // artifact へ永続化するため、execution の兄弟へ原文を書いても切り詰めも
  // redact も掛からない。
  //
  // 既知の例外は debug.promptPreview だけである。これは #692 PR-D で
  // redactText を通したうえで先頭 2000 字に切り詰めた preview であり、
  // Prompt Compiler の導入より前から存在し、ADR-006 も「compiler 側の記録も
  // この既存の扱いに揃える」と明記して新たな禁止を課していない。
  const { promptPreview, ...debugWithoutKnownPreview } = result.debug;
  assert.equal(typeof promptPreview, 'string');
  const serialized = JSON.stringify(debugWithoutKnownPreview);

  // 目印が prompt には確かに載っていることを先に確認する（対照）。
  assert.ok(result.prompt.includes(DIFF_MARKER));
  assert.ok(result.prompt.includes(RULES_MARKER));

  for (const marker of [DIFF_MARKER, RULES_MARKER, 'console.log', 'You are River Review']) {
    assert.equal(serialized.includes(marker), false, `debug leaked: ${marker}`);
  }
  // execution 単体でも同じことを見る（例外の除外に紛れないようにするため）。
  const executionOnly = JSON.stringify(result.debug.execution);
  for (const marker of [DIFF_MARKER, RULES_MARKER, 'console.log', 'You are River Review']) {
    assert.equal(executionOnly.includes(marker), false, `debug.execution leaked: ${marker}`);
  }
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
