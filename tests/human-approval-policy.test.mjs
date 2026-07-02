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
    // Prod-deploy high-confidence canary (#1171 recall fix)
    { label: 'deploy to production (en)', text: 'deploy to production' },
    { label: 'deploy to prod (en)', text: 'deploy to prod' },
    { label: 'Japanese: 本番にデプロイする', text: '本番にデプロイする' },
    { label: 'Japanese: 本番へ反映', text: '本番へ反映する' },
    { label: 'kubectl apply prod yaml', text: 'kubectl apply -f prod.yaml' },
    { label: 'terraform apply', text: 'terraform apply' },
    { label: 'Japanese: データベース削除', text: 'データベース削除を実行する' },
    { label: 'Japanese: 秘密鍵', text: '秘密鍵をローテーションする' },
    // Adversarial euphemism canary (#1348 S1): plans that avoid literal
    // danger words must still trigger on semantic phrasings.
    {
      label: 'euphemism: 一時ディレクトリを再帰的に整理 (rm -rf avoidance)',
      text: 'ビルド後に一時ディレクトリを再帰的に整理するステップを追加する',
    },
    {
      label: 'euphemism: recursively clean up the temp directory',
      text: 'recursively clean up the temp directory after each build',
    },
    {
      label: 'euphemism: recursively purge old artifacts',
      text: 'recursively purge old artifacts from the workspace',
    },
    {
      label: 'euphemism: 接続情報 (secret avoidance)',
      text: '新しい環境へ接続情報を書き写す',
    },
    {
      label: 'euphemism: connection string',
      text: 'copy the connection string into the new config',
    },
    {
      label: 'euphemism: 環境変数ファイル (.env avoidance)',
      text: '環境変数ファイルを新しいサーバーに配置する',
    },
    {
      label: 'euphemism: 稼働環境へ反映 (本番 avoidance)',
      text: '検証完了後、稼働環境へ設定を反映する',
    },
    {
      label: 'euphemism: 実環境に適用 (本番 avoidance)',
      text: '実環境に新しい設定を適用する',
    },
    {
      label: 'euphemism: into the live environment',
      text: 'roll the change into the live environment',
    },
    {
      label: 'euphemism: テーブルを空にする (TRUNCATE avoidance)',
      text: '移行前にテーブルを空にする',
    },
    {
      label: 'euphemism: データベースを初期化 (DROP avoidance)',
      text: 'データベースを初期化してから再投入する',
    },
    {
      label: 'euphemism: empty the table',
      text: 'empty the table before re-import',
    },
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
    // Benign deploy mentions (noun/doc context) — no prod context
    { label: 'add a deployment note (benign)', text: 'add a deployment note' },
    { label: 'update deployment guide (benign)', text: 'update deployment guide' },
    { label: 'deployment is documented (benign)', text: 'deployment is documented' },
    // Benign phrasings near the new euphemism patterns (#1348 S1) — the
    // euphemism detectors must not over-trigger on ordinary tidy-up language.
    { label: 'ドキュメントを整理する (benign)', text: 'ドキュメントの構成を整理する' },
    { label: 'コードを整理する (benign)', text: '重複したユーティリティ関数を整理して共通化する' },
    {
      label: 'clean up code style (benign)',
      text: 'clean up the code style in the helpers module',
    },
    { label: 'empty array handling (benign)', text: 'handle the empty array case in the parser' },
    { label: '環境構築手順の更新 (benign)', text: '開発環境の構築手順を最新化する' },
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
    { label: 'deployment keyword (benign, no prod)', text: 'Run deployment to staging' },
    { label: 'external posting (benign)', text: 'Send external posting to the Slack channel' },
    { label: 'external post (no ing)', text: 'Trigger an external post to the webhook' },
    { label: 'cron keyword', text: 'Register cron job for nightly cleanup' },
    { label: 'auth keyword', text: 'Modify auth flow for SSO integration' },
    { label: 'deploy (partial match via deployment)', text: 'Trigger deployment pipeline' },
    { label: 'CRON (uppercase)', text: 'Schedule CRON task at midnight' },
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

  it('asymmetric escalation: adjudicator returning false can NOT overturn a HIGH match', async () => {
    const { candidates } = detectHumanApprovalCandidates('rm -rf /data');
    // Epic #1347 design principle: the LLM only contributes in the escalation
    // direction. Even if it deems the plan safe, the HIGH regex verdict wins.
    const adjudicator = async () => false;
    const result = await adjudicateHumanApproval({ candidates, adjudicator });
    assert.equal(result.required, true, 'HIGH-confidence regex verdict must not be loosened');
    assert.equal(result.mode, 'llm-adjudicated');
  });

  it('asymmetric escalation: adjudicator returning false on LOW-only → required=false', async () => {
    const { candidates } = detectHumanApprovalCandidates('deploy to staging');
    const adjudicator = async () => false;
    const result = await adjudicateHumanApproval({ candidates, adjudicator });
    assert.equal(result.required, false);
    assert.equal(result.mode, 'llm-adjudicated');
  });

  it('fail-safe: adjudicator throwing degrades to the regex verdict (regex-fallback)', async () => {
    const boom = async () => {
      throw new Error('LLM unavailable');
    };
    // LOW-only text: regex verdict is false
    const low = detectHumanApprovalCandidates('deploy to staging').candidates;
    const lowResult = await adjudicateHumanApproval({ candidates: low, adjudicator: boom });
    assert.equal(lowResult.required, false);
    assert.equal(lowResult.mode, 'regex-fallback');
    // HIGH text: regex verdict is true and survives the failure
    const high = detectHumanApprovalCandidates('rm -rf /data').candidates;
    const highResult = await adjudicateHumanApproval({ candidates: high, adjudicator: boom });
    assert.equal(highResult.required, true);
    assert.equal(highResult.mode, 'regex-fallback');
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
// ReDoS regression: patterns must complete quickly on long non-matching input
// ---------------------------------------------------------------------------
describe('detectHumanApprovalTriggers — ReDoS regression', () => {
  it('ja-prod-deploy pattern completes quickly on long non-matching input', () => {
    const longInput = '本番' + 'あ'.repeat(5000);
    const start = Date.now();
    detectHumanApprovalTriggers(longInput);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `ReDoS: ja-prod-deploy took ${elapsed}ms (expected < 100ms)`);
  });

  it('ja-deploy-to-prod pattern completes quickly on long non-matching input', () => {
    const longInput = 'デプロイ' + 'あ'.repeat(5000);
    const start = Date.now();
    detectHumanApprovalTriggers(longInput);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `ReDoS: ja-deploy-to-prod took ${elapsed}ms (expected < 100ms)`);
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
