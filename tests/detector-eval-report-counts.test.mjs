import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test, { describe } from 'node:test';

// Drift guard for pages/reference/detector-evaluation-report.md (+ .en.md).
// The report publishes exact per-category fixture counts. If someone edits
// tests/fixtures/review-eval/cases.json, this test fails loudly so the doc's
// numbers are updated in the same change (mirrors CLAUDE.md "Review-doc SSoT
// sync"). Keep EXPECTED in sync with the report table when cases.json changes.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const casesPath = path.join(__dirname, 'fixtures', 'review-eval', 'cases.json');
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));

const EXPECTED = {
  secrets: { detect: 3, guard: 1 },
  observability: { detect: 2, guard: 1 },
  tests: { detect: 5, guard: 1 },
  altitude: { detect: 1, guard: 1 },
  closure: { detect: 1, guard: 1 },
};
const EXPECTED_TOTAL = 17;
const EXPECTED_GUARDS = 5;

function categoryOf(name) {
  return String(name).split(':')[0].trim();
}
// A guard (false-positive canary) is a case that expects no findings — the same
// criterion the evaluator uses (review-fixtures-eval.mjs: isGuardCase =
// expectNoFindings). Do NOT infer it from the name: e.g. "tests: missing tests
// for new guard" is a DETECTION case that merely mentions a guard clause.
function isGuard(c) {
  return Boolean(c.expectNoFindings);
}

describe('detector-evaluation-report counts stay in sync with cases.json', () => {
  const breakdown = {};
  for (const c of cases) {
    const cat = categoryOf(c.name);
    breakdown[cat] ??= { detect: 0, guard: 0 };
    breakdown[cat][isGuard(c) ? 'guard' : 'detect'] += 1;
  }

  test('total fixture count matches the report', () => {
    assert.equal(cases.length, EXPECTED_TOTAL);
  });

  test('guard (false-positive canary) count matches the report', () => {
    assert.equal(cases.filter(isGuard).length, EXPECTED_GUARDS);
  });

  test('per-category detect/guard breakdown matches the report table', () => {
    assert.deepEqual(breakdown, EXPECTED);
  });
});
