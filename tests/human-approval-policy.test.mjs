import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectHumanApprovalTriggers } from '../src/lib/plan-review/human-approval-policy.mjs';

// ---------------------------------------------------------------------------
// Canary: should_trigger — texts that MUST always trigger human approval
// ---------------------------------------------------------------------------
describe('detectHumanApprovalTriggers — should_trigger canary', () => {
  const TRIGGER_CASES = [
    { label: 'deployment keyword', text: 'Run deployment to production' },
    { label: 'credential keyword', text: 'Store the API credential in config' },
    { label: 'secret keyword', text: 'Write secret to env file' },
    { label: 'destructive command', text: 'Execute destructive command: rm -rf /data' },
    { label: 'config overwrite', text: 'This step will config overwrite the base settings' },
    { label: 'external posting', text: 'Send external posting to the Slack channel' },
    { label: 'external post (no ing)', text: 'Trigger an external post to the webhook' },
    { label: 'cron keyword', text: 'Register cron job for nightly cleanup' },
    { label: 'memory write', text: 'Perform a memory write to the agent context' },
    { label: 'billing keyword', text: 'Update billing plan for the organization' },
    { label: 'provider change', text: 'Apply provider change from AWS to GCP' },
    { label: 'auth keyword', text: 'Modify auth flow for SSO integration' },
    { label: 'permission change', text: 'Apply permission change to IAM roles' },
    { label: 'user data', text: 'Export user data for GDPR compliance' },
    // Euphemisms / compound phrases
    { label: 'credentials (plural)', text: 'Rotate credentials in vault' },
    { label: 'secrets manager', text: 'Read from secrets manager' },
    { label: 'deploy (partial match via deployment)', text: 'Trigger deployment pipeline' },
    { label: 'CRON (uppercase)', text: 'Schedule CRON task at midnight' },
    { label: 'BILLING (uppercase)', text: 'BILLING team will review' },
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
// Canary: should_not_trigger — texts that must NOT falsely trigger
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
  ];

  for (const { label, text } of NO_TRIGGER_CASES) {
    it(label, () => {
      const result = detectHumanApprovalTriggers(text);
      assert.equal(
        result.required,
        false,
        `Expected NO human approval required for: "${text}" (triggers: ${JSON.stringify(result.triggers)})`
      );
      assert.deepEqual(result.triggers, []);
    });
  }
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
