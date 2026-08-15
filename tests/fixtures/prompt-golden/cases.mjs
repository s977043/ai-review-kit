// buildPrompt のバイト単位固定用ケース定義。tests/prompt-sections.test.mjs が使う。
//
// 併置の *.txt は、src/prompt/sections.mjs へ節を切り出す **前** の
// review-engine.mjs（main の d6c23cbe 時点）が出力した文字列そのものである。
// 切り出しが挙動不変であることの独立した証拠として置いている。
// 期待値を実装から再生成してはならない（自己整合になり検証が空振りする）。
const diffFiles = [
  { path: 'src/a.ts', hunks: [1, 2] },
  { path: 'src/b.ts', hunks: [] },
];
const plan = {
  selected: [
    { id: 's1', name: 'Skill One', phase: 'midstream', severity: 'high', modelHint: 'balanced' },
  ],
};

export const CASES = [
  {
    name: 'minimal',
    args: { diffText: 'diff --git a b', diffFiles, plan, phase: 'midstream' },
  },
  {
    name: 'full-ja',
    args: {
      diffText: 'diff body',
      diffFiles,
      plan,
      phase: 'upstream',
      projectRules: 'rule text',
      prBody: 'PR body text',
      relatedADRs: [{ title: 'ADR-1', path: 'docs/adr/001.md', matchReason: 'touches x' }],
      riskAssessment: { escalatedFiles: ['a.ts'], humanReviewFiles: ['b.ts'] },
      reviewMode: 'deep',
      config: {
        review: {
          language: 'ja',
          severity: 'strict',
          walkthrough: true,
          agentHandoff: true,
          additionalInstructions: ['add1', 'add2'],
        },
      },
    },
  },
  {
    name: 'full-en',
    args: {
      diffText: 'diff body',
      diffFiles,
      plan,
      phase: 'downstream',
      config: { review: { language: 'en', severity: 'relaxed', additionalInstructions: ['x'] } },
    },
  },
  {
    name: 'no-skills',
    args: {
      diffText: 'd',
      diffFiles: [],
      plan: { selected: [] },
      phase: 'midstream',
      reviewMode: 'light',
    },
  },
];
