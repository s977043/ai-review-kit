import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { parseUnifiedDiff } from '../src/lib/diff.mjs';
import { generateReview } from '../src/lib/review-engine.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

test('review eval fixtures keep must-include signals (heuristic path)', async () => {
  const casesPath = path.join(__dirname, 'fixtures', 'review-eval', 'cases.json');
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const fixturesDir = path.dirname(casesPath);

  for (const c of cases) {
    const diffPath = path.resolve(fixturesDir, c.diffFile);
    const diffText = fs.readFileSync(diffPath, 'utf8');
    const parsed = parseUnifiedDiff(diffText);
    const plan = {
      selected: (c.planSkills ?? []).map(id => ({ metadata: { id } })),
      skipped: [],
    };
    const diff = {
      diffText,
      files: parsed.files,
      changedFiles: parsed.files.map(f => f.path).filter(Boolean),
    };

    const result = await generateReview({ diff, plan, phase: c.phase ?? 'midstream', dryRun: true });

    assert.ok(result.comments.length > 0, `[${c.name}] expected at least 1 finding`);
    if (typeof c.maxFindings === 'number') {
      assert.ok(result.comments.length <= c.maxFindings, `[${c.name}] too many findings: ${result.comments.length}`);
    }

    const merged = result.comments.map(x => x.message).join('\n');
    for (const token of c.mustInclude ?? []) {
      assert.ok(merged.includes(token), `[${c.name}] missing token: ${token}`);
    }
  }
});

