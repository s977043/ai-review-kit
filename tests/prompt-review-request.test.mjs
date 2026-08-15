// Review Request IR（ADR-006 / #1859）の契約テスト。
//
// 守る性質は 2 つある。
//   1. IR が凍結されていること。renderer / profile が判断側の値を書き換えられない。
//   2. モデル依存の値が judgment / constraints に混ざらないこと。provider・model・
//      modelHint は execution 側の持ち物である。
//
// 期待値は実装から再生成しない。キー集合はこのファイルにベタ書きしてあり、
// IR の形を変えたらここも直す必要がある（自己整合を避けるための意図的な二重管理）。
import assert from 'node:assert/strict';
import test from 'node:test';

import { REVIEW_REQUEST_IR_VERSION, buildReviewRequest } from '../src/prompt/review-request.mjs';

/** ADR-006「Review Request IR」の節が挙げる 6 要素と、IR 自身の version。 */
const TOP_LEVEL_KEYS = [
  'version',
  'subject',
  'judgment',
  'context',
  'constraints',
  'outputContract',
  'execution',
];

/** 判断側が持ってよいキー。モデル依存の値をここへ足さない。 */
const JUDGMENT_KEYS = ['skillIds', 'severity', 'plan'];
const CONSTRAINT_KEYS = [
  'maxFindings',
  'focusHint',
  'walkthrough',
  'agentHandoff',
  'additionalInstructions',
];

/** モデル依存の値の名前。judgment / constraints に現れてはならない。 */
const MODEL_DEPENDENT_KEYS = ['provider', 'model', 'modelHint', 'profile', 'profileId', 'endpoint'];

function sampleIR() {
  return buildReviewRequest({
    subject: { phase: 'midstream', changedFiles: [{ path: 'a.ts', hunks: [] }] },
    judgment: { skillIds: ['s1'], severity: 'normal', plan: { selected: [] } },
    context: { diff: 'DIFF', projectRules: 'rule', relatedADRs: [{ title: 't', path: 'p' }] },
    constraints: { maxFindings: 7, focusHint: 'hint', additionalInstructions: ['x'] },
    outputContract: { language: 'ja' },
    execution: { provider: 'openai', model: 'gpt-4o-mini', modelHint: 'balanced' },
  });
}

test('IR は宣言された 7 キーだけを持つ', () => {
  assert.deepEqual(Object.keys(sampleIR()).sort(), [...TOP_LEVEL_KEYS].sort());
  assert.equal(sampleIR().version, REVIEW_REQUEST_IR_VERSION);
});

test('IR は深く凍結されている（ネストした判断側の値を書き換えられない）', () => {
  const ir = sampleIR();
  assert.equal(Object.isFrozen(ir), true);
  assert.equal(Object.isFrozen(ir.judgment), true);
  assert.equal(Object.isFrozen(ir.constraints), true);
  assert.equal(Object.isFrozen(ir.context), true);
  // ESM は strict mode なので、凍結オブジェクトへの代入は TypeError になる。
  assert.throws(() => {
    ir.judgment.severity = 'strict';
  }, TypeError);
  assert.throws(() => {
    ir.constraints.maxFindings = 999;
  }, TypeError);
  assert.equal(ir.judgment.severity, 'normal');
  assert.equal(ir.constraints.maxFindings, 7);
});

test('配列も凍結されている（push で判断側の値を増やせない）', () => {
  const ir = sampleIR();
  assert.equal(Object.isFrozen(ir.judgment.skillIds), true);
  assert.equal(Object.isFrozen(ir.constraints.additionalInstructions), true);
  assert.throws(() => ir.judgment.skillIds.push('s2'), TypeError);
  assert.equal(ir.judgment.skillIds.length, 1);
});

test('judgment / constraints はモデル依存の値を持たない', () => {
  const ir = sampleIR();
  assert.deepEqual(Object.keys(ir.judgment).sort(), [...JUDGMENT_KEYS].sort());
  assert.deepEqual(Object.keys(ir.constraints).sort(), [...CONSTRAINT_KEYS].sort());
  for (const key of MODEL_DEPENDENT_KEYS) {
    assert.equal(key in ir.judgment, false, `judgment must not carry ${key}`);
    assert.equal(key in ir.constraints, false, `constraints must not carry ${key}`);
  }
});

test('モデル依存の値は execution 側にだけ入る', () => {
  const ir = sampleIR();
  assert.deepEqual(ir.execution, {
    provider: 'openai',
    model: 'gpt-4o-mini',
    modelHint: 'balanced',
  });
});

test('未指定の入力に既定値を発明しない（null / 空配列で受ける）', () => {
  const ir = buildReviewRequest({});
  assert.equal(ir.judgment.severity, null);
  assert.equal(ir.constraints.maxFindings, null);
  assert.equal(ir.outputContract.language, null);
  assert.equal(ir.execution.provider, null);
  assert.deepEqual(ir.judgment.skillIds, []);
  assert.deepEqual(ir.subject.changedFiles, []);
});
