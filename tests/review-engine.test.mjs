import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrompt, generateReview, parseLineComments } from '../src/lib/review-engine.mjs';
import { formatFindingMessage } from '../src/lib/finding-factory.mjs';
import { parseUnifiedDiff } from '../src/lib/diff-processor.mjs';

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

// T64 follow-up (gemini security-high): debug.rawLlmOutput must go through the
// same redaction invariant as parsed comment messages. A secret that the LLM
// echoes back (e.g. leaked into the diff) must be masked at storage time so it
// never reaches CI logs via printDebugInfo.
test('generateReview redacts secrets in debug.rawLlmOutput (T64 follow-up)', async () => {
  // Build a token at runtime so GitHub Push Protection does not flag this
  // file (same trick as the #692 PR-D test above).
  const ghpat =
    'ghp_' + ['kZpL3xQ8mNvW', '5tJfRy2HcBd9', 'eAuQs7TgwY1i', 'OzMrPqXdLcVy'].join('').slice(0, 36);
  const originalFetch = global.fetch;
  // Unparseable output (no "<file>:<line>: <message>" line) that echoes a secret.
  const rawLlmText = `検出されたトークン ${ghpat} を確認してください。`;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: rawLlmText } }] }),
  });
  try {
    const result = await generateReview({
      diff,
      plan,
      phase: 'midstream',
      dryRun: false,
      includeFallback: false,
      apiKey: 'test-key',
    });
    assert.equal(result.debug.llmError, 'LLM output could not be parsed');
    assert.match(result.debug.rawLlmOutput, /ghp_\*\*\*REDACTED\*\*\*/);
    assert.equal(/ghp_[A-Za-z0-9]{20,}/.test(result.debug.rawLlmOutput), false);
  } finally {
    global.fetch = originalFetch;
  }
});

// Regression guard found via #1533 self-review E2E: a genuine "no issues
// found" LLM response (NO_ISSUES) must not be routed through the
// invalid/fallback branch just because it has zero findings to validate.
// Before this test the partial-drop logic misclassified an empty findings
// array as "all findings invalid" (invalidCount=0) and reported a spurious
// fallback, when the correct behavior is llmUsed=true with zero comments.
test('generateReview treats NO_ISSUES as a valid empty response, not a fallback (#1529 regression)', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'NO_ISSUES' } }] }),
  });
  try {
    const result = await generateReview({
      diff,
      plan,
      phase: 'midstream',
      dryRun: false,
      includeFallback: false,
      apiKey: 'test-key',
    });
    assert.equal(result.debug.llmUsed, true);
    assert.equal(result.debug.llmError, undefined);
    assert.equal(result.debug.droppedInvalidFindings, undefined);
    assert.deepEqual(result.comments, []);
  } finally {
    global.fetch = originalFetch;
  }
});

// #1529 E2E follow-up: a maxTokens cutoff truncated the trailing finding so it
// was missing the required Severity:/Confidence: labels. The old behavior
// invalidated the *entire* batch (invalidCount>0 -> full fallback), discarding
// otherwise-valid findings. The fix drops only the malformed finding(s) and
// keeps the valid ones, recording the drop in debug for observability.
test('generateReview drops individually-invalid findings and keeps the valid ones (#1529 partial-invalid)', async () => {
  const validLine = (n) =>
    `src/app.ts:11: ${formatFindingMessage({
      finding: `Finding number ${n}`,
      evidence: 'const value = 1;',
      impact: 'Potential issue in added code',
      fix: 'Review the added line and adjust as needed',
      severity: 'warning',
      confidence: 'medium',
    })}`;
  const validLines = Array.from({ length: 7 }, (_, i) => validLine(i + 1));
  // Truncated finding: missing the trailing "Severity:"/"Confidence:" labels,
  // simulating a maxTokens cutoff mid-response.
  const truncatedLine =
    'src/app.ts:12: Finding: truncated finding Evidence: const value = 1; Impact: cut off mid';
  const rawLlmText = [...validLines, truncatedLine].join('\n');

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: rawLlmText } }] }),
  });
  try {
    const result = await generateReview({
      diff,
      plan,
      phase: 'midstream',
      dryRun: false,
      includeFallback: false,
      apiKey: 'test-key',
    });
    assert.equal(result.debug.llmUsed, true);
    assert.equal(result.debug.droppedInvalidFindings, 1);
    assert.equal(result.debug.droppedInvalidFindingsSample.file, 'src/app.ts');
    assert.equal(result.debug.droppedInvalidFindingsSample.line, 12);
    assert.match(result.debug.llmError, /dropped 1 of 8/);
    assert.match(result.debug.llmError, /remaining 7 valid finding/);
    // The truncated finding must not leak through to findingFormat as ok:true;
    // debug.findingFormat is computed over the post-drop comment set, so it
    // should report all-valid once the malformed entry has been filtered out.
    assert.equal(result.debug.findingFormat.ok, true);
  } finally {
    global.fetch = originalFetch;
  }
});

// Fail-safe boundary: when *every* finding in the batch is malformed, the
// pipeline must still fall back (unchanged behavior) rather than continuing
// with zero valid findings.
test('generateReview falls back when all findings are invalid (fail-safe unchanged, #1529)', async () => {
  const rawLlmText = [
    'src/app.ts:11: Finding: all invalid one Evidence: const value = 1; Impact: no labels',
    'src/app.ts:12: Finding: all invalid two Evidence: const value = 1; Impact: no labels either',
  ].join('\n');

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: rawLlmText } }] }),
  });
  try {
    const result = await generateReview({
      diff,
      plan,
      phase: 'midstream',
      dryRun: false,
      includeFallback: false,
      apiKey: 'test-key',
    });
    assert.equal(result.debug.llmUsed, false);
    assert.equal(result.debug.droppedInvalidFindings, undefined);
    assert.match(result.debug.llmError, /invalidCount=2/);
    assert.match(result.debug.llmError, /Falling back/);
  } finally {
    global.fetch = originalFetch;
  }
});

// Regression (calibration run #1543): the model emitted findings as prose with
// only Severity:/Confidence: appended inline at end-of-line (no Finding:/
// Evidence:/Impact:/Fix: labels). The old validator required all six labels, so
// every finding failed and the batch collapsed to the heuristic fallback. Now
// the machine-load-bearing labels are present, so the LLM output is used
// (llmUsed=true) and the batch is no longer forced into heuristics. Per-finding
// verifier filtering downstream is a separate, non-fatal concern.
test('generateReview uses LLM findings that carry only inline Severity/Confidence (#1543)', async () => {
  const rawLlmText = [
    'src/app.ts:11: console.log leaks the value and should be removed Severity: warning Confidence: high',
    'src/app.ts:12: added line lacks a guard for the null case Severity: nit Confidence: medium',
  ].join('\n');

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: rawLlmText } }] }),
  });
  try {
    const result = await generateReview({
      diff,
      plan,
      phase: 'midstream',
      dryRun: false,
      includeFallback: false,
      apiKey: 'test-key',
    });
    assert.equal(result.debug.llmUsed, true, 'inline-only findings must not collapse the batch');
    assert.equal(result.debug.heuristicsUsed, undefined, 'no heuristic fallback should occur');
    assert.equal(result.debug.droppedInvalidFindings, undefined, 'no findings dropped as invalid');
  } finally {
    global.fetch = originalFetch;
  }
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

test('generateReview drops dist files from the LLM prompt summary and body — collectRepoDiff shape (#1543 finding 1)', async () => {
  const srcFile = {
    path: 'src/app.ts',
    newPath: 'src/app.ts',
    oldPath: 'src/app.ts',
    hunks: [{ header: '@@ -1,2 +1,2 @@', lines: ['-const value = 1;', '+const value = 2;'] }],
    addedLines: [1],
  };
  const distFile = {
    path: 'runners/github-action/dist/index.mjs',
    newPath: 'runners/github-action/dist/index.mjs',
    oldPath: 'runners/github-action/dist/index.mjs',
    hunks: [{ header: '@@ -1,2 +1,2 @@', lines: ['-const bundled = 1;', '+const bundled = 2;'] }],
    addedLines: [1],
  };
  // collectRepoDiff shape: raw `files` include dist, `filesForReview` (optimizeDiff
  // output) and optimized `diffText` exclude it.
  const collectRepoDiffShape = {
    files: [srcFile, distFile],
    filesForReview: [srcFile],
    diffText:
      'diff --git a/src/app.ts b/src/app.ts\n@@ -1,2 +1,2 @@\n-const value = 1;\n+const value = 2;',
  };
  const result = await generateReview({
    diff: collectRepoDiffShape,
    plan: { selected: [] },
    phase: 'implementation',
    dryRun: true,
  });
  // "Changed files" summary (finding 1) and Diff body must both omit the dist file.
  assert.equal(result.prompt.includes('runners/github-action/dist/index.mjs'), false);
  assert.match(result.prompt, /- src\/app\.ts/);
});

test('generateReview drops dist files in the artifact-driven path that bypasses optimizeDiff (#1543 finding 2)', async () => {
  const rawArtifactDiff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
-const value = 1;
+const value = 2;
diff --git a/runners/github-action/dist/index.mjs b/runners/github-action/dist/index.mjs
--- a/runners/github-action/dist/index.mjs
+++ b/runners/github-action/dist/index.mjs
@@ -1,2 +1,2 @@
-const bundled = 1;
+const bundled = 2;`;
  // Mirror review-plan.mjs: no filesForReview, raw diffText + raw parsed files.
  const parsed = parseUnifiedDiff(rawArtifactDiff);
  const result = await generateReview({
    diff: { diffText: rawArtifactDiff, files: parsed.files },
    plan: { selected: [] },
    phase: 'implementation',
    dryRun: true,
  });
  assert.equal(result.prompt.includes('runners/github-action/dist/index.mjs'), false);
  assert.match(result.prompt, /src\/app\.ts/);
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
