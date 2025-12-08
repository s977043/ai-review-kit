import assert from 'node:assert/strict';
import test from 'node:test';
import { generateReview, parseLineComments } from '../src/lib/review-engine.mjs';

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
      hunks: [{ newStart: 11, addedLines: [11, 12], lines: [], oldStart: 10, oldLines: 0, newLines: 2 }],
      addedLines: [11, 12],
    },
  ],
  changedFiles: ['src/app.ts'],
};

const plan = {
  selected: [{ metadata: { id: 'skill-1', name: 'Skill One', phase: 'midstream', applyTo: ['src/**'] } }],
  skipped: [],
};

test('generateReview returns fallback comments when LLM is skipped', async () => {
  const result = await generateReview({ diff, plan, phase: 'midstream', dryRun: true });
  assert.ok(result.comments.length > 0);
  assert.equal(result.debug.llmUsed, false);
  assert.ok(result.prompt.includes('River Reviewer'));
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
