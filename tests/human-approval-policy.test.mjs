import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectHumanApprovalTriggers,
  detectHumanApprovalCandidates,
  adjudicateHumanApproval,
} from '../src/lib/plan-review/human-approval-policy.mjs';

// ---------------------------------------------------------------------------
// Canary: should_trigger — texts that MUST always trigger human approval
// (HIGH-confidence patterns only — required=true in regex-only mode)
// ---------------------------------------------------------------------------
describe('detectHumanApprovalTriggers — should_trigger canary', () => {
  const TRIGGER_CASES = [
    // High-confidence: pre-existing patterns
    { label: 'credential keyword', text: 'Store the API credential in config' },
    { label: 'secret keyword', text: 'Write secret to env file' },
    { label: 'destructive command', text: 'Execute destructive command: rm -rf /data' },
    { label: 'config overwrite', text: 'This step will config overwrite the base settings' },
    { label: 'memory write', text: 'Perform a memory write to the agent context' },
    { label: 'billing keyword', text: 'Update billing plan for the organization' },
    { label: 'provider change', text: 'Apply provider change from AWS to GCP' },
    { label: 'permission change', text: 'Apply permission change to IAM roles' },
    { label: 'user data', text: 'Export user data for GDPR compliance' },
    // Euphemisms / compound phrases (high-confidence)
    { label: 'credentials (plural)', text: 'Rotate credentials in vault' },
    { label: 'secrets manager', text: 'Read from secrets manager' },
    { label: 'BILLING (uppercase)', text: 'BILLING team will review' },
    // Word-order variants for permission-change (high-confidence)
    { label: 'change permissions (word-order)', text: 'change permissions on the bucket' },
    { label: 'grant permission (singular)', text: 'grant permission to the service account' },
    { label: 'revoke permissions (plural)', text: 'revoke permissions from the role' },
    { label: 'change provider', text: 'change provider from Stripe to Paddle' },
    { label: 'update providers', text: 'update providers list in the config' },
    { label: 'billing update', text: 'billing update scheduled for end of month' },
    { label: 'user data export', text: 'user data export for GDPR request' },
    // New high-confidence canary cases (#1171 item1 / #1170 F1)
    { label: 'rm -rf command', text: 'rm -rf /data' },
    { label: 'DROP TABLE', text: 'DROP TABLE users' },
    { label: 'git push --force', text: 'git push --force' },
    {
      label: 'AWS key ID',
      // Constructed to avoid false-positive in the test file itself
      text: 'AKIA' + '0'.repeat(12) + 'ABCD',
    },
    { label: 'dotenv file reference', text: 'cat .env' },
    { label: 'Japanese: 本番デプロイ', text: '本番デプロイを実施する' },
    { label: 'Japanese: データベース削除', text: 'データベース削除を実行する' },
    { label: 'Japanese: 秘密鍵', text: '秘密鍵をローテーションする' },
  ];

  for (const { label, text } of TRIGGER_CASES) {
    it(label, () => {
      const result = detectHumanApprovalTriggers(text);
      assert.equal(
        result.required,
        true,
        `Expected human approval required for: "${text}" (triggers: ${JSON.stringify(result.triggers)})`
      );
      assert.ok(result.triggers.length > 0, 'triggers array should be non-empty');
    });
  }
});

// ---------------------------------------------------------------------------
// Canary: should_not_trigger (regex-only required=false)
// These texts must NOT falsely set required=true. Low-confidence candidates
// may still appear in triggers[] — only required must be false.
// ---------------------------------------------------------------------------
describe('detectHumanApprovalTriggers — should_not_trigger canary (false-positive prevention)', () => {
  const NO_TRIGGER_CASES = [
    { label: 'generic refactor', text: 'Refactor the scoring engine to reduce complexity' },
    { label: 'add unit test', text: 'Add unit test for the new helper function' },
    { label: 'update docs', text: 'Update documentation for the API endpoint' },
    { label: 'rename variable', text: 'Rename variable from foo to bar' },
    { label: 'bump dependency', text: 'Bump eslint to version 9.0' },
    { label: 'fix lint warning', text: 'Fix lint warning in the build script' },
    {
      label: 'add type annotation',
      text: 'Add TypeScript type annotation to the function signature',
    },
    { label: 'improve logging', text: 'Improve logging output format for readability' },
    // New: low-confidence words in benign context (#1170 F1)
    { label: 'follow up via email (benign)', text: 'follow up via email' },
    { label: 'slack notification style fix (benign)', text: 'fix slack notification style' },
    { label: 'authentication is documented (benign)', text: 'authentication is documented' },
    { label: 'Non-goals: deploy to prod (context)', text: 'Non-goals: deploy to prod' },
  ];

  for (const { label, text } of NO_TRIGGER_CASES) {
    it(label, () => {
      const result = detectHumanApprovalTriggers(text);
      assert.equal(
        result.required,
        false,
        `Expected NO human approval required for: "${text}" (triggers: ${JSON.stringify(result.triggers)})`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Low-confidence candidates: detected but NOT required in regex-only mode
// (These were previously high-confidence triggers; after the tier split they
// appear in candidates[] but do NOT set required=true without an adjudicator.)
// ---------------------------------------------------------------------------
describe('detectHumanApprovalCandidates — low-confidence candidates detected', () => {
  const LOW_CONF_CASES = [
    { label: 'deployment keyword (benign context)', text: 'Run deployment to production' },
    { label: 'external posting (benign)', text: 'Send external posting to the Slack channel' },
    { label: 'external post (no ing)', text: 'Trigger an external post to the webhook' },
    { label: 'cron keyword', text: 'Register cron job for nightly cleanup' },
    { label: 'auth keyword', text: 'Modify auth flow for SSO integration' },
    { label: 'deploy (partial match via deployment)', text: 'Trigger deployment pipeline' },
    { label: 'CRON (uppercase)', text: 'Schedule CRON task at midnight' },
    { label: 'deploying to production', text: 'deploying to production environment' },
    { label: 'deployments (plural)', text: 'list of deployments scheduled today' },
    { label: 'send to slack', text: 'send to slack channel #alerts' },
    { label: 'send email notification', text: 'send email to the team after completion' },
    { label: 'webhook notification', text: 'webhook notification will be sent on success' },
    { label: 'authenticate user', text: 'authenticate user via OAuth2' },
    { label: 'authorization required', text: 'authorization required for this endpoint' },
  ];

  for (const { label, text } of LOW_CONF_CASES) {
    it(`${label} — candidates found but required=false`, () => {
      const { candidates } = detectHumanApprovalCandidates(text);
      assert.ok(candidates.length > 0, `Expected at least one candidate for: "${text}"`);
      // In regex-only mode these low-confidence matches do NOT set required=true
      const result = detectHumanApprovalTriggers(text);
      assert.equal(
        result.required,
        false,
        `regex-only should NOT require approval for: "${text}" (triggers: ${JSON.stringify(result.triggers)})`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// adjudicateHumanApproval — interface tests
// ---------------------------------------------------------------------------
describe('adjudicateHumanApproval', () => {
  it('regex-only mode: high-confidence candidate → required=true', async () => {
    const { candidates } = detectHumanApprovalCandidates('rm -rf /data');
    const result = await adjudicateHumanApproval({ candidates });
    assert.equal(result.required, true);
    assert.equal(result.mode, 'regex-only');
    assert.ok(Array.isArray(result.triggers));
    assert.ok(Array.isArray(result.evidence));
  });

  it('regex-only mode: only low-confidence candidates → required=false', async () => {
    const { candidates } = detectHumanApprovalCandidates('deploy to staging');
    const result = await adjudicateHumanApproval({ candidates });
    assert.equal(result.required, false);
    assert.equal(result.mode, 'regex-only');
  });

  it('llm-adjudicated mode: adjudicator returning true → required=true', async () => {
    const { candidates } = detectHumanApprovalCandidates('deploy to staging');
    const adjudicator = async () => true;
    const result = await adjudicateHumanApproval({ candidates, adjudicator });
    assert.equal(result.required, true);
    assert.equal(result.mode, 'llm-adjudicated');
  });

  it('llm-adjudicated mode: adjudicator returning false → required=false', async () => {
    const { candidates } = detectHumanApprovalCandidates('rm -rf /data');
    // Simulate adjudicator deciding this is actually safe (unlikely, but tests the wiring)
    const adjudicator = async () => false;
    const result = await adjudicateHumanApproval({ candidates, adjudicator });
    assert.equal(result.required, false);
    assert.equal(result.mode, 'llm-adjudicated');
  });

  it('evidence array includes all candidates (audit trail)', async () => {
    const text = 'rm -rf /data and also deploy to staging';
    const { candidates } = detectHumanApprovalCandidates(text);
    const result = await adjudicateHumanApproval({ candidates });
    assert.deepEqual(result.evidence, candidates);
    assert.ok(
      result.evidence.length >= 2,
      'should include both high and low confidence candidates'
    );
  });

  it('candidate shape: trigger, snippet, confidence, source', () => {
    const { candidates } = detectHumanApprovalCandidates('rm -rf /important');
    assert.ok(candidates.length > 0, 'expected candidates');
    const c = candidates[0];
    assert.ok(typeof c.trigger === 'string' && c.trigger.length > 0);
    assert.ok(typeof c.snippet === 'string');
    assert.ok(c.confidence === 'high' || c.confidence === 'low');
    assert.equal(c.source, 'regex');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('detectHumanApprovalTriggers — edge cases', () => {
  it('returns false for empty string', () => {
    assert.deepEqual(detectHumanApprovalTriggers(''), { required: false, triggers: [] });
  });

  it('returns false for null/undefined (coerced)', () => {
    assert.deepEqual(detectHumanApprovalTriggers(null), { required: false, triggers: [] });
    assert.deepEqual(detectHumanApprovalTriggers(undefined), { required: false, triggers: [] });
  });

  it('accumulates multiple triggers in one text', () => {
    const result = detectHumanApprovalTriggers(
      'deployment involving credential update and billing change'
    );
    assert.equal(result.required, true);
    assert.ok(result.triggers.includes('deployment'), 'deployment should be in triggers');
    assert.ok(result.triggers.includes('credential'), 'credential should be in triggers');
    assert.ok(result.triggers.includes('billing'), 'billing should be in triggers');
  });
});
