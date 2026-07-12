import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrompt, generateReview, parseLineComments } from '../src/lib/review-engine.mjs';

const diffText = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,0 +11,2 @@
+const value = 1;
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

// --- #692 PR-D: defense-in-depth redaction at the artifact boundary ---
//
// Even after PR-C redacts repo context before it reaches the prompt, secrets
// could still slip in through other channels (project rules with a pasted
// token, additional instructions, etc.). PR-D defends the artifact boundary
// by redacting both `debug.promptPreview` and the returned `prompt` so any
// such leak is masked before leaving process memory. The LLM call itself is
// unaffected — it still sees the original prompt as it must.

test('generateReview redacts secrets in debug.promptPreview and returned prompt (#692 PR-D)', async () => {
  // Build a token at runtime so GitHub Push Protection does not flag this
  // file (same trick as tests/secret-redactor.test.mjs).
  const ghpat =
    'ghp_' + ['kZpL3xQ8mNvW', '5tJfRy2HcBd9', 'eAuQs7TgwY1i', 'OzMrPqXdLcVy'].join('').slice(0, 36);
  const result = await generateReview({
    diff,
    plan,
    phase: 'midstream',
    dryRun: true,
    includeFallback: false,
    // Inject a leaked token through `additionalInstructions`. After PR-D
    // both promptPreview and the returned prompt must mask it.
    config: {
      review: {
        additionalInstructions: ['Do not leak the token: ' + ghpat],
      },
    },
  });

  assert.match(result.debug.promptPreview, /<REDACTED:githubToken>/);
  assert.equal(/ghp_[A-Za-z0-9]{36,}/.test(result.debug.promptPreview), false);
  assert.match(result.prompt, /<REDACTED:githubToken>/);
  assert.equal(/ghp_[A-Za-z0-9]{36,}/.test(result.prompt), false);
});

test('generateReview skips the LLM in offline mode even with an API key (#1097 review)', async () => {
  const envBackup = {
    RIVER_OFFLINE: process.env.RIVER_OFFLINE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.RIVER_OFFLINE = '1';
  process.env.OPENAI_API_KEY = 'sk-test-should-not-be-called';
  try {
    const result = await generateReview({
      diff,
      plan,
      phase: 'midstream',
      dryRun: false,
      includeFallback: false,
    });
    assert.equal(result.debug.llmSkipped, 'offline (rules-only) mode enabled');
  } finally {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('generateReview runs heuristics when LLM is skipped', async () => {
  // スキルが選択されている場合、ヒューリスティックが実行される。
  // ヒューリスティックが何も検出しなかった場合、コメントは0件となる（正常な動作）。
  const result = await generateReview({
    diff,
    plan,
    phase: 'midstream',
    dryRun: true,
    includeFallback: false,
  });
  assert.equal(result.debug.llmUsed, false);
  assert.ok(result.prompt.includes('River Review'));
  // dry-runモードでもヒューリスティックが実行される
  assert.equal(result.debug.heuristicsUsed, true);
  // スキルが選択されているが検出パターンがない場合、コメントは0件
  assert.equal(result.comments.length, 0);
});

test('parseLineComments parses structured lines', () => {
  const parsed = parseLineComments('src/app.ts:12: message body\nNOISE');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].file, 'src/app.ts');
  assert.equal(parsed[0].line, 12);
  assert.equal(parsed[0].message, 'message body');
});

test('parseLineComments understands NO_ISSUES', () => {
  const parsed = parseLineComments('NO_ISSUES');
  assert.deepEqual(parsed, []);
});

test('buildPrompt injects project rules when provided', () => {
  const { prompt } = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
    projectRules: '- Use App Router',
  });
  assert.match(prompt, /Project-specific review rules/i);
  assert.match(prompt, /Use App Router/);
});

test('buildPrompt injects PR Description section when prBody provided', () => {
  const { prompt } = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
    prBody: '## Why\nFix the login bug\n## What\nGuard null user',
  });
  assert.match(prompt, /PR Description/);
  assert.match(prompt, /Fix the login bug/);
  assert.match(prompt, /PR-DESCRIPTION:0/);
});

test('buildPrompt omits PR Description section when prBody is absent or blank', () => {
  const withoutBody = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
  }).prompt;
  const blankBody = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
    prBody: '   \n  ',
  }).prompt;
  assert.doesNotMatch(withoutBody, /PR Description/);
  assert.doesNotMatch(blankBody, /PR Description/);
});

test('buildPrompt adds walkthrough/handoff sections only when enabled in config', () => {
  const off = buildPrompt({ diffText, diffFiles: diff.files, plan, phase: 'midstream' }).prompt;
  assert.doesNotMatch(off, /File Walkthrough/);
  assert.doesNotMatch(off, /Agent Handoff/);

  const on = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
    config: { review: { walkthrough: true, agentHandoff: true } },
  }).prompt;
  assert.match(on, /## File Walkthrough/);
  assert.match(on, /## Agent Handoff/);
});

test('generateReview: verifier stats exist in debug output', async () => {
  const result = await generateReview({
    diff: { diffText: '+const x = 1;', files: [], changedFiles: [] },
    plan: { selected: [] },
    phase: 'midstream',
    dryRun: true,
  });
  // verifierStats should always be present after the verifier pass
  assert.ok(result.debug.verifierStats !== undefined, 'verifierStats should exist in debug');
  assert.equal(typeof result.debug.verifierStats.total, 'number');
  assert.equal(typeof result.debug.verifierStats.verified, 'number');
  assert.equal(typeof result.debug.verifierStats.rejected, 'number');
  // verifierRejected should be an array (possibly empty)
  assert.ok(Array.isArray(result.debug.verifierRejected), 'verifierRejected should be an array');
});

test('buildPrompt includes ADR context section when relatedADRs provided', () => {
  const relatedADRs = [
    {
      title: 'ADR-001 Eval Loop',
      path: 'docs/adr/001-eval.md',
      matchReason: 'keyword: evaluation',
    },
    {
      title: 'ADR-002 Scoring',
      path: 'docs/adr/002-scoring.md',
      matchReason: 'references: src/app.ts',
    },
  ];
  const { prompt } = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
    projectRules: null,
    relatedADRs,
  });
  assert.match(prompt, /Related ADRs\/Specs/);
  assert.match(prompt, /ADR-001 Eval Loop/);
  assert.match(prompt, /ADR-002 Scoring/);
  assert.match(prompt, /設計文書との整合性/);
});

test('buildPrompt omits ADR context section when relatedADRs is empty', () => {
  const { prompt } = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
    projectRules: null,
    relatedADRs: [],
  });
  assert.ok(!prompt.includes('Related ADRs/Specs'));
});

test('buildPrompt omits ADR context section when relatedADRs is undefined', () => {
  const { prompt } = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
    projectRules: null,
  });
  assert.ok(!prompt.includes('Related ADRs/Specs'));
});

// T64: additionalInstructions が単一行 "<file>:<line>: <message>" 形式の
// 出力要求と競合し、LLM出力のパース失敗を招いていた。追加指示の適用範囲を
// message 内容に限定し、行フォーマットは常に維持する旨をプロンプトに含める。
test('buildPrompt scopes additionalInstructions to message content and preserves line format (T64)', () => {
  const { prompt } = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
    config: {
      review: {
        additionalInstructions: ['出力は要約・重大な懸念・具体的な提案の3部構成を維持する。'],
      },
    },
  });
  assert.match(prompt, /追加指示:/);
  assert.match(prompt, /<message> 内容にのみ適用/);
  assert.match(prompt, /行フォーマット自体は常に維持/);
  // format instruction line must precede the user-supplied instructions
  const formatNoteIndex = prompt.indexOf('<message> 内容にのみ適用');
  const userInstructionIndex = prompt.indexOf(
    '出力は要約・重大な懸念・具体的な提案の3部構成を維持する。'
  );
  assert.ok(formatNoteIndex > -1 && userInstructionIndex > -1);
  assert.ok(formatNoteIndex < userInstructionIndex);
});

test('buildPrompt omits the additionalInstructions format note when none are configured', () => {
  const { prompt } = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
  });
  assert.doesNotMatch(prompt, /追加指示:/);
  assert.doesNotMatch(prompt, /<message> 内容にのみ適用/);
});

test('buildPrompt switches language based on config', () => {
  const { prompt, language } = buildPrompt({
    diffText,
    diffFiles: diff.files,
    plan,
    phase: 'midstream',
    projectRules: null,
    config: { review: { language: 'en' } },
  });
  assert.equal(language, 'en');
  assert.match(prompt, /Write the <message> in English/);
});
