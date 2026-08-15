// #1868 — replay / exec 経路が generateReview の debug.execution 観測を落とさないこと。
//
// generateReview（src/lib/review-engine.mjs）は ADR-006 の Prompt Compiler 観測を
// `debug.execution.promptCompiler` へ積む。review-plan.mjs の 2 経路
// （runReviewExecReplay = replay / runReviewPlan({executeReview}) = exec）は
// artifact.debug.execution を自前の executionTrace から組むため、engine 側の
// 観測を引き継がないと artifact に残らない。欠測は「差が無かった」と区別でき
// ないので、#1860 の paired 比較が経路によって成立しなくなる。
//
// ここで守る契約は 2 つある。
//   1. engine が debug.execution に積んだキーは、両経路の artifact に残る
//   2. 経路側の trace キー（skillsExecuted 等）は engine 側の同名キーに
//      上書きされない（artifact 契約は経路側が持つ）
//
// 期待値は実装から再生成しない。観測オブジェクトはテスト内のリテラルであり、
// 実 engine を通す統合ケースではキー集合をリテラルで列挙して突き合わせる
// （tests/prompt-sections.test.mjs 冒頭にある自己整合テスト事故の教訓）。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { runReviewPlan, runReviewExecReplay } from '../src/lib/review-plan.mjs';

const fixedNow = () => '2026-01-01T00:00:00.000Z';

const sampleDiff = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  console.log('debug');
   return 42;
 }
`;

const diffPath = '/repo/diff.patch';
const resolveDiff = () => ({ diff: { exists: true, path: diffPath, source: 'cwd' } });
const okConfig = async () => ({});
const planWithSkill = () => ({
  selected: [{ metadata: { id: 'rr-test-skill', name: 'Test', phase: 'midstream' } }],
  skipped: [],
});

/** engine が積む観測を模したリテラル。実装からの再生成ではない。 */
const STUB_OBSERVATION = {
  mode: 'observe',
  sentPrompt: 'legacy',
  compilerVersion: 'stub-1',
  profileId: 'stub-profile',
  profileVersion: 1,
  legacyPromptEstimate: 111,
  compiledPromptEstimate: 222,
  legacyPromptHash: 'aaaaaaaaaaaaaaaa',
  compiledPromptHash: 'bbbbbbbbbbbbbbbb',
};

/** buildPromptCompilerObservation が observe モードで返すキーの完全集合。 */
const OBSERVATION_KEYS = [
  'compiledPromptEstimate',
  'compiledPromptHash',
  'compilerVersion',
  'legacyPromptEstimate',
  'legacyPromptHash',
  'mode',
  'profileId',
  'profileVersion',
  'sentPrompt',
];

function writePlanFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'river-1868-'));
  const planFile = path.join(dir, 'plan.json');
  writeFileSync(
    planFile,
    JSON.stringify({
      version: '1',
      timestamp: '2026-01-01T00:00:00.000Z',
      phase: 'midstream',
      status: 'ok',
      plan: {
        plannerMode: 'off',
        selectedSkills: [{ id: 'rr-test-skill', name: 'Test' }],
        skippedSkills: [],
      },
      debug: {
        execution: {
          snapshot: { fileTypes: ['typescript'], relatedADRs: [], reviewMode: 'standard' },
        },
      },
    })
  );
  return { dir, planFile };
}

/** replay 経路を 1 回動かす。generateReviewImpl 省略時は実 engine を使う。 */
async function runReplayWith(generateReviewImpl, { loadConfigImpl = okConfig } = {}) {
  const { dir, planFile } = writePlanFixture();
  try {
    return await runReviewExecReplay({
      planFile,
      executeReview: true,
      now: fixedNow,
      loadConfigImpl,
      resolveAllArtifactsImpl: resolveDiff,
      readFileImpl: async (p) => (p === diffPath ? sampleDiff : readFileSync(p, 'utf8')),
      generateReviewImpl,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** exec 経路を 1 回動かす。generateReviewImpl 省略時は実 engine を使う。 */
async function runExecWith(generateReviewImpl, { loadConfigImpl = okConfig } = {}) {
  return runReviewPlan({
    planOnly: true,
    executeReview: true,
    now: fixedNow,
    loadConfigImpl,
    resolveAllArtifactsImpl: resolveDiff,
    readFileImpl: async () => sampleDiff,
    buildExecutionPlanImpl: async () => planWithSkill(),
    loadRiskMapImpl: async () => null,
    humanApprovalAdjudicator: null,
    generateReviewImpl,
  });
}

describe('#1868 debug.execution は engine 側の観測を落とさない', () => {
  const engineWithObservation = async () => ({
    findings: [],
    debug: {
      llmUsed: false,
      heuristicsUsed: false,
      execution: { promptCompiler: { ...STUB_OBSERVATION } },
    },
  });

  test('exec 経路: promptCompiler の観測が artifact に残る', async () => {
    const artifact = await runExecWith(engineWithObservation);
    assert.deepEqual(artifact.debug.execution.promptCompiler, STUB_OBSERVATION);
    // 経路側の trace キーは従来どおり存在する。
    assert.equal(artifact.debug.execution.skillsExecuted, 1);
    assert.equal(artifact.debug.execution.findingsCount, 0);
  });

  test('replay 経路: promptCompiler の観測が artifact に残る', async () => {
    const artifact = await runReplayWith(engineWithObservation);
    assert.deepEqual(artifact.debug.execution.promptCompiler, STUB_OBSERVATION);
    assert.equal(artifact.debug.execution.skillsExecuted, 1);
    assert.equal(artifact.debug.execution.replaySnapshotUsed, true);
  });

  test('経路側の trace キーは engine 側の同名キーに上書きされない', async () => {
    const engineWithCollision = async () => ({
      findings: [],
      debug: {
        execution: {
          skillsExecuted: 999,
          findingsCount: 999,
          llmUsed: true,
          replaySnapshotUsed: false,
          promptCompiler: { ...STUB_OBSERVATION },
        },
      },
    });
    const exec = await runExecWith(engineWithCollision);
    assert.equal(exec.debug.execution.skillsExecuted, 1);
    assert.equal(exec.debug.execution.findingsCount, 0);
    assert.equal(exec.debug.execution.llmUsed, false);
    assert.deepEqual(exec.debug.execution.promptCompiler, STUB_OBSERVATION);

    const replay = await runReplayWith(engineWithCollision);
    assert.equal(replay.debug.execution.skillsExecuted, 1);
    assert.equal(replay.debug.execution.findingsCount, 0);
    assert.equal(replay.debug.execution.llmUsed, false);
    assert.equal(replay.debug.execution.replaySnapshotUsed, true);
    assert.deepEqual(replay.debug.execution.promptCompiler, STUB_OBSERVATION);
  });

  test('engine が debug.execution を持たない場合も従来どおり動く', async () => {
    const bare = async () => ({ findings: [], debug: { llmUsed: false } });
    const exec = await runExecWith(bare);
    assert.equal(exec.debug.execution.promptCompiler, undefined);
    assert.equal(exec.debug.execution.skillsExecuted, 1);

    const replay = await runReplayWith(bare);
    assert.equal(replay.debug.execution.promptCompiler, undefined);
    assert.equal(replay.debug.execution.skillsExecuted, 1);
  });
});

// 実 generateReview を通す突合。stub 経路だけでは、engine 側がキー名を変えた
// ときにテストが緑のまま欠測へ戻る（自己整合）。ここは production の engine を
// そのまま呼び、artifact に観測が現れることを確かめる。
//
// provider を openai 以外にしておくと、review-engine は skipReason
// 「provider ... is not supported yet」で LLM 呼び出しへ入らない。観測の生成は
// skipReason の判定より前なので観測だけが残り、ネットワークは使わない。
describe('#1868 実 generateReview との突合（mode=observe）', () => {
  const observeConfig = async () => ({
    review: { promptCompiler: { mode: 'observe' } },
    model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  });

  test('exec 経路: 実 engine の観測が artifact に残る', async () => {
    const artifact = await runExecWith(undefined, { loadConfigImpl: observeConfig });
    const observed = artifact.debug.execution.promptCompiler;
    assert.ok(observed, 'promptCompiler observation must reach the artifact');
    assert.deepEqual(Object.keys(observed).sort(), OBSERVATION_KEYS);
    assert.equal(observed.mode, 'observe');
    assert.equal(observed.sentPrompt, 'legacy');
    assert.equal(artifact.debug.execution.skillsExecuted, 1);
  });

  test('replay 経路: 実 engine の観測が artifact に残る', async () => {
    const artifact = await runReplayWith(undefined, { loadConfigImpl: observeConfig });
    const observed = artifact.debug.execution.promptCompiler;
    assert.ok(observed, 'promptCompiler observation must reach the artifact');
    assert.deepEqual(Object.keys(observed).sort(), OBSERVATION_KEYS);
    assert.equal(observed.mode, 'observe');
    assert.equal(artifact.debug.execution.replaySnapshotUsed, true);
  });
});
