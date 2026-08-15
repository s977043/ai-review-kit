// compileReviewPrompt（ADR-006 / #1859）のテスト。
//
// 守る性質は 3 つある。
//   1. 決定論。同じ IR と同じ profile なら常に同じ 2 本を返す。
//   2. generic は既存の本番経路（review-engine.mjs の buildPrompt）と
//      **バイト単位で同一**の user prompt を返す。
//   3. generic と openai は配置だけが違い、契約文の内容は同一である。
//
// 2 が自己整合の防波堤である。期待値を compiler 自身から作らず、切り出し前から
// 動いている buildPrompt の出力と突き合わせる（CLAUDE.md「Import the SSoT,
// never re-derive it」が求める「既存の production path との突合」）。
// 3 の契約文はこのファイルにベタ書きした literal で見る。sections.mjs から
// import して比較すると、文面を書き換えても両者が同時に動いて緑のまま通る。
import assert from 'node:assert/strict';
import test from 'node:test';

import { compileReviewPrompt } from '../src/prompt/compiler.mjs';
import { buildReviewRequest } from '../src/prompt/review-request.mjs';
import { genericProfile } from '../src/prompt/profiles/generic.mjs';
import { openaiProfile } from '../src/prompt/profiles/openai.mjs';
import { buildPrompt } from '../src/lib/review-engine.mjs';
import { getReviewDepthConfig } from '../src/lib/review-plan-generator.mjs';

/**
 * buildFindingContractSection が出す契約文の抜粋。sections.mjs を読んで
 * 手で写したもので、import していない（意図的な二重管理）。
 */
const CONTRACT_LINES = [
  '- Output each finding on its own line using the format "<file>:<line>: <message>".',
  '- Use Severity: blocker|warning|nit and Confidence: high|medium|low.',
  // maxFindings は reviewMode=medium の depthConfig 値（8）。
  '- Limit to 8 findings. If there are no issues worth mentioning, reply with "NO_ISSUES".',
  '- Keep messages brief (<=200 characters).',
];

const diffFiles = [
  { path: 'src/a.ts', hunks: [1, 2] },
  { path: 'src/b.ts', hunks: [] },
];
const plan = {
  selected: [
    { id: 's1', name: 'Skill One', phase: 'midstream', severity: 'high', modelHint: 'balanced' },
  ],
};

/** buildPrompt と IR に、同じ素材を別の形で流し込むためのケース定義。 */
const CASES = [
  {
    name: 'minimal',
    reviewMode: 'medium',
    config: {},
    parts: { diffText: 'DIFF-BODY-A' },
  },
  {
    name: 'rich context',
    reviewMode: 'medium',
    config: {
      review: {
        language: 'en',
        severity: 'strict',
        walkthrough: true,
        agentHandoff: true,
        additionalInstructions: ['Prefer small diffs'],
      },
    },
    parts: {
      diffText: 'DIFF-BODY-B',
      projectRules: 'Always add tests',
      prBody: 'Why: because. What: this.',
      relatedADRs: [{ title: 'ADR-1', path: 'docs/adr/001.md', matchReason: 'path match' }],
      riskAssessment: { escalatedFiles: ['src/a.ts'], humanReviewFiles: ['src/b.ts'] },
    },
  },
];

function irFor({ reviewMode, config, parts }, legacy) {
  const depth = getReviewDepthConfig(reviewMode);
  const review = config.review ?? {};
  return buildReviewRequest({
    subject: { phase: 'midstream', changedFiles: diffFiles },
    judgment: { skillIds: ['s1'], severity: legacy.severity, plan },
    context: {
      diff: parts.diffText,
      projectRules: parts.projectRules ?? null,
      relatedADRs: parts.relatedADRs ?? [],
      riskAssessment: parts.riskAssessment ?? null,
      prDescription: parts.prBody ?? null,
    },
    constraints: {
      maxFindings: depth.maxFindings,
      focusHint: depth.focusHint,
      walkthrough: review.walkthrough ?? false,
      agentHandoff: review.agentHandoff ?? false,
      additionalInstructions: review.additionalInstructions ?? [],
    },
    outputContract: { language: legacy.language },
    execution: { provider: 'openai', model: 'gpt-4o-mini' },
  });
}

function legacyFor({ reviewMode, config, parts }) {
  return buildPrompt({ diffFiles, plan, phase: 'midstream', reviewMode, config, ...parts });
}

for (const testCase of CASES) {
  test(`generic renderer は buildPrompt とバイト単位で同一の prompt を返す (${testCase.name})`, () => {
    const legacy = legacyFor(testCase);
    const compiled = compileReviewPrompt(irFor(testCase, legacy), genericProfile);
    assert.equal(compiled.prompt, legacy.prompt);
  });
}

test('決定論である（同じ IR と profile なら常に同じ 2 本）', () => {
  const legacy = legacyFor(CASES[1]);
  const ir = irFor(CASES[1], legacy);
  for (const profile of [genericProfile, openaiProfile]) {
    const first = compileReviewPrompt(ir, profile);
    for (let i = 0; i < 5; i += 1) {
      const again = compileReviewPrompt(ir, profile);
      assert.equal(again.prompt, first.prompt);
      assert.equal(again.systemMessage, first.systemMessage);
    }
  }
});

test('generic は契約を user prompt に置き、openai は system message へ寄せる', () => {
  const legacy = legacyFor(CASES[0]);
  const ir = irFor(CASES[0], legacy);
  const g = compileReviewPrompt(ir, genericProfile);
  const o = compileReviewPrompt(ir, openaiProfile);

  for (const line of CONTRACT_LINES) {
    assert.ok(g.prompt.includes(line), `generic prompt must contain: ${line}`);
    assert.equal(g.systemMessage.includes(line), false, `generic system must not contain: ${line}`);
    assert.ok(o.systemMessage.includes(line), `openai system must contain: ${line}`);
    assert.equal(o.prompt.includes(line), false, `openai prompt must not contain: ${line}`);
  }
  // 配置が違う以上、2 本のうち少なくとも片方は異なる文字列になる。
  assert.notEqual(g.systemMessage, o.systemMessage);
  assert.notEqual(g.prompt, o.prompt);
});

test('契約文の内容は profile 間で同一である（置き場所だけが違う）', () => {
  const legacy = legacyFor(CASES[1]);
  const ir = irFor(CASES[1], legacy);
  const g = compileReviewPrompt(ir, genericProfile);
  const o = compileReviewPrompt(ir, openaiProfile);
  // 契約節は "Review the unified git diff below" で始まる。両者からその開始点
  // 以降を切り出し、文字列として一致することを見る。
  const marker = 'Review the unified git diff below and produce concise findings.';
  const fromGeneric = g.prompt.slice(g.prompt.indexOf(marker), g.prompt.indexOf('\nDiff:\n'));
  const fromOpenAI = o.systemMessage.slice(o.systemMessage.indexOf(marker));
  assert.ok(fromGeneric.length > 500, 'contract block should be non-trivial');
  assert.equal(fromGeneric, fromOpenAI);
});

test('subject と diff はどちらの profile でも user prompt 側に残る', () => {
  const legacy = legacyFor(CASES[0]);
  const ir = irFor(CASES[0], legacy);
  for (const profile of [genericProfile, openaiProfile]) {
    const out = compileReviewPrompt(ir, profile);
    assert.ok(out.prompt.includes('Phase: midstream'));
    assert.ok(out.prompt.includes('src/a.ts'));
    assert.ok(out.prompt.includes('DIFF-BODY-A'));
    assert.equal(out.systemMessage.includes('DIFF-BODY-A'), false);
  }
});

test('未知の rendererId は例外にする（黙って generic へ落とさない）', () => {
  const legacy = legacyFor(CASES[0]);
  const ir = irFor(CASES[0], legacy);
  assert.throws(() => compileReviewPrompt(ir, { rendererId: 'nope' }), /unknown rendererId/);
  assert.throws(() => compileReviewPrompt(ir, {}), /unknown rendererId/);
  assert.throws(() => compileReviewPrompt(null, genericProfile), TypeError);
});
