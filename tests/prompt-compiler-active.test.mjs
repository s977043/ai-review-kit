// Prompt Compiler の active モード配線（ADR-006 / #1861）のテスト。
//
// #1859 は active を受理しつつ legacy を送っていた。本ファイルはその配線が
// 実際に compiled を送るようになったことを、**送信 body の実測**で押さえる。
//
// 期待値の作り方（自己整合テストにしないため）:
//   - compiled 側の期待値は、記録された hash や送信物からではなく
//     buildReviewRequest → compileReviewPrompt を**テスト側で独立に呼んで**作る。
//   - legacy 側の対照は generateReview の戻り値 `prompt`（= legacy prompt）を使う。
//   - 「送った」と「送っていない」の両方を見る。compiled と一致することだけを
//     見ると、legacy と compiled が偶然一致する profile で無力になる。
//
// LLM 呼び出しの計測は globalThis.fetch を差し替えて数える
// （tests/prompt-compiler-observe.test.mjs と同じ手法）。
import assert from 'node:assert/strict';
import test from 'node:test';

import { generateReview } from '../src/lib/review-engine.mjs';
import { buildRunRecord } from '../src/lib/result-store.mjs';
import { buildPromptComparison } from '../src/lib/prompt-compiler-paired.mjs';
import { compileReviewPrompt } from '../src/prompt/compiler.mjs';
import { buildReviewRequest } from '../src/prompt/review-request.mjs';
import { resolveProfile } from '../src/prompt/profile-resolver.mjs';
import { getReviewDepthConfig } from '../src/lib/review-plan-generator.mjs';
import { buildSystemMessage } from '../src/prompt/sections.mjs';

/** debug に現れてはならない、diff / rules に仕込む目印。 */
const DIFF_MARKER = 'ZZ_ACTIVE_DIFF_MARKER_4b7e';
const RULES_MARKER = 'ZZ_ACTIVE_RULES_MARKER_1d9c';

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

const modelConfig = (mode) => ({
  review: { promptCompiler: { mode } },
  model: { provider: 'openai', modelName: 'test-model' },
});

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

/**
 * テスト側で独立に compiled 側の 2 本を作る。review-engine の記録も送信物も
 * 参照しない。ここが本ファイルの期待値の出所である。
 */
function compileExpected({ severity, language }) {
  const depth = getReviewDepthConfig('medium');
  const ir = buildReviewRequest({
    subject: { phase: 'midstream', changedFiles: diff.files },
    judgment: { skillIds: ['skill-1'], severity, plan },
    context: { diff: diffText, diffTruncated: false, projectRules: RULES_MARKER },
    constraints: {
      maxFindings: depth.maxFindings,
      focusHint: depth.focusHint,
      walkthrough: false,
      agentHandoff: false,
    },
    outputContract: { language },
    execution: { provider: 'openai', model: 'test-model' },
  });
  return compileReviewPrompt(ir, resolveProfile({ provider: 'openai', model: 'test-model' }));
}

/** 1 回 generateReview を走らせ、送信された system / user を取り出す。 */
async function runAndCaptureSent(mode) {
  const box = {};
  const calls = await withCountedFetch(async (c) => {
    box.result = await generateReview(baseArgs({ apiKey: 'test-key', config: modelConfig(mode) }));
    return c;
  });
  assert.equal(calls.length, 1, 'LLM 呼び出しは 1 回だけである');
  const sent = JSON.parse(calls[0].body);
  return {
    result: box.result,
    userMessage: sent.messages.find((m) => m.role === 'user').content,
    systemMessage: sent.messages.find((m) => m.role === 'system').content,
    callCount: calls.length,
  };
}

test('mode=active は compiled prompt を provider へ送る（送信 body の実測）', async () => {
  const { result, userMessage, systemMessage } = await runAndCaptureSent('active');
  const expected = compileExpected({
    severity: result.debug.reviewSeverity,
    language: result.debug.reviewLanguage,
  });

  // 独立に compile した 2 本と、実際に送られた 2 本がバイト一致する。
  assert.equal(systemMessage, expected.systemMessage);
  assert.equal(userMessage, expected.prompt);

  // 対照: legacy 側とは一致しない。openai profile は出力契約節を system 側へ
  // 寄せるので、両者はバイト単位で異なる（一致するなら配線が効いていない）。
  assert.notEqual(userMessage, result.prompt);
  assert.notEqual(systemMessage, buildSystemMessage(result.debug.reviewLanguage));
});

test('mode=observe は legacy を送り続ける（active との差を同一入力で見る）', async () => {
  const observe = await runAndCaptureSent('observe');
  const active = await runAndCaptureSent('active');

  // observe 側は legacy そのもの。
  assert.equal(observe.userMessage, observe.result.prompt);
  assert.equal(observe.systemMessage, buildSystemMessage(observe.result.debug.reviewLanguage));
  // 同じ入力で mode だけを変えると送信物が変わる。
  assert.notEqual(active.userMessage, observe.userMessage);
  assert.notEqual(active.systemMessage, observe.systemMessage);
  assert.equal(observe.callCount, active.callCount);
});

test('mode=off も legacy を送り、呼び出し回数は active と同じである', async () => {
  const off = await runAndCaptureSent('off');
  assert.equal(off.userMessage, off.result.prompt);
  assert.equal(off.systemMessage, buildSystemMessage(off.result.debug.reviewLanguage));
  assert.equal(off.result.debug.execution, undefined);
});

test('active の観測は sentPrompt=compiled で、キーは observe と同じ 9 個である', async () => {
  const result = await generateReview(baseArgs({ dryRun: true, config: modelConfig('active') }));
  const observed = result.debug.execution.promptCompiler;
  assert.equal(observed.mode, 'active');
  assert.equal(observed.sentPrompt, 'compiled');
  // #1859 の「まだ配線していない」印は取り除く。配線後に残すと事実に反する。
  assert.equal('activeNotEnabled' in observed, false);
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
});

test('active でも debug に原文（prompt 本体・diff 本文）を残さない', async () => {
  const result = await generateReview(baseArgs({ dryRun: true, config: modelConfig('active') }));

  // 既知の例外は debug.promptPreview だけである（#692 PR-D の redact 済み
  // preview。ADR-006 はこの既存の扱いに揃えると明記している）。
  const { promptPreview, ...debugWithoutKnownPreview } = result.debug;
  assert.equal(typeof promptPreview, 'string');

  // 対照: 目印は prompt には確かに載っている。
  assert.ok(result.prompt.includes(DIFF_MARKER));
  assert.ok(result.prompt.includes(RULES_MARKER));

  const serialized = JSON.stringify(debugWithoutKnownPreview);
  for (const marker of [DIFF_MARKER, RULES_MARKER, 'console.log', 'You are River Review']) {
    assert.equal(serialized.includes(marker), false, `debug leaked: ${marker}`);
  }
  const executionOnly = JSON.stringify(result.debug.execution);
  for (const marker of [DIFF_MARKER, RULES_MARKER, 'console.log', 'You are River Review']) {
    assert.equal(executionOnly.includes(marker), false, `debug.execution leaked: ${marker}`);
  }
});

test('mode=off と mode=active で、debug.execution 以外の戻り値が完全一致する', async () => {
  const off = await generateReview(baseArgs({ dryRun: true, config: modelConfig('off') }));
  const active = await generateReview(baseArgs({ dryRun: true, config: modelConfig('active') }));
  const strip = (result) => {
    const { debug, ...rest } = result;
    const { execution, ...debugRest } = debug;
    void execution;
    return { ...rest, debug: debugRest };
  };
  assert.deepEqual(strip(active), strip(off));
  assert.equal(off.debug.execution, undefined);
  assert.ok(active.debug.execution.promptCompiler);
});

test('active の run は evolve prompt-compare が受け取らない（#1860 の安全弁）', async () => {
  // 手で書いた観測ではなく、本番経路（generateReview → buildRunRecord）が
  // 作った active の run で確かめる。#1860 の受け入れ条件は緩めない。
  const review = await generateReview(baseArgs({ dryRun: true, config: modelConfig('active') }));
  const record = buildRunRecord(
    {
      repoRoot: '/workspace/repo-under-review',
      mergeBase: 'base-active',
      findings: [],
      changedFiles: ['src/app.ts'],
      reviewDebug: review.debug,
      commitSha: 'a'.repeat(40),
    },
    { phase: 'midstream', runId: 'run-active' }
  );
  assert.equal(record.debug.execution.promptCompiler.sentPrompt, 'compiled');
  assert.throws(
    () => buildPromptComparison({ runRecords: [record], now: new Date('2026-08-15T00:00:00Z') }),
    { name: 'PromptComparisonError', message: /#1861/ }
  );
});
