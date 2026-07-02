// tests/plan-review-gate-canary.test.mjs
//
// Adversarial canary for the plan-review-gate detector (#1348 S1, Epic #1347).
//
// Loads the bidirectional canary fixtures in
// skills/upstream/plan-review-gate/fixtures/ — adversarial plans written to
// avoid literal danger words (euphemisms), an LLM-escalation-only plan, and a
// benign plan — and mechanically measures the detector pass rate against each
// fixture's embedded `<!-- expected: -->` block. The DoD for #1348 is that
// recall is measured by this pass rate, not asserted qualitatively: the suite
// FAILS unless the pass rate is 100%, and logs the measured rate.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectHumanApprovalTriggers,
  detectHumanApprovalCandidates,
  adjudicateHumanApproval,
} from '../src/lib/plan-review/human-approval-policy.mjs';

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'upstream',
  'plan-review-gate',
  'fixtures'
);

const EXPECTED_RE = /<!--\s*expected:\s*([\s\S]*?)-->/;

/**
 * Parse the `<!-- expected: -->` block of a canary fixture.
 * Supported keys (subset of YAML, parsed line-wise on purpose — fixtures
 * stay grep-able and this test has no YAML dependency):
 *   humanApproval.regexOnly:      required | not-required
 *   humanApproval.llmEscalation:  escalated | n/a   (optional)
 *   humanApproval.triggersInclude: list items or inline []
 */
function parseExpected(markdown, name) {
  const m = EXPECTED_RE.exec(markdown);
  assert.ok(m, `${name}: fixture must embed an <!-- expected: --> block`);
  const block = m[1];
  const regexOnly = /regexOnly:\s*(\S+)/.exec(block)?.[1];
  assert.ok(
    regexOnly === 'required' || regexOnly === 'not-required',
    `${name}: humanApproval.regexOnly must be required|not-required`
  );
  const llmEscalation = /llmEscalation:\s*(\S+)/.exec(block)?.[1] ?? null;
  const triggersInclude =
    /triggersInclude:\s*\[\s*\]/.test(block) === true
      ? []
      : [...block.matchAll(/^\s*-\s+(\S+)\s*$/gm)].map((x) => x[1]);
  return { regexOnly, llmEscalation, triggersInclude };
}

/** Strip the expected block so expectations never leak into the scanned text. */
function fixtureBody(markdown) {
  return markdown.replace(EXPECTED_RE, '');
}

const files = fs
  .readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.md'))
  .sort();

describe('plan-review-gate — adversarial canary fixtures (#1348 S1)', () => {
  assert.ok(files.length >= 5, `expected at least 5 canary fixtures, found ${files.length}`);

  let passed = 0;
  let total = 0;
  const failures = [];

  const check = (name, label, condition, detail) => {
    total += 1;
    if (condition) {
      passed += 1;
    } else {
      failures.push(`${name} [${label}] ${detail}`);
    }
    assert.ok(condition, `${name} [${label}] ${detail}`);
  };

  for (const file of files) {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8');
    const expected = parseExpected(raw, file);
    const body = fixtureBody(raw);

    it(`${file}: regex tier verdict is ${expected.regexOnly}`, () => {
      const result = detectHumanApprovalTriggers(body);
      check(
        file,
        'regex-only',
        result.required === (expected.regexOnly === 'required'),
        `expected required=${expected.regexOnly === 'required'}, ` +
          `got ${result.required} (triggers: ${JSON.stringify(result.triggers)})`
      );
    });

    it(`${file}: expected triggers fire`, () => {
      const { candidates } = detectHumanApprovalCandidates(body);
      const names = candidates.map((c) => c.trigger);
      if (expected.triggersInclude.length === 0) {
        check(
          file,
          'no-candidates',
          candidates.length === 0,
          `benign fixture must produce zero candidates, got ${JSON.stringify(names)}`
        );
      } else {
        for (const t of expected.triggersInclude) {
          check(file, `trigger:${t}`, names.includes(t), `missing in ${JSON.stringify(names)}`);
        }
      }
    });

    if (expected.llmEscalation === 'escalated') {
      it(`${file}: LOW-only candidates escalate via the LLM adjudicator`, async () => {
        const { candidates } = detectHumanApprovalCandidates(body);
        check(
          file,
          'low-only',
          candidates.length > 0 && candidates.every((c) => c.confidence === 'low'),
          `escalation fixture must produce only LOW candidates, got ${JSON.stringify(candidates)}`
        );
        const escalated = await adjudicateHumanApproval({
          text: body,
          candidates,
          artifactKind: 'plan',
          adjudicator: async () => true, // deterministic stand-in for the LLM
        });
        check(
          file,
          'llm-escalated',
          escalated.required === true && escalated.mode === 'llm-adjudicated',
          `expected escalation, got required=${escalated.required} mode=${escalated.mode}`
        );
        // Escalation must be opt-in: without an adjudicator the same fixture
        // stays not-required (regex-only backward compatibility).
        const regexOnly = await adjudicateHumanApproval({ candidates, adjudicator: null });
        check(
          file,
          'regex-only-stays-quiet',
          regexOnly.required === false && regexOnly.mode === 'regex-only',
          `expected regex-only false, got required=${regexOnly.required} mode=${regexOnly.mode}`
        );
      });
    }
  }

  after(() => {
    // DoD (#1348): the canary pass rate is a measured number, not a claim.
    const rate = total === 0 ? 0 : Math.round((passed / total) * 1000) / 10;
    console.log(
      `plan-review-gate canary pass rate: ${passed}/${total} (${rate}%)` +
        (failures.length ? `\n  failures:\n  - ${failures.join('\n  - ')}` : '')
    );
  });
});
