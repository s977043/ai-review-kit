import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';

import {
  buildFeedbackEntry,
  appendFeedbackEntry,
  listFeedbackEntries,
  buildFeedbackScaffold,
  feedbackFilePath,
  FeedbackError,
  FEEDBACK_TYPES,
  FEEDBACK_TRIGGERS,
} from '../src/lib/feedback.mjs';
// The run-id resolvers are imported (never re-derived) so the producer is
// checked against the SAME code path `river evolve aggregate` uses (#1673).
import { deriveFeedbackReviewRunId, deriveReviewRunId } from '../src/lib/shadow-aggregate.mjs';
import { applyFeedback } from '../scripts/apply-feedback.mjs';
import { createTempDirAsync } from './helpers/temp-dir.mjs';
import { createTempGitRepo } from './helpers/temp-repo.mjs';
import { runCliInProcess } from './helpers/cli.mjs';

const NOW = new Date('2026-06-10T03:00:00Z');

function entryInput(overrides = {}) {
  return {
    feedbackType: 'false_positive',
    skillId: 'typescript-strict',
    findingFingerprint: 'a1b2c3d4e5f60718',
    evidence: 'strict 設定済みの tsconfig を誤検出',
    pr: 1100,
    now: NOW,
    ...overrides,
  };
}

test('buildFeedbackEntry produces the documented schema', () => {
  const entry = buildFeedbackEntry(entryInput());
  assert.deepEqual(entry, {
    timestamp: '2026-06-10T03:00:00.000Z',
    trigger: 'pr-comment',
    feedbackType: 'false_positive',
    skillId: 'typescript-strict',
    findingFingerprint: 'a1b2c3d4e5f60718',
    evidence: 'strict 設定済みの tsconfig を誤検出',
    pr: 1100,
  });
});

test('fix-pr is an accepted feedback trigger for post-merge learning', () => {
  assert.ok(FEEDBACK_TRIGGERS.includes('fix-pr'));
  const entry = buildFeedbackEntry(
    entryInput({
      trigger: 'fix-pr',
      feedbackType: 'missed_issue',
      evidence: '修正PRで元PRのレビュー漏れが判明した',
    })
  );
  assert.equal(entry.trigger, 'fix-pr');
  assert.equal(entry.feedbackType, 'missed_issue');
});

test('buildFeedbackEntry rejects unknown type, trigger, and bad fingerprint', () => {
  assert.throws(() => buildFeedbackEntry(entryInput({ feedbackType: 'nope' })), FeedbackError);
  assert.throws(() => buildFeedbackEntry(entryInput({ trigger: 'slack' })), FeedbackError);
  assert.throws(() => buildFeedbackEntry(entryInput({ findingFingerprint: 'XYZ' })), FeedbackError);
  assert.throws(() => buildFeedbackEntry(entryInput({ skillId: '  ' })), FeedbackError);
});

test('appendFeedbackEntry writes monthly JSONL and listFeedbackEntries reads it back', async () => {
  const repoRoot = await createTempDirAsync({ prefix: 'feedback-' });
  const entry = buildFeedbackEntry(entryInput());
  const filePath = await appendFeedbackEntry(entry, { repoRoot });
  assert.equal(filePath, feedbackFilePath(repoRoot, entry.timestamp));
  assert.ok(filePath.endsWith(path.join('.river', 'feedback', '2026-06.jsonl')));

  await appendFeedbackEntry(buildFeedbackEntry(entryInput({ feedbackType: 'missed_issue' })), {
    repoRoot,
  });
  const entries = await listFeedbackEntries({ repoRoot });
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.feedbackType),
    ['false_positive', 'missed_issue']
  );
});

test('listFeedbackEntries skips corrupt lines with a warning and filters by month', async () => {
  const repoRoot = await createTempDirAsync({ prefix: 'feedback-' });
  const dir = path.join(repoRoot, '.river', 'feedback');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '2026-05.jsonl'), '{"feedbackType":"accepted"}\nnot-json\n');
  await fs.writeFile(path.join(dir, '2026-06.jsonl'), '{"feedbackType":"unclear"}\n');
  const warnings = [];
  const all = await listFeedbackEntries({ repoRoot, warn: (m) => warnings.push(m) });
  assert.equal(all.length, 2);
  assert.equal(warnings.length, 1);
  const may = await listFeedbackEntries({ repoRoot, month: '2026-05' });
  assert.equal(may.length, 1);
});

test('buildFeedbackScaffold covers every feedback type with verify commands', () => {
  for (const feedbackType of FEEDBACK_TYPES) {
    const scaffold = buildFeedbackScaffold(
      buildFeedbackEntry(entryInput({ feedbackType, findingFingerprint: null }))
    );
    assert.ok(scaffold.action, `${feedbackType} has an action`);
    assert.ok(scaffold.verify.length > 0, `${feedbackType} has verify commands`);
  }
});

test('false_positive scaffold yields a guard fixture stub, accepted_risk yields a suppression command', () => {
  const guard = buildFeedbackScaffold(buildFeedbackEntry(entryInput()));
  assert.match(guard.fixtureStub.suggestedPath, /-guard\.md$/);
  assert.match(guard.fixtureStub.content, /expectNoFindings: true/);

  const risk = buildFeedbackScaffold(
    buildFeedbackEntry(entryInput({ feedbackType: 'accepted_risk' }))
  );
  assert.match(risk.command, /river suppression add --fingerprint a1b2c3d4e5f60718/);
  assert.match(risk.command, /--feedback accepted_risk/);
});

test('applyFeedback --write creates fixture stubs once and is idempotent', async () => {
  const repoRoot = await createTempDirAsync({ prefix: 'feedback-apply-' });
  await appendFeedbackEntry(buildFeedbackEntry(entryInput()), { repoRoot });
  const logs = [];
  const first = await applyFeedback({ root: repoRoot, write: true, log: (m) => logs.push(m) });
  assert.equal(first.entries, 1);
  assert.equal(first.written.length, 1);
  const stub = await fs.readFile(path.join(repoRoot, first.written[0]), 'utf8');
  assert.match(stub, /Guard fixture/);

  const second = await applyFeedback({ root: repoRoot, write: true, log: () => {} });
  assert.equal(second.written.length, 0, 'existing stub is not overwritten');
});

test('applyFeedback without entries reports cleanly', async () => {
  const repoRoot = await createTempDirAsync({ prefix: 'feedback-empty-' });
  const result = await applyFeedback({ root: repoRoot, log: () => {} });
  assert.equal(result.entries, 0);
});

// --- #1471 increment A: reviewer / model / reversedBy + out_of_scope --------

test('out_of_scope is an accepted feedbackType with a no-change scaffold', () => {
  assert.ok(FEEDBACK_TYPES.includes('out_of_scope'));
  const entry = buildFeedbackEntry(
    entryInput({ feedbackType: 'out_of_scope', findingFingerprint: null })
  );
  assert.equal(entry.feedbackType, 'out_of_scope');
  const scaffold = buildFeedbackScaffold(entry);
  assert.match(scaffold.action, /no repository change/);
  assert.ok(scaffold.verify.length > 0);
});

test('optional reviewer/model/reversedBy are stored when provided', () => {
  const entry = buildFeedbackEntry(
    entryInput({
      reviewer: 'gemini',
      model: 'gemini-2.5-pro',
      reversedBy: 'a1b2c3d4e5f60718',
    })
  );
  assert.equal(entry.reviewer, 'gemini');
  assert.equal(entry.model, 'gemini-2.5-pro');
  assert.equal(entry.reversedBy, 'a1b2c3d4e5f60718');
});

test('optional fields are omitted (not null) when absent — backward compatible shape', () => {
  const entry = buildFeedbackEntry(entryInput());
  assert.ok(!('reviewer' in entry), 'reviewer key absent when not provided');
  assert.ok(!('model' in entry), 'model key absent when not provided');
  assert.ok(!('reversedBy' in entry), 'reversedBy key absent when not provided');
  // Empty/whitespace strings normalize away too.
  const trimmed = buildFeedbackEntry(entryInput({ reviewer: '  ', model: '' }));
  assert.ok(!('reviewer' in trimmed));
  assert.ok(!('model' in trimmed));
});

test('optional fields reject non-string values', () => {
  assert.throws(() => buildFeedbackEntry(entryInput({ reviewer: 42 })), FeedbackError);
  assert.throws(() => buildFeedbackEntry(entryInput({ model: {} })), FeedbackError);
  assert.throws(() => buildFeedbackEntry(entryInput({ reversedBy: [] })), FeedbackError);
});

test('reversedBy linkage survives append-only JSONL round-trip', async () => {
  const repoRoot = await createTempDirAsync({ prefix: 'feedback-reversed-' });
  // Original decision: skip-scope for a finding.
  const original = buildFeedbackEntry(
    entryInput({
      feedbackType: 'out_of_scope',
      reviewer: 'gemini',
      findingFingerprint: 'a1b2c3d4e5f60718',
      evidence: 'skip-scope: realpathSync 統一は別PRで',
    })
  );
  await appendFeedbackEntry(original, { repoRoot });
  // Later reversal: a new entry references the prior one instead of mutating it.
  const reversal = buildFeedbackEntry(
    entryInput({
      feedbackType: 'accepted',
      reviewer: 'gemini',
      findingFingerprint: 'a1b2c3d4e5f60718',
      reversedBy: 'a1b2c3d4e5f60718',
      evidence: 'reversed: ENOENT クラッシュが実在した',
      now: new Date('2026-06-11T03:00:00Z'),
    })
  );
  await appendFeedbackEntry(reversal, { repoRoot });

  const entries = await listFeedbackEntries({ repoRoot });
  assert.equal(entries.length, 2, 'both entries retained (append-only, no mutation)');
  assert.equal(entries[0].feedbackType, 'out_of_scope');
  assert.ok(!('reversedBy' in entries[0]), 'original is untouched');
  assert.equal(entries[1].feedbackType, 'accepted');
  assert.equal(entries[1].reversedBy, 'a1b2c3d4e5f60718');
});

// --- #1673 (#1574 P1 producer): optional reviewRunId -> `review_run_id` ---

test('reviewRunId is written as the snake_case review_run_id join key', () => {
  const entry = buildFeedbackEntry(entryInput({ reviewRunId: '2026-07-25T00-00-00-000Z-abc123' }));
  assert.equal(entry.review_run_id, '2026-07-25T00-00-00-000Z-abc123');
  // camelCase would silently be a second, unresolved key: deriveFeedbackReviewRunId
  // reads review_run_id first, and shadow-aggregate.schema.json requires that name.
  assert.ok(!('reviewRunId' in entry), 'the camelCase input name is not persisted');
  // The value is resolvable by the real consumer, not just by this test.
  assert.equal(deriveFeedbackReviewRunId(entry), '2026-07-25T00-00-00-000Z-abc123');
});

test('omitting reviewRunId leaves the entry byte-identical to the pre-#1673 shape', () => {
  const entry = buildFeedbackEntry(entryInput());
  assert.ok(!('review_run_id' in entry), 'no key is added when the option is omitted');
  // Byte-level, not just deepEqual: the JSONL line appended to
  // .river/feedback/<YYYY-MM>.jsonl must be unchanged for existing callers.
  assert.equal(
    JSON.stringify(entry),
    '{"timestamp":"2026-06-10T03:00:00.000Z","trigger":"pr-comment",' +
      '"feedbackType":"false_positive","skillId":"typescript-strict",' +
      '"findingFingerprint":"a1b2c3d4e5f60718",' +
      '"evidence":"strict 設定済みの tsconfig を誤検出","pr":1100}'
  );
  // A legacy entry stays unjoined: there is deliberately no fallback here.
  assert.equal(deriveFeedbackReviewRunId(entry), null);
});

test('reviewRunId normalizes like the other optional strings', () => {
  assert.ok(!('review_run_id' in buildFeedbackEntry(entryInput({ reviewRunId: '   ' }))));
  assert.ok(!('review_run_id' in buildFeedbackEntry(entryInput({ reviewRunId: '' }))));
  assert.equal(buildFeedbackEntry(entryInput({ reviewRunId: ' run-1 ' })).review_run_id, 'run-1');
  assert.throws(() => buildFeedbackEntry(entryInput({ reviewRunId: 42 })), FeedbackError);
});

test('review_run_id survives the JSONL round-trip and resolves to the run record id', async () => {
  const repoRoot = await createTempDirAsync({ prefix: 'feedback-run-id-' });
  const runId = '2026-06-10T03-00-00-000Z-deadbe';
  await appendFeedbackEntry(buildFeedbackEntry(entryInput({ reviewRunId: runId })), { repoRoot });

  const [entry] = await listFeedbackEntries({ repoRoot });
  // Cross-check against the EXISTING resolvers on both sides of the join
  // instead of re-deriving the id here (CLAUDE.md "Import the SSoT").
  assert.equal(deriveFeedbackReviewRunId(entry), deriveReviewRunId({ runId }));
});

test('`river feedback add --run-id` writes review_run_id into the JSONL', async (t) => {
  const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-cli-run-id-' });
  t.after(cleanup);
  const runId = '2026-07-25T00-00-00-000Z-abc123';
  const res = await runCliInProcess(
    [
      'feedback',
      'add',
      '--type',
      'false_positive',
      '--skill',
      'secret-scanner',
      '--fingerprint',
      'a1b2c3d4e5f60718',
      '--pr',
      '1673',
      '--run-id',
      runId,
    ],
    { cwd: dir }
  );
  assert.equal(res.code, 0, res.stderr);
  const written = /written to: (.+)/.exec(res.stdout)?.[1];
  assert.ok(written, `no target path in stdout: ${res.stdout}`);
  const [line] = (await fs.readFile(written.trim(), 'utf8')).trim().split('\n');
  const entry = JSON.parse(line);
  assert.equal(entry.review_run_id, runId);
  assert.equal(deriveFeedbackReviewRunId(entry), runId);
});

test('`river feedback add` without --run-id writes no review_run_id key', async (t) => {
  const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-cli-no-run-id-' });
  t.after(cleanup);
  const res = await runCliInProcess(
    ['feedback', 'add', '--type', 'accepted', '--skill', 'secret-scanner'],
    { cwd: dir }
  );
  assert.equal(res.code, 0, res.stderr);
  const written = /written to: (.+)/.exec(res.stdout)?.[1];
  assert.ok(written, `no target path in stdout: ${res.stdout}`);
  const [line] = (await fs.readFile(written.trim(), 'utf8')).trim().split('\n');
  assert.ok(!('review_run_id' in JSON.parse(line)), 'legacy CLI invocations are unchanged');
});

test('`river feedback add --run-id=<id>` writes the id instead of dropping it', async (t) => {
  const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-cli-run-id-eq-' });
  t.after(cleanup);
  const runId = '2026-07-25T00-00-00-000Z-abc123';
  const res = await runCliInProcess(
    [
      'feedback',
      'add',
      '--type',
      'false_positive',
      '--skill',
      'secret-scanner',
      `--run-id=${runId}`,
    ],
    { cwd: dir }
  );
  assert.equal(res.code, 0, res.stderr);
  const written = /written to: (.+)/.exec(res.stdout)?.[1];
  assert.ok(written, `no target path in stdout: ${res.stdout}`);
  const [line] = (await fs.readFile(written.trim(), 'utf8')).trim().split('\n');
  // The regression: this used to exit 0 having written an entry with no
  // review_run_id at all, which only surfaced as joinedFeedbackCount 0.
  assert.equal(JSON.parse(line).review_run_id, runId);
});

test('`river feedback add --run-id "   "` reports an error and writes nothing', async (t) => {
  const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-cli-run-id-blank-' });
  t.after(cleanup);
  const res = await runCliInProcess(
    ['feedback', 'add', '--type', 'accepted', '--skill', 'secret-scanner', '--run-id', '   '],
    { cwd: dir }
  );
  // Same shape as the sibling options (--reviewer etc.): the error goes to
  // stderr and the run stops as a usage error (#1709 Slice 2: exit 1).
  assert.equal(res.code, 1);
  assert.match(res.stderr, /--run-id option requires a value/);
  assert.doesNotMatch(res.stdout, /Feedback recorded/);
  // The regression this pins: a whitespace-only id used to pass the truthiness
  // check, get nulled by normalizeOptionalString, and append an entry with no
  // review_run_id. Nothing may be written at all now.
  await assert.rejects(() => fs.readdir(path.join(dir, '.river', 'feedback')));
});

// --- #1717: `feedback add` validates option values before writing anything ---
//
// The regression these pin: an invalid `--pr` value was dropped in silence and
// the entry was STILL written with pr:null (exit 0), while parseInt quietly
// kept the numeric prefix of `1.5` / `12abc` and recorded a DIFFERENT pr than
// the one that was typed. `pr` is one half of the occurrence key
// (review_run_id, pr), so a null or wrong value skews the repetition
// denominator `river evolve aggregate` computes. A missing value additionally
// consumed the FOLLOWING flag as its own value, so `--pr --evidence x` lost
// both options at once. Same class as #1681 (--run-id) / #1658 (--threshold).

const FEEDBACK_ADD_BASE = ['feedback', 'add', '--type', 'accepted', '--skill', 'secret-scanner'];

const assertNothingWritten = (dir, label) =>
  assert.rejects(() => fs.readdir(path.join(dir, '.river', 'feedback')), undefined, label);

test('`river feedback add --pr` rejects every non positive-integer value', async (t) => {
  const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-cli-pr-invalid-' });
  t.after(cleanup);
  const rejected = [
    ['abc', 'non-numeric'],
    ['0', 'zero'],
    ['-5', 'negative'],
    ['1.5', 'decimal — parseInt used to keep the 1'],
    ['12abc', 'numeric prefix — parseInt used to keep the 12'],
    ['', 'empty string'],
    ['   ', 'whitespace only'],
  ];
  for (const [value, label] of rejected) {
    const res = await runCliInProcess([...FEEDBACK_ADD_BASE, '--pr', value], { cwd: dir });
    assert.match(res.stderr, /--pr option requires a positive integer/, label);
    assert.doesNotMatch(res.stdout, /Feedback recorded/, label);
    await assertNothingWritten(dir, label);
  }
});

test('`river feedback add --pr` with no value writes nothing and keeps the next flag', async (t) => {
  const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-cli-pr-missing-' });
  t.after(cleanup);
  for (const argv of [
    [...FEEDBACK_ADD_BASE, '--pr'],
    [...FEEDBACK_ADD_BASE, '--pr', '--evidence', 'duplicate of an earlier finding'],
  ]) {
    const label = argv.join(' ');
    const res = await runCliInProcess(argv, { cwd: dir });
    assert.match(res.stderr, /--pr option requires a positive integer/, label);
    assert.doesNotMatch(res.stdout, /Feedback recorded/, label);
    await assertNothingWritten(dir, label);
  }
});

test('`river feedback add --pr 123` still records the number', async (t) => {
  const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-cli-pr-valid-' });
  t.after(cleanup);
  const res = await runCliInProcess([...FEEDBACK_ADD_BASE, '--pr', '123'], { cwd: dir });
  assert.equal(res.code, 0, res.stderr);
  const written = /written to: (.+)/.exec(res.stdout)?.[1];
  assert.ok(written, `no target path in stdout: ${res.stdout}`);
  const [line] = (await fs.readFile(written.trim(), 'utf8')).trim().split('\n');
  assert.equal(JSON.parse(line).pr, 123);
});

test('`river feedback add` never records a following flag as an option value', async (t) => {
  const { dir, cleanup } = await createTempGitRepo({ prefix: 'feedback-cli-flag-eating-' });
  t.after(cleanup);
  // Each of these used to write an entry: `--evidence --pr 123` recorded
  // evidence:"--pr" and lost the pr, `--skill --pr 123` recorded skillId:"--pr",
  // and a trailing `--trigger` / `--fingerprint` silently fell back to the
  // default trigger / a null fingerprint.
  const cases = [
    [
      ['feedback', 'add', '--type', 'accepted', '--skill', 's', '--evidence', '--pr', '123'],
      /--evidence option requires a value/,
    ],
    [
      ['feedback', 'add', '--type', 'accepted', '--skill', '--pr', '123'],
      /--skill option requires a value/,
    ],
    [
      ['feedback', 'add', '--type', 'accepted', '--skill', 's', '--trigger'],
      /--trigger option requires a value/,
    ],
    [
      ['feedback', 'add', '--type', 'accepted', '--skill', 's', '--fingerprint'],
      /--fingerprint option requires a value/,
    ],
    [['feedback', 'add', '--skill', 's', '--type'], /--type option requires a value/],
  ];
  for (const [argv, expected] of cases) {
    const label = argv.join(' ');
    const res = await runCliInProcess(argv, { cwd: dir });
    assert.match(res.stderr, expected, label);
    assert.doesNotMatch(res.stdout, /Feedback recorded/, label);
    await assertNothingWritten(dir, label);
  }
});
