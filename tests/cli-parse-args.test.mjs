// tests/cli-parse-args.test.mjs
//
// parseArgs の純粋関数テスト。
// 子プロセスを起動せず、同期的に parse 結果を検証することで高速化する。
// 各テストは < 50ms で完走する想定。

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseArgs, isLlmlessEmptyReview } from '../src/cli.mjs';

test('isLlmlessEmptyReview: true when LLM key missing and no findings (#1067)', () => {
  assert.equal(
    isLlmlessEmptyReview({ reviewDebug: { llmSkipped: 'OPENAI_API_KEY not set' }, comments: [] }),
    true
  );
});

test('isLlmlessEmptyReview: false when there are findings', () => {
  assert.equal(
    isLlmlessEmptyReview({
      reviewDebug: { llmSkipped: 'OPENAI_API_KEY not set' },
      comments: [{ severity: 'major' }],
    }),
    false
  );
});

test('isLlmlessEmptyReview: false when LLM ran (no llmSkipped) even with 0 findings', () => {
  assert.equal(isLlmlessEmptyReview({ reviewDebug: { llmUsed: true }, comments: [] }), false);
});

test('isLlmlessEmptyReview: false for dry-run skip (not a missing key)', () => {
  assert.equal(
    isLlmlessEmptyReview({ reviewDebug: { llmSkipped: 'dry-run' }, comments: [] }),
    false
  );
});

// parseArgs は process.env を参照してデフォルト値を決めるため、
// 環境変数がテスト結果に影響しないよう一時的にクリアする。
function withCleanEnv(fn) {
  const keys = ['RIVER_PHASE', 'RIVER_PLANNER_MODE'];
  const backup = {};
  for (const key of keys) {
    backup[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (backup[key] === undefined) delete process.env[key];
      else process.env[key] = backup[key];
    }
  }
}

// -----------------------------------------------------------------------------
// Defaults and commands
// -----------------------------------------------------------------------------

test('parseArgs: empty argv leaves command null and defaults applied', () => {
  withCleanEnv(() => {
    const parsed = parseArgs([]);
    assert.equal(parsed.command, null);
    assert.equal(parsed.target, '.');
    assert.equal(parsed.phase, 'midstream');
    assert.equal(parsed.plannerMode, 'off');
    assert.equal(parsed.dryRun, false);
    assert.equal(parsed.debug, false);
    assert.equal(parsed.estimate, false);
    assert.equal(parsed.maxCost, null);
    assert.equal(parsed.output, 'text');
  });
});

test('parseArgs: run command with default target', () => {
  const parsed = parseArgs(['run']);
  assert.equal(parsed.command, 'run');
  assert.equal(parsed.target, '.');
});

test('parseArgs: run command with explicit target path', () => {
  const repoPath = path.join(os.tmpdir(), 'myrepo');
  const parsed = parseArgs(['run', repoPath]);
  assert.equal(parsed.command, 'run');
  assert.equal(parsed.target, repoPath);
});

test('parseArgs: doctor command', () => {
  const parsed = parseArgs(['doctor', '.']);
  assert.equal(parsed.command, 'doctor');
  assert.equal(parsed.target, '.');
});

test('parseArgs: eval command sets command without target', () => {
  const parsed = parseArgs(['eval']);
  assert.equal(parsed.command, 'eval');
});

test('parseArgs: skills list subcommand', () => {
  const parsed = parseArgs(['skills', 'list']);
  assert.equal(parsed.command, 'skills');
  assert.equal(parsed.skillsSubcommand, 'list');
});

test('parseArgs: skills import subcommand with --from', () => {
  const parsed = parseArgs(['skills', 'import', '--from', '/some/path']);
  assert.equal(parsed.command, 'skills');
  assert.equal(parsed.skillsSubcommand, 'import');
  assert.equal(parsed.fromPath, '/some/path');
});

test('parseArgs: skills export subcommand with --to and --include-assets', () => {
  const parsed = parseArgs(['skills', 'export', '--to', '/out', '--include-assets']);
  assert.equal(parsed.skillsSubcommand, 'export');
  assert.equal(parsed.toPath, '/out');
  assert.equal(parsed.includeAssets, true);
});

// -----------------------------------------------------------------------------
// Boolean flags
// -----------------------------------------------------------------------------

test('parseArgs: --dry-run sets dryRun true', () => {
  const parsed = parseArgs(['run', '.', '--dry-run']);
  assert.equal(parsed.dryRun, true);
});

test('parseArgs: --debug sets debug true', () => {
  const parsed = parseArgs(['run', '.', '--debug']);
  assert.equal(parsed.debug, true);
});

test('parseArgs: --estimate sets estimate true', () => {
  const parsed = parseArgs(['run', '.', '--estimate']);
  assert.equal(parsed.estimate, true);
});

test('parseArgs: --verbose sets verbose true', () => {
  const parsed = parseArgs(['eval', '--verbose']);
  assert.equal(parsed.verbose, true);
});

// -----------------------------------------------------------------------------
// Options with values
// -----------------------------------------------------------------------------

test('parseArgs: --phase downstream', () => {
  const parsed = parseArgs(['run', '.', '--phase', 'downstream']);
  assert.equal(parsed.phase, 'downstream');
});

test('parseArgs: --phase without value falls back to help', () => {
  const parsed = parseArgs(['run', '.', '--phase']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --planner order', () => {
  const parsed = parseArgs(['run', '.', '--planner', 'order']);
  assert.equal(parsed.plannerMode, 'order');
});

test('parseArgs: --planner invalid value falls back to help', () => {
  const parsed = parseArgs(['run', '.', '--planner', 'bogus']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --output markdown', () => {
  const parsed = parseArgs(['run', '.', '--output', 'markdown']);
  assert.equal(parsed.output, 'markdown');
});

test('parseArgs: --output invalid value falls back to help', () => {
  const parsed = parseArgs(['run', '.', '--output', 'xml']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --max-cost accepts positive decimal', () => {
  const parsed = parseArgs(['run', '.', '--max-cost', '0.25']);
  assert.equal(parsed.maxCost, 0.25);
});

test('parseArgs: --max-cost rejects negative value', () => {
  const parsed = parseArgs(['run', '.', '--max-cost', '-1']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --max-cost rejects non-numeric value', () => {
  const parsed = parseArgs(['run', '.', '--max-cost', 'free']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --context comma list', () => {
  const parsed = parseArgs(['run', '.', '--context', 'diff,fullFile,tests']);
  assert.deepEqual(parsed.availableContexts, ['diff', 'fullFile', 'tests']);
});

test('parseArgs: --dependency comma list', () => {
  const parsed = parseArgs(['run', '.', '--dependency', 'code_search,test_runner']);
  assert.deepEqual(parsed.availableDependencies, ['code_search', 'test_runner']);
});

test('parseArgs: --cases path for eval', () => {
  const parsed = parseArgs(['eval', '--cases', 'custom-cases.json']);
  assert.equal(parsed.fixturesCasesPath, 'custom-cases.json');
});

test('parseArgs: --base captures the diff ref', () => {
  const parsed = parseArgs(['run', '.', '--base', 'develop']);
  assert.equal(parsed.base, 'develop');
});

test('parseArgs: --base defaults to null when unset', () => {
  const parsed = parseArgs(['run', '.']);
  assert.equal(parsed.base, null);
});

test('parseArgs: --base without value falls back to help', () => {
  const parsed = parseArgs(['run', '.', '--base']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --skill-set captures the set name', () => {
  const parsed = parseArgs(['run', '.', '--skill-set', 'comprehensive']);
  assert.equal(parsed.skillSet, 'comprehensive');
});

test('parseArgs: --skill-set defaults to null when unset', () => {
  const parsed = parseArgs(['run', '.']);
  assert.equal(parsed.skillSet, null);
});

test('parseArgs: --skill-set without value falls back to help', () => {
  const parsed = parseArgs(['run', '.', '--skill-set']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --fail-on / --warn-on capture severities; --advisory-only sets flag', () => {
  const parsed = parseArgs([
    'review',
    'exec',
    '--fail-on',
    'major',
    '--warn-on',
    'minor',
    '--advisory-only',
  ]);
  assert.equal(parsed.failOn, 'major');
  assert.equal(parsed.warnOn, 'minor');
  assert.equal(parsed.advisoryOnly, true);
});

test('parseArgs: --fail-on defaults null; --advisory-only defaults false', () => {
  const parsed = parseArgs(['review', 'plan']);
  assert.equal(parsed.failOn, null);
  assert.equal(parsed.warnOn, null);
  assert.equal(parsed.advisoryOnly, false);
});

test('parseArgs: --gate sets the flag; defaults false (Epic #1347 S4)', () => {
  assert.equal(parseArgs(['run', '.', '--gate']).gate, true);
  assert.equal(parseArgs(['review', 'exec', '--gate']).gate, true);
  assert.equal(parseArgs(['run', '.']).gate, false);
});

test('parseArgs: --offline and --rules-only set offline; defaults false (#1071)', () => {
  assert.equal(parseArgs(['run', '.', '--offline']).offline, true);
  assert.equal(parseArgs(['run', '.', '--rules-only']).offline, true);
  assert.equal(parseArgs(['run', '.']).offline, false);
});

test('parseArgs: --fail-on rejects an unknown severity', () => {
  const parsed = parseArgs(['review', 'exec', '--fail-on', 'nope']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --depth accepts a valid level', () => {
  const parsed = parseArgs(['run', '.', '--depth', 'thorough']);
  assert.equal(parsed.depth, 'thorough');
});

test('parseArgs: --depth defaults to null when unset', () => {
  const parsed = parseArgs(['run', '.']);
  assert.equal(parsed.depth, null);
});

test('parseArgs: --depth rejects an unknown level', () => {
  const parsed = parseArgs(['run', '.', '--depth', 'nope']);
  assert.equal(parsed.command, 'help');
});

// -----------------------------------------------------------------------------
// skills import options
// -----------------------------------------------------------------------------

test('parseArgs: --strict sets validationMode strict', () => {
  const parsed = parseArgs(['skills', 'import', '--strict']);
  assert.equal(parsed.validationMode, 'strict');
});

test('parseArgs: --loose sets validationMode loose', () => {
  const parsed = parseArgs(['skills', 'import', '--loose']);
  assert.equal(parsed.validationMode, 'loose');
});

test('parseArgs: --source rr', () => {
  const parsed = parseArgs(['skills', 'list', '--source', 'rr']);
  assert.equal(parsed.listSource, 'rr');
});

test('parseArgs: --source invalid value falls back to help', () => {
  const parsed = parseArgs(['skills', 'list', '--source', 'wrong']);
  assert.equal(parsed.command, 'help');
});

// -----------------------------------------------------------------------------
// Help flag
// -----------------------------------------------------------------------------

test('parseArgs: -h triggers help command', () => {
  const parsed = parseArgs(['-h']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --help triggers help command', () => {
  const parsed = parseArgs(['--help']);
  assert.equal(parsed.command, 'help');
});

// -----------------------------------------------------------------------------
// Environment variable defaults
// -----------------------------------------------------------------------------

test('parseArgs: RIVER_PHASE env overrides default phase', () => {
  const backup = process.env.RIVER_PHASE;
  process.env.RIVER_PHASE = 'upstream';
  try {
    const parsed = parseArgs([]);
    assert.equal(parsed.phase, 'upstream');
  } finally {
    if (backup === undefined) delete process.env.RIVER_PHASE;
    else process.env.RIVER_PHASE = backup;
  }
});

test('parseArgs: explicit --phase overrides RIVER_PHASE env', () => {
  const backup = process.env.RIVER_PHASE;
  process.env.RIVER_PHASE = 'upstream';
  try {
    const parsed = parseArgs(['run', '.', '--phase', 'downstream']);
    assert.equal(parsed.phase, 'downstream');
  } finally {
    if (backup === undefined) delete process.env.RIVER_PHASE;
    else process.env.RIVER_PHASE = backup;
  }
});

// -----------------------------------------------------------------------------
// suppression subcommand (#687 PR-D)
// -----------------------------------------------------------------------------

test('parseArgs: suppression add captures all flags', () => {
  const parsed = parseArgs([
    'suppression',
    'add',
    '--fingerprint',
    'a'.repeat(16),
    '--feedback',
    'false_positive',
    '--rationale',
    'flagged but acceptable in this codebase',
    '--scope',
    'subsystem',
    '--severity',
    'minor',
    '--files',
    'src/auth.ts,src/login.ts',
    '--pr',
    '123',
  ]);
  assert.equal(parsed.command, 'suppression');
  assert.equal(parsed.suppressionSubcommand, 'add');
  assert.equal(parsed.suppressionFingerprint, 'a'.repeat(16));
  assert.equal(parsed.suppressionFeedbackType, 'false_positive');
  assert.equal(parsed.suppressionRationale, 'flagged but acceptable in this codebase');
  assert.equal(parsed.suppressionScope, 'subsystem');
  assert.equal(parsed.suppressionSeverity, 'minor');
  assert.deepEqual(parsed.suppressionFiles, ['src/auth.ts', 'src/login.ts']);
  assert.equal(parsed.suppressionPrNumber, 123);
});

test('parseArgs: suppression add defaults scope to file', () => {
  const parsed = parseArgs([
    'suppression',
    'add',
    '--fingerprint',
    'b'.repeat(16),
    '--feedback',
    'accepted_risk',
    '--rationale',
    'accepted',
  ]);
  assert.equal(parsed.suppressionScope, 'file');
});

test('parseArgs: suppression add silently drops non-positive --pr', () => {
  // Non-positive values are silently dropped (suppressionPrNumber stays null).
  const parsed = parseArgs([
    'suppression',
    'add',
    '--fingerprint',
    'c'.repeat(16),
    '--feedback',
    'false_positive',
    '--rationale',
    'r',
    '--pr',
    '0',
  ]);
  assert.equal(parsed.suppressionPrNumber, null);
});

// --- #802 Phase 3: review plan flags ---

test('parseArgs: review plan with --summary-file and --quiet', () => {
  const parsed = parseArgs([
    'review',
    'plan',
    '--plan-only',
    '--output-file',
    'a.json',
    '--summary-file',
    's.md',
    '--quiet',
  ]);
  assert.equal(parsed.command, 'review');
  assert.equal(parsed.reviewSubcommand, 'plan');
  assert.equal(parsed.planOnly, true);
  assert.equal(parsed.outputFile, 'a.json');
  assert.equal(parsed.summaryFile, 's.md');
  assert.equal(parsed.quiet, true);
});

test('parseArgs: --summary-file requires a value', () => {
  const parsed = parseArgs(['review', 'plan', '--summary-file']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: review plan defaults (no summary, not quiet)', () => {
  const parsed = parseArgs(['review', 'plan', '--plan-only']);
  assert.equal(parsed.summaryFile, null);
  assert.equal(parsed.quiet, false);
  assert.equal(parsed.outputExplicit, false);
  assert.equal(parsed.format, null);
  assert.equal(parsed.formatExplicit, false);
});

test('parseArgs: --output sets outputExplicit; --format sets format/formatExplicit', () => {
  const a = parseArgs(['review', 'plan', '--plan-only', '--output', 'json']);
  assert.equal(a.output, 'json');
  assert.equal(a.outputExplicit, true);
  assert.equal(a.formatExplicit, false);
  const b = parseArgs(['review', 'plan', '--plan-only', '--format', 'markdown']);
  assert.equal(b.format, 'markdown');
  assert.equal(b.formatExplicit, true);
  assert.equal(b.outputExplicit, false);
});

test('parseArgs: --format rejects unknown value', () => {
  const parsed = parseArgs(['review', 'plan', '--format', 'yaml']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: --format requires a value', () => {
  const parsed = parseArgs(['review', 'plan', '--format']);
  assert.equal(parsed.command, 'help');
});

// --- #802 Phase 3 PR-3: exec/verify parser contract ---

test('parseArgs: review exec accepts --plan/--artifact/--output/--format', () => {
  const parsed = parseArgs([
    'review',
    'exec',
    '--plan',
    './plan.json',
    '--artifact',
    'diff=./d.patch',
    '--output',
    'json',
    '--format',
    'json',
  ]);
  assert.equal(parsed.command, 'review');
  assert.equal(parsed.reviewSubcommand, 'exec');
  assert.equal(parsed.planFile, './plan.json');
  assert.deepEqual(parsed.cliArtifacts, { diff: './d.patch' });
  assert.equal(parsed.output, 'json');
  assert.equal(parsed.format, 'json');
});

test('parseArgs: review verify accepts --plan and review artifacts', () => {
  const parsed = parseArgs([
    'review',
    'verify',
    '--plan',
    './plan.json',
    '--artifact',
    'review-self=./rs.md',
  ]);
  assert.equal(parsed.reviewSubcommand, 'verify');
  assert.equal(parsed.planFile, './plan.json');
  assert.deepEqual(parsed.cliArtifacts, { 'review-self': './rs.md' });
});

test('parseArgs: --plan requires a value', () => {
  const parsed = parseArgs(['review', 'exec', '--plan']);
  assert.equal(parsed.command, 'help');
});

test('parseArgs: planFile defaults to null', () => {
  const parsed = parseArgs(['review', 'plan', '--plan-only']);
  assert.equal(parsed.planFile, null);
});

test('parseArgs: --explain sets explain flag (#1045 A3)', () => {
  const parsed = parseArgs(['run', '.', '--explain']);
  assert.equal(parsed.explain, true);
});

test('parseArgs: explain defaults to falsy without --explain', () => {
  const parsed = parseArgs(['run', '.']);
  assert.ok(!parsed.explain);
});

// --- #1471 increment A: feedback add --reviewer/--model/--reversed-by ---

test('parseArgs: feedback add parses --reviewer/--model/--reversed-by values', () => {
  const parsed = parseArgs([
    'feedback',
    'add',
    '--type',
    'out_of_scope',
    '--skill',
    'doc-hygiene',
    '--reviewer',
    'gemini',
    '--model',
    'gemini-2.5-pro',
    '--reversed-by',
    'a1b2c3d4e5f60718',
  ]);
  assert.equal(parsed.command, 'feedback');
  assert.equal(parsed.feedbackSubcommand, 'add');
  assert.equal(parsed.feedbackReviewer, 'gemini');
  assert.equal(parsed.feedbackModel, 'gemini-2.5-pro');
  assert.equal(parsed.feedbackReversedBy, 'a1b2c3d4e5f60718');
});

test('parseArgs: feedback --reviewer/--model/--reversed-by require a value', () => {
  for (const flag of ['--reviewer', '--model', '--reversed-by']) {
    const parsed = parseArgs(['feedback', 'add', '--type', 'accepted', '--skill', 's', flag]);
    assert.equal(parsed.command, 'help', `${flag} without a value falls back to help`);
  }
});

test('parseArgs: feedback --reviewer does not consume a following flag as its value', () => {
  const parsed = parseArgs([
    'feedback',
    'add',
    '--type',
    'accepted',
    '--skill',
    's',
    '--reviewer',
    '--model',
    'gpt-5',
  ]);
  assert.equal(parsed.command, 'help', 'next flag is not eaten as the value');
  assert.equal(parsed.feedbackReviewer, null);
});

// --- #1673: feedback add --run-id (#1574 P1 producer) ---

test('parseArgs: feedback add parses --run-id', () => {
  const parsed = parseArgs([
    'feedback',
    'add',
    '--type',
    'false_positive',
    '--skill',
    'secret-scanner',
    '--run-id',
    '2026-07-25T00-00-00-000Z-abc123',
  ]);
  assert.equal(parsed.command, 'feedback');
  assert.equal(parsed.feedbackSubcommand, 'add');
  assert.equal(parsed.feedbackRunId, '2026-07-25T00-00-00-000Z-abc123');
});

test('parseArgs: feedback --run-id defaults to null and requires a value', () => {
  assert.equal(
    parseArgs(['feedback', 'add', '--type', 'accepted', '--skill', 's']).feedbackRunId,
    null
  );
  const missing = parseArgs(['feedback', 'add', '--type', 'accepted', '--skill', 's', '--run-id']);
  assert.equal(missing.command, 'help', '--run-id without a value falls back to help');
});

test('parseArgs: feedback --run-id does not consume a following flag as its value', () => {
  const parsed = parseArgs([
    'feedback',
    'add',
    '--type',
    'accepted',
    '--skill',
    's',
    '--run-id',
    '--reviewer',
    'gemini',
  ]);
  assert.equal(parsed.command, 'help', 'next flag is not eaten as the value');
  assert.equal(parsed.feedbackRunId, null);
});
