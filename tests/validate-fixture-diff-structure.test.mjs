/**
 * Tests for validateFixtureDiffStructure in scripts/validate-skills.mjs (#1852).
 *
 * The gate parses the ```diff blocks embedded in skill fixtures and checks two
 * things deterministically: that a hunk header's declared line counts match its
 * body, and that every `<file>:<line>` anchor in an `<!-- expected: -->` block
 * resolves to a real, non-blank line of the reconstructed new side.
 *
 * #1850's adversarial review found both classes of defect surviving a fully
 * green CI, so the negative cases below are the regression pins: each one is a
 * fixture broken in exactly one way, and each must make the gate return false.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';

import {
  validateFixtureDiffStructure,
  countHunkHeaders,
  extractDiffBlocks,
  parseUnifiedDiff,
  parseFixtureDiffs,
  extractFixtureAnchors,
} from '../scripts/validate-skills.mjs';
import { createTempDirAsync } from './helpers/temp-dir.mjs';

const TMP_PREFIX = 'validate-fixture-diff-structure-';

const SKILL_MD = `---
id: diff-structure-skill
name: Diff Structure Skill
description: 'Fixture diff structure gate test skill.'
category: upstream
phase: upstream
applyTo:
  - 'docs/**/*.md'
tags: [test, upstream]
severity: major
inputContext: [diff]
outputKind: [findings]
---

## Rule

body
`;

/**
 * A 4-line new file. Line 2 is blank, so `docs/note.md:2` is the blank-anchor
 * case and `docs/note.md:5` is the out-of-range case.
 */
const DIFF_BODY = [
  'diff --git a/docs/note.md b/docs/note.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/docs/note.md',
  '@@ -0,0 +1,4 @@',
  '+# Note',
  '+',
  '+Timeouts are undefined.',
  '+Retries are unbounded.',
].join('\n');

const FIXTURE = (diffBody, expectedYaml) =>
  `# Fixture

## Input Diff

\`\`\`diff
${diffBody}
\`\`\`

<!-- expected:
${expectedYaml}
-->
`;

const ANCHORED = (line) => `findings:
  - severity: major
    reason: no timeout is defined
    anchor: docs/note.md:${line}`;

async function buildSkill(fixtures) {
  const dir = await createTempDirAsync({ prefix: TMP_PREFIX });
  const skillDir = path.join(dir, 'upstream', 'diff-structure-skill');
  const fixturesDir = path.join(skillDir, 'fixtures');
  await fs.mkdir(fixturesDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), SKILL_MD, 'utf8');
  for (const [name, content] of Object.entries(fixtures)) {
    await fs.writeFile(path.join(fixturesDir, name), content, 'utf8');
  }
  return dir;
}

async function runGate(fixtures) {
  const dir = await buildSkill(fixtures);
  const errors = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = () => {};
  try {
    const result = await validateFixtureDiffStructure({ skillsDir: dir, repoRoot: dir });
    return { ...result, errors };
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
}

test('passes on a fixture whose hunk header and anchor are both correct', async () => {
  const { ok, errors } = await runGate({ '01-ok.md': FIXTURE(DIFF_BODY, ANCHORED(3)) });
  assert.equal(ok, true, errors.join('\n'));
  assert.deepEqual(errors, []);
});

// (a) anchor points at a blank line
test('fails when an anchor points at a blank line', async () => {
  const { ok, errors } = await runGate({ '01-blank-anchor.md': FIXTURE(DIFF_BODY, ANCHORED(2)) });
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/note\.md:2/);
  assert.match(errors[0], /blank/);
});

// (b) anchor points at a line number that does not exist
test('fails when an anchor points at a nonexistent line number', async () => {
  const { ok, errors } = await runGate({ '01-out-of-range.md': FIXTURE(DIFF_BODY, ANCHORED(5)) });
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/note\.md:5/);
  assert.match(errors[0], /not present on the new side/);
});

// (c) hunk header declares counts that disagree with the body
test('fails when a hunk header line count disagrees with the body', async () => {
  const broken = DIFF_BODY.replace('@@ -0,0 +1,4 @@', '@@ -0,0 +1,9 @@');
  const { ok, errors } = await runGate({ '01-bad-count.md': FIXTURE(broken, ANCHORED(3)) });
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /declares old=0, new=9 but the body has old=0, new=4/);
  assert.match(errors[0], /@@ -0,0 \+1,4 @@/);
});

test('fails when the old-side declared count disagrees with the body', async () => {
  const body = [
    'diff --git a/docs/note.md b/docs/note.md',
    '--- a/docs/note.md',
    '+++ b/docs/note.md',
    '@@ -3,4 +3,2 @@',
    ' context line',
    '-removed line',
    '+added line',
  ].join('\n');
  const { ok, errors } = await runGate({ '01-bad-old.md': FIXTURE(body, ANCHORED(3)) });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /declares old=4, new=2 but the body has old=2, new=2/.test(e)));
});

test('fails when an anchor names a file absent from the diff blocks', async () => {
  const yamlBlock = `findings:
  - severity: major
    reason: anchored to a file the diff never shows
    anchor: docs/other.md:1`;
  const { ok, errors } = await runGate({ '01-unknown-file.md': FIXTURE(DIFF_BODY, yamlBlock) });
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no "\+\+\+ b\/docs\/other\.md" appears/);
});

test('fails when a hunk body carries a line with no diff prefix', async () => {
  const body = [
    'diff --git a/docs/note.md b/docs/note.md',
    '--- /dev/null',
    '+++ b/docs/note.md',
    '@@ -0,0 +1,2 @@',
    '+# Note',
    'prose that escaped the fence',
  ].join('\n');
  const { ok, errors } = await runGate({ '01-stray-line.md': FIXTURE(body, ANCHORED(1)) });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /no ' ' \/ '\+' \/ '-' prefix/.test(e)));
});

// #1854 review, major 2 (partial): a diff written in a notation the fence regex
// does not match is skipped in silence. The surplus-header count catches it per
// fixture; the coverage floors catch the repo-wide version of the same class.
test('fails when a diff sits in an unrecognized fence (```Diff)', async () => {
  const text = `# Fixture

\`\`\`Diff
${DIFF_BODY}
\`\`\`

<!-- expected:
findings: []
-->
`;
  const { ok, errors } = await runGate({ '01-uppercase-fence.md': text });
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /1 hunk header\(s\) in the file but only 0 inside a recognized/);
});

test('fails when only one of two diffs uses a recognized fence', async () => {
  const text = `# Fixture

\`\`\`diff
${DIFF_BODY}
\`\`\`

\`\`\`diff title="second"
${DIFF_BODY}
\`\`\`

<!-- expected:
${ANCHORED(3)}
-->
`;
  const { ok, errors } = await runGate({ '01-mixed-fences.md': text });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /2 hunk header\(s\) in the file but only 1 inside/.test(e)));
});

test('countHunkHeaders ignores headers carrying a diff-body prefix', () => {
  assert.equal(
    countHunkHeaders(
      ['@@ -1,2 +1,2 @@', ' @@ -9,9 +9,9 @@', '+@@ -9,9 +9,9 @@', '-@@ -9,9 +9,9 @@'].join('\n')
    ),
    1
  );
});

test('skips a negative fixture that declares no anchor (findings: [])', async () => {
  const { ok, errors } = await runGate({
    '02-no-findings.md': FIXTURE(DIFF_BODY, 'findings: []'),
  });
  assert.equal(ok, true, errors.join('\n'));
  assert.deepEqual(errors, []);
});

test('skips a fixture with no diff block at all', async () => {
  const { ok, errors } = await runGate({
    '03-prose-only.md': `# Fixture\n\nProse only.\n\n<!-- expected:\n${ANCHORED(3)}\n-->\n`,
  });
  assert.equal(ok, true, errors.join('\n'));
  assert.deepEqual(errors, []);
});

test('skips non-file:line anchors such as the (summary) pseudo-anchor', async () => {
  const yamlBlock = `findings:
  - severity: major
    reason: summary line
    anchor: (summary):1`;
  const { ok, errors } = await runGate({ '04-summary.md': FIXTURE(DIFF_BODY, yamlBlock) });
  assert.equal(ok, true, errors.join('\n'));
  assert.deepEqual(errors, []);
});

/**
 * Coverage floors for the repository-wide run (#1854 review, major 1).
 *
 * A green verdict is NOT evidence that the gate inspected anything: every way
 * this gate can lose its real input — breaking RE_DIFF_FENCE, adding a path
 * filter, renaming the `fixtures/` directory, changing the `.md` filter —
 * leaves `ok: true` with the counters at 0. Measured on this commit:
 * 198 fixtures / 250 hunks / 100 anchors (`npm run skills:validate` prints the
 * same three numbers). The floors sit ~20% below that, which
 *
 * - fails on every collapse mode above (all of them drive the counters to 0);
 * - fails if either large tier stops being scanned (midstream = 122 fixtures /
 *   155 hunks, upstream = 57 fixtures / 64 hunks / 83 anchors);
 * - leaves ~48 fixtures / 50 hunks / 20 anchors of headroom, so ordinary
 *   fixture churn does not fail the suite for no reason.
 *
 * RAISE these when coverage grows. Lowering one is only correct alongside a
 * deliberate, explained removal of fixtures — never to make a red suite green.
 */
const COVERAGE_FLOORS = { fixtures: 150, hunks: 200, anchors: 80 };

test('every fixture in the repository passes the gate', async () => {
  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await validateFixtureDiffStructure();
  } finally {
    console.log = originalLog;
  }
  assert.equal(result.ok, true);
});

test('the repository-wide run actually inspects fixtures (coverage floors)', async () => {
  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await validateFixtureDiffStructure();
  } finally {
    console.log = originalLog;
  }
  assert.ok(
    result.checkedFixtures >= COVERAGE_FLOORS.fixtures,
    `inspected ${result.checkedFixtures} fixtures, floor is ${COVERAGE_FLOORS.fixtures} — ` +
      'the gate lost its input rather than passing it'
  );
  assert.ok(
    result.checkedHunks >= COVERAGE_FLOORS.hunks,
    `inspected ${result.checkedHunks} hunks, floor is ${COVERAGE_FLOORS.hunks}`
  );
  assert.ok(
    result.checkedAnchors >= COVERAGE_FLOORS.anchors,
    `inspected ${result.checkedAnchors} anchors, floor is ${COVERAGE_FLOORS.anchors}`
  );
});

test('an empty skills tree reports zero coverage instead of a silent pass', async () => {
  const dir = await createTempDirAsync({ prefix: TMP_PREFIX });
  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await validateFixtureDiffStructure({ skillsDir: dir, repoRoot: dir });
  } finally {
    console.log = originalLog;
  }
  // The verdict alone cannot distinguish "nothing to check" from "all good" —
  // which is exactly why the floors above are asserted separately.
  assert.equal(result.ok, true);
  assert.deepEqual(
    { f: result.checkedFixtures, h: result.checkedHunks, a: result.checkedAnchors },
    { f: 0, h: 0, a: 0 }
  );
});

// --- pure helpers -----------------------------------------------------------

test('extractDiffBlocks handles a 4-backtick fence wrapping an inner fence', () => {
  const text = ['````diff', '+```bash', '+echo hi', '+```', '````', '', '```text', 'x', '```'].join(
    '\n'
  );
  const blocks = extractDiffBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], '+```bash\n+echo hi\n+```\n');
});

test('parseUnifiedDiff reconstructs new-side numbering across context and deletions', () => {
  const { files, hunks } = parseUnifiedDiff(
    ['+++ b/a.txt', '@@ -10,3 +10,3 @@', ' keep', '-gone', '+fresh', ' tail'].join('\n')
  );
  const lines = files.get('a.txt').lines;
  assert.deepEqual(
    [...lines.entries()],
    [
      [10, 'keep'],
      [11, 'fresh'],
      [12, 'tail'],
    ]
  );
  assert.equal(hunks[0].actualOld, 3);
  assert.equal(hunks[0].actualNew, 3);
});

test('parseUnifiedDiff treats an omitted count as 1 and ignores the no-newline marker', () => {
  const { hunks } = parseUnifiedDiff(
    ['+++ b/a.txt', '@@ -1 +1 @@', '-old', '+new', '\\ No newline at end of file'].join('\n')
  );
  assert.equal(hunks[0].declaredOld, 1);
  assert.equal(hunks[0].declaredNew, 1);
  assert.equal(hunks[0].actualOld, 1);
  assert.equal(hunks[0].actualNew, 1);
});

// #1854 review, major 3: `--- foo` is the deletion of an SQL/Lua comment line
// `-- foo`, not a file header. Treating it as a header truncated the hunk and
// made the gate print a WRONG "expected" header, which would corrupt a correct
// fixture if a maintainer applied it. Fixtures do carry SQL
// (skills/upstream/data-model-db-design/fixtures/01-*.md).
test('parseUnifiedDiff counts a deleted `-- comment` line as a deletion, not a header', () => {
  const { hunks, files, unknownPrefixLines } = parseUnifiedDiff(
    [
      '+++ b/db/schema/billing.sql',
      '@@ -1,2 +1,2 @@',
      '--- legacy amount column, dropped in v2',
      '+-- amount_cents is mandatory',
      ' CREATE TABLE invoices (',
    ].join('\n')
  );
  assert.equal(unknownPrefixLines.length, 0);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].actualOld, 2);
  assert.equal(hunks[0].actualNew, 2);
  assert.deepEqual(
    [...files.get('db/schema/billing.sql').lines.entries()],
    [
      [1, '-- amount_cents is mandatory'],
      [2, 'CREATE TABLE invoices ('],
    ]
  );
});

test('parseUnifiedDiff still splits on a real `--- ` / `+++ ` header pair', () => {
  const { files, hunks } = parseUnifiedDiff(
    [
      '--- a/one.txt',
      '+++ b/one.txt',
      '@@ -1,1 +1,1 @@',
      '+alpha',
      '--- a/two.txt',
      '+++ b/two.txt',
      '@@ -1,1 +1,1 @@',
      '+beta',
    ].join('\n')
  );
  assert.deepEqual([...files.keys()], ['one.txt', 'two.txt']);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].actualNew, 1);
  assert.equal(hunks[1].actualNew, 1);
});

test('parseUnifiedDiff counts an added `++ ` line rather than reading it as a header', () => {
  const { hunks } = parseUnifiedDiff(
    ['+++ b/a.md', '@@ -1,1 +1,2 @@', ' intro', '+++ nested bullet'].join('\n')
  );
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].actualNew, 2);
});

test('parseUnifiedDiff ignores the new side of a deletion (+++ /dev/null)', () => {
  const { files } = parseUnifiedDiff(
    ['--- a/a.txt', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-one', '-two'].join('\n')
  );
  assert.equal(files.size, 0);
});

test('parseFixtureDiffs merges multiple diff blocks of one fixture', () => {
  const text = [
    '```diff',
    '+++ b/a.txt',
    '@@ -0,0 +1,1 @@',
    '+alpha',
    '```',
    '',
    '```diff',
    '+++ b/b.txt',
    '@@ -0,0 +1,1 @@',
    '+beta',
    '```',
  ].join('\n');
  const { files, hunks } = parseFixtureDiffs(text);
  assert.deepEqual([...files.keys()], ['a.txt', 'b.txt']);
  assert.equal(hunks.length, 2);
});

test('extractFixtureAnchors reads findings[].anchor only', () => {
  const text = `<!-- expected:
findings:
  - severity: major
    anchor: src/a.ts:12
  - severity: minor
    anchor: (summary):1
  - severity: minor
    reason: no anchor at all
notes:
  anchor: src/ignored.ts:1
-->`;
  assert.deepEqual(extractFixtureAnchors(text), [
    { raw: 'src/a.ts:12', file: 'src/a.ts', line: 12 },
  ]);
});
