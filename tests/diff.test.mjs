import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUnifiedDiff } from '../src/lib/diff.mjs';

const sampleDiff = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
-hello
+hello world
+next
 context
`;

test('parseUnifiedDiff returns file and hunk information', () => {
  const parsed = parseUnifiedDiff(sampleDiff);
  assert.equal(parsed.files.length, 1);
  const file = parsed.files[0];
  assert.equal(file.path, 'README.md');
  assert.equal(file.hunks.length, 1);
  assert.deepEqual(file.hunks[0].addedLines, [1, 2]);
  assert.deepEqual(file.addedLines, [1, 2]);
});
