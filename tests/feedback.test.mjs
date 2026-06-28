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
import { applyFeedback } from '../scripts/apply-feedback.mjs';
import { createTempDirAsync } from './helpers/temp-dir.mjs';

const NOW = new Date('2026-06-10T03:00:00Z');

function entryInput(overrides = {}) {
  return {
    feedbackType: 'false_positive',
    skillId: 'rr-midstream-typescript-strict-001',
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
    skillId: 'rr-midstream-typescript-strict-001',
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
