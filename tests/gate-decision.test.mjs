/**
 * deriveGateDecision truth-table tests (Epic #1347 S2 / #1349).
 *
 * The design review verified the 3x4 riskAction × loopSignal matrix plus the
 * fail-safe rows; this suite encodes that table so the contract cannot drift
 * silently. Fail-safe direction: unknown/undetermined never maps to GO.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveGateDecision,
  computeGateInputsHash,
  gateConfigChanged,
  GATE_DECISIONS,
  GATE_REASON_CODES,
} from '../src/lib/gate-decision.mjs';

const base = {
  loopSignal: 'CONVERGED',
  decision: 'auto-approve',
  humanApprovalRequired: false,
  riskAction: 'comment_only',
  blockingFindings: 0,
  changedFiles: ['src/lib/foo.mjs'],
  reviewExecuted: true,
  artifactStatus: 'ok',
};

describe('deriveGateDecision — rule precedence', () => {
  test('rule 0: gate config change escalates regardless of everything else', () => {
    const r = deriveGateDecision({ ...base, changedFiles: ['.river/risk-map.yaml'] });
    assert.equal(r.decision, 'ESCALATE');
    assert.equal(r.reasonCode, 'GATE_CONFIG_CHANGED');
    assert.equal(r.tier, 'cliff');
  });

  test('rule 0 catches deletion/addition anywhere under .river/', () => {
    for (const f of ['.river/config.yaml', '.river/memory.json', '.river\\risk-map.yaml']) {
      assert.equal(gateConfigChanged([f]), true, f);
    }
    assert.equal(gateConfigChanged(['src/river/notgate.mjs']), false);
  });

  test('rule 1: humanApprovalRequired escalates', () => {
    const r = deriveGateDecision({ ...base, humanApprovalRequired: true });
    assert.equal(r.decision, 'ESCALATE');
    assert.equal(r.reasonCode, 'HUMAN_APPROVAL_REQUIRED');
  });

  test('rule 2: ESCALATE_HUMAN loop signal escalates', () => {
    const r = deriveGateDecision({ ...base, loopSignal: 'ESCALATE_HUMAN' });
    assert.equal(r.decision, 'ESCALATE');
    assert.equal(r.reasonCode, 'DECISION_ESCALATED');
  });

  test('rule 3: STOP_OSCILLATED escalates (loop-convergence-contract)', () => {
    const r = deriveGateDecision({ ...base, loopSignal: 'STOP_OSCILLATED' });
    assert.equal(r.decision, 'ESCALATE');
    assert.equal(r.reasonCode, 'OSCILLATION_DETECTED');
  });

  test('rule 4: require_human_review risk action escalates', () => {
    const r = deriveGateDecision({ ...base, riskAction: 'require_human_review' });
    assert.equal(r.decision, 'ESCALATE');
    assert.equal(r.reasonCode, 'RISK_MAP_HUMAN_REVIEW');
  });

  test('rule 5: unknown risk action fails safe to NO_GO, never GO', () => {
    const r = deriveGateDecision({ ...base, riskAction: 'yolo_mode' });
    assert.equal(r.decision, 'NO_GO');
    assert.equal(r.reasonCode, 'UNKNOWN_RISK_ACTION');
  });

  test('absent risk action is comment_only, not unknown', () => {
    const r = deriveGateDecision({ ...base, riskAction: undefined });
    assert.equal(r.decision, 'GO');
    assert.equal(r.inputs.riskAction, 'comment_only');
  });

  test('rule 6: not-executed runs never reach a GO-family outcome', () => {
    // plan-only / no-changes: a vacuous perfect score over [] findings.
    const r = deriveGateDecision({ ...base, reviewExecuted: false, artifactStatus: 'no-changes' });
    assert.equal(r.decision, 'NO_GO');
    assert.equal(r.reasonCode, 'NOT_EXECUTED');
    assert.equal(r.inputs.reviewExecuted, false);
    assert.equal(r.inputs.artifactStatus, 'no-changes');
  });

  test('rule 6: escalation rules still fire on not-executed runs', () => {
    const r = deriveGateDecision({
      ...base,
      reviewExecuted: false,
      humanApprovalRequired: true,
    });
    assert.equal(r.decision, 'ESCALATE');
    assert.equal(r.reasonCode, 'HUMAN_APPROVAL_REQUIRED');
    const r0 = deriveGateDecision({
      ...base,
      reviewExecuted: false,
      changedFiles: ['.river/risk-map.yaml'],
    });
    assert.equal(r0.reasonCode, 'GATE_CONFIG_CHANGED');
    const r4 = deriveGateDecision({
      ...base,
      reviewExecuted: false,
      riskAction: 'require_human_review',
    });
    assert.equal(r4.reasonCode, 'RISK_MAP_HUMAN_REVIEW');
  });

  test('rule 7: REVISE_REQUIRED → NO_GO', () => {
    const r = deriveGateDecision({
      ...base,
      loopSignal: 'REVISE_REQUIRED',
      decision: 'human-review-recommended',
      blockingFindings: 2,
    });
    assert.equal(r.decision, 'NO_GO');
    assert.equal(r.reasonCode, 'BLOCKING_FINDINGS');
  });

  test('rule 7: the common warn verdict observes instead of blocking', () => {
    // human-review-recommended + zero blocking = most real-world runs
    // (a single security minor already drops below the auto-approve bar).
    const r = deriveGateDecision({
      ...base,
      loopSignal: 'NO_SIGNAL',
      decision: 'human-review-recommended',
    });
    assert.equal(r.decision, 'GO_WITH_OBSERVATION');
    assert.equal(r.reasonCode, 'MINOR_FINDINGS_OBSERVE');
    assert.equal(r.tier, 'hill');
    assert.equal(r.observation.onExpiry, 'stop');
    assert.ok(r.observation.expiresInHours > 0);
  });

  test('rule 8: NO_SIGNAL with absent/unknown decision is UNDETERMINED → NO_GO', () => {
    for (const decision of [undefined, 'something-new']) {
      const r = deriveGateDecision({ ...base, loopSignal: 'NO_SIGNAL', decision });
      assert.equal(r.decision, 'NO_GO', `decision=${decision}`);
      assert.equal(r.reasonCode, 'UNDETERMINED');
    }
  });

  test('rule 8: warn verdict WITH blocking findings does not observe', () => {
    const r = deriveGateDecision({
      ...base,
      loopSignal: 'NO_SIGNAL',
      decision: 'human-review-recommended',
      blockingFindings: 1,
    });
    assert.equal(r.decision, 'NO_GO');
  });

  test('rule 9: converged + escalate risk action → hill', () => {
    const r = deriveGateDecision({ ...base, riskAction: 'escalate' });
    assert.equal(r.decision, 'GO_WITH_OBSERVATION');
    assert.equal(r.reasonCode, 'RISK_MAP_OBSERVE');
  });

  test('rule 10: converged clean → GO (field)', () => {
    const r = deriveGateDecision(base);
    assert.equal(r.decision, 'GO');
    assert.equal(r.reasonCode, 'CONVERGED_CLEAN');
    assert.equal(r.tier, 'field');
    assert.equal(r.observation, undefined);
  });

  test('rule 11: unknown loop signal fails safe to NO_GO', () => {
    for (const loopSignal of ['SOMETHING_NEW', undefined, null]) {
      const r = deriveGateDecision({ ...base, loopSignal });
      assert.equal(r.decision, 'NO_GO', `loopSignal=${loopSignal}`);
      assert.equal(r.reasonCode, 'UNKNOWN_SIGNAL');
    }
  });

  test('no input combination with unknown values ever yields GO (fail-safe sweep)', () => {
    const signals = ['CONVERGED', 'REVISE_REQUIRED', 'NO_SIGNAL', 'ESCALATE_HUMAN', 'WEIRD'];
    const actions = ['comment_only', 'escalate', 'require_human_review', 'weird'];
    for (const loopSignal of signals) {
      for (const riskAction of actions) {
        const r = deriveGateDecision({ ...base, loopSignal, riskAction });
        const anyUnknown = loopSignal === 'WEIRD' || riskAction === 'weird';
        if (anyUnknown) {
          assert.notEqual(r.decision, 'GO', `${loopSignal}/${riskAction} must not GO`);
          assert.notEqual(
            r.decision,
            'GO_WITH_OBSERVATION',
            `${loopSignal}/${riskAction} must not observe`
          );
        }
        assert.ok(GATE_DECISIONS.includes(r.decision));
        assert.ok(GATE_REASON_CODES.includes(r.reasonCode));
      }
    }
  });
});

describe('deriveGateDecision — audit block', () => {
  test('inputs echo all decision inputs (replay check contract)', () => {
    const r = deriveGateDecision({
      ...base,
      humanApprovalMode: 'llm-skipped',
      riskMapPresent: true,
      riskMapDigest: 'abcd1234abcd1234',
    });
    assert.deepEqual(r.inputs, {
      loopSignal: 'CONVERGED',
      decision: 'auto-approve',
      humanApprovalRequired: false,
      humanApprovalMode: 'llm-skipped',
      riskAction: 'comment_only',
      blockingFindings: 0,
      gateConfigChanged: false,
      reviewExecuted: true,
      artifactStatus: 'ok',
      riskMapPresent: true,
      riskMapDigest: 'abcd1234abcd1234',
      strictBlock: false,
    });
    // Replay: feeding inputs back must reproduce the decision.
    const replayed = deriveGateDecision({ ...r.inputs, changedFiles: [] });
    assert.equal(replayed.decision, r.decision);
    assert.equal(replayed.reasonCode, r.reasonCode);
  });

  test('a GATE_CONFIG_CHANGED artifact replays from inputs alone', () => {
    const original = deriveGateDecision({ ...base, changedFiles: ['.river/risk-map.yaml'] });
    assert.equal(original.inputs.gateConfigChanged, true);
    // The host has only gate.inputs (no original changedFiles): the explicit
    // gateConfigChanged override must reproduce rule 0.
    const replayed = deriveGateDecision(original.inputs);
    assert.equal(replayed.decision, 'ESCALATE');
    assert.equal(replayed.reasonCode, 'GATE_CONFIG_CHANGED');
    assert.equal(replayed.inputsHash, original.inputsHash);
  });

  test('inputsHash is canonical and order-independent of construction', () => {
    const a = computeGateInputsHash({ loopSignal: 'CONVERGED', decision: 'auto-approve' });
    const b = computeGateInputsHash({ decision: 'auto-approve', loopSignal: 'CONVERGED' });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{16}$/);
    // undefined and null canonicalize identically
    assert.equal(
      computeGateInputsHash({ loopSignal: 'X', riskMapDigest: undefined }),
      computeGateInputsHash({ loopSignal: 'X', riskMapDigest: null })
    );
  });

  test('configSnapshot carries observation/circuit-breaker settings', () => {
    const r = deriveGateDecision({
      ...base,
      config: {
        gate: { observation: { expiresInHours: 24 }, circuitBreaker: { maxConsecutiveAutoGo: 3 } },
      },
      riskAction: 'escalate',
    });
    assert.deepEqual(r.configSnapshot, { expiresInHours: 24, maxConsecutiveAutoGo: 3 });
    assert.equal(r.observation.expiresInHours, 24);
  });

  test('observation caps file list at 100 entries', () => {
    const files = Array.from({ length: 250 }, (_, i) => `src/f${i}.mjs`);
    const r = deriveGateDecision({ ...base, riskAction: 'escalate', changedFiles: files });
    assert.equal(r.observation.files.length, 100);
  });
});

describe('deriveExecutionOrder (Epic #1347 S2, merged from #1339)', () => {
  test('derives canonical layer order from evaluationType declarations', async () => {
    const { deriveExecutionOrder } = await import('../runners/core/review-runner.mjs');
    const skills = [
      { metadata: { id: 'a', evaluationType: 'agentic' } },
      { metadata: { id: 'b', evaluationType: 'deterministic' } },
      { metadata: { id: 'c', evaluationType: 'heuristic' } },
    ];
    assert.deepEqual(deriveExecutionOrder(skills), ['deterministic', 'heuristic', 'llm']);
  });

  test('falls back to SKILL_HEURISTIC_MAP membership, else llm', async () => {
    const { deriveExecutionOrder } = await import('../runners/core/review-runner.mjs');
    // security-basic has heuristic detectors AND runs through the LLM in
    // normal execution → a SINGLE such skill must declare both layers
    // (isolates the m1 fix: heuristic-only declaration would break S4 routing).
    assert.deepEqual(deriveExecutionOrder([{ metadata: { id: 'security-basic' } }]), [
      'heuristic',
      'llm',
    ]);
    assert.deepEqual(deriveExecutionOrder([{ metadata: { id: 'some-llm-skill' } }]), ['llm']);
    assert.deepEqual(deriveExecutionOrder([]), []);
  });
});

describe('SKIPPED_BY_POLICY (S3 PR-C)', () => {
  test('skipped-by-label gates as NO_GO with the dedicated reason', () => {
    const r = deriveGateDecision({
      ...base,
      reviewExecuted: false,
      artifactStatus: 'skipped-by-label',
    });
    // A team label is an explicit policy skip — still NO_GO (a label must not
    // become a gate bypass), but hosts can distinguish it from NOT_EXECUTED.
    assert.equal(r.decision, 'NO_GO');
    assert.equal(r.reasonCode, 'SKIPPED_BY_POLICY');
  });

  test('escalation rules still precede the policy skip', () => {
    const r = deriveGateDecision({
      ...base,
      reviewExecuted: false,
      artifactStatus: 'skipped-by-label',
      humanApprovalRequired: true,
    });
    assert.equal(r.reasonCode, 'HUMAN_APPROVAL_REQUIRED');
  });
});

describe('STRICT_BLOCK (Epic #1347 S4, #1351)', () => {
  test('a deterministic strict_block forces an unconditional NO_GO', () => {
    // base is a clean CONVERGED artifact that would otherwise GO.
    const clean = deriveGateDecision(base);
    assert.equal(clean.decision, 'GO');
    const r = deriveGateDecision({ ...base, strictBlock: true });
    assert.equal(r.decision, 'NO_GO');
    assert.equal(r.reasonCode, 'STRICT_BLOCK');
  });

  test('blocks even with zero critical/major findings (below the blockingFindings floor)', () => {
    const r = deriveGateDecision({ ...base, blockingFindings: 0, strictBlock: true });
    assert.equal(r.decision, 'NO_GO');
    assert.equal(r.reasonCode, 'STRICT_BLOCK');
  });

  test('cannot be waived by a label-skip or a dry-run', () => {
    const skip = deriveGateDecision({
      ...base,
      reviewExecuted: false,
      artifactStatus: 'skipped-by-label',
      strictBlock: true,
    });
    assert.equal(skip.reasonCode, 'STRICT_BLOCK');
    const notExecuted = deriveGateDecision({ ...base, reviewExecuted: false, strictBlock: true });
    assert.equal(notExecuted.reasonCode, 'STRICT_BLOCK');
  });

  test('escalation cliffs still win — ESCALATE is more conservative than NO_GO', () => {
    const configChange = deriveGateDecision({
      ...base,
      changedFiles: ['.river/risk-map.yaml'],
      strictBlock: true,
    });
    assert.equal(configChange.reasonCode, 'GATE_CONFIG_CHANGED');
    const humanApproval = deriveGateDecision({
      ...base,
      humanApprovalRequired: true,
      strictBlock: true,
    });
    assert.equal(humanApproval.reasonCode, 'HUMAN_APPROVAL_REQUIRED');
  });

  test('inputs echo strictBlock and replay reproduces the decision + hash', () => {
    const r = deriveGateDecision({ ...base, strictBlock: true });
    assert.equal(r.inputs.strictBlock, true);
    const replayed = deriveGateDecision({ ...r.inputs, changedFiles: [] });
    assert.equal(replayed.decision, r.decision);
    assert.equal(replayed.reasonCode, r.reasonCode);
    assert.equal(replayed.inputsHash, r.inputsHash);
  });

  test('strictBlock:false leaves the inputsHash byte-identical to a pre-S4 gate', () => {
    // Backward-compat: the hash omits strictBlock when false, so no existing
    // recorded gate hash changes.
    const withFlag = deriveGateDecision({ ...base, strictBlock: false });
    const withoutFlag = deriveGateDecision(base);
    assert.equal(withFlag.inputsHash, withoutFlag.inputsHash);
  });
});

describe('computeContextLift (S3 PR-C)', () => {
  test('measures candidate vs loaded skill-body tokens', async () => {
    const { computeContextLift } = await import('../runners/core/review-runner.mjs');
    const skill = (body) => ({ metadata: { id: 'x' }, body });
    const candidates = [skill('a'.repeat(400)), skill('b'.repeat(400)), skill('c'.repeat(400))];
    const lift = computeContextLift(candidates, [candidates[0]]);
    assert.ok(lift.totalSkillTokens > lift.loadedSkillTokens);
    assert.ok(lift.liftRatio > 0.5 && lift.liftRatio < 1);
    // empty candidates → ratio 0, no division by zero
    assert.deepEqual(computeContextLift([], []), {
      totalSkillTokens: 0,
      loadedSkillTokens: 0,
      liftRatio: 0,
    });
  });
});
