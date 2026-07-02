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
    // direction. Since #1357 the adjudicator is not even INVOKED for a HIGH
    // verdict (no decision is open), which is strictly stronger: a compromised
    // LLM gets no opportunity at all.
    let invoked = false;
    const adjudicator = async () => {
      invoked = true;
      return false;
    };
    const result = await adjudicateHumanApproval({ candidates, adjudicator });
    assert.equal(result.required, true, 'HIGH-confidence regex verdict must not be loosened');
    assert.equal(result.mode, 'llm-skipped');
    assert.equal(invoked, false, 'adjudicator must not be called when regex already requires');
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
    // LOW-only text: escalation decision is open → adjudicator runs, throws,
    // and the verdict degrades to regex-only (false).
    const low = detectHumanApprovalCandidates('deploy to staging').candidates;
    const lowResult = await adjudicateHumanApproval({ candidates: low, adjudicator: boom });
    assert.equal(lowResult.required, false);
    assert.equal(lowResult.mode, 'regex-fallback');
    // HIGH text (#1357): no escalation decision is open, so the adjudicator is
    // skipped entirely — it cannot even throw.
    const high = detectHumanApprovalCandidates('rm -rf /data').candidates;
    const highResult = await adjudicateHumanApproval({ candidates: high, adjudicator: boom });
    assert.equal(highResult.required, true);
    assert.equal(highResult.mode, 'llm-skipped');
  });

  it('adjudicator is skipped when there are zero candidates (#1357)', async () => {
    let invoked = false;
    const adjudicator = async () => {
      invoked = true;
      return true; // even a YES here must not create an evidence-free verdict
    };
    const result = await adjudicateHumanApproval({ candidates: [], adjudicator });
    assert.equal(result.required, false, 'zero candidates can never become required');
    assert.equal(result.mode, 'llm-skipped');
    assert.equal(invoked, false, 'adjudicator must not run without candidates');
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

// ---------------------------------------------------------------------------
// #1356 — detector hardening regressions (bypass + precision)
// All cases were empirically demonstrated in the post-merge review of #1354.
// ---------------------------------------------------------------------------
describe('detectHumanApprovalCandidates — #1356 hardening regressions', () => {
  const highTriggers = (text) =>
    detectHumanApprovalCandidates(text).candidates.filter((c) => c.confidence === 'high');

  it('detects rm -rf split by a zero-width format char (U+2060)', () => {
    const result = highTriggers('r⁠m -rf /tmp/build');
    assert.ok(
      result.some((c) => c.trigger === 'rm-rf'),
      'Cf-category removal must defeat zero-width insertion'
    );
  });

  it('detects a euphemism split across a Markdown line wrap', () => {
    const result = highTriggers('一時ディレクトリを再帰的に\n整理する');
    assert.ok(
      result.some((c) => c.trigger === 'ja-recursive-cleanup-euphemism'),
      'whitespace folding must defeat newline splitting'
    );
  });

  it('does not fire on a benign verification sentence (state, not action)', () => {
    assert.equal(
      highTriggers('移行後にテーブルが空になっていないことを検証する').length,
      0,
      'state descriptions must not trip ja-empty-storage-euphemism'
    );
  });

  it('does not fire on adjectival "empty tables/folders"', () => {
    assert.equal(
      highTriggers('Migrations skip empty tables and empty folders automatically').length,
      0,
      'adjectival usage must not trip empty-storage-euphemism'
    );
  });

  it('does not fire on source-only recursive refactor phrasing', () => {
    assert.equal(
      highTriggers('The module tree was recursively refactored and cleaned up for readability')
        .length,
      0,
      'code-maintenance phrasing must not trip recursive-cleanup-euphemism'
    );
  });

  it('still fires with up to 4 inserted words before the cleanup verb', () => {
    const result = highTriggers(
      'The job recursively and then completely wipes the cache directory'
    );
    assert.ok(
      result.some((c) => c.trigger === 'recursive-cleanup-euphemism'),
      'widened insertion span must keep detecting'
    );
  });

  it('still fires on the verb usages the euphemism patterns exist for', () => {
    assert.ok(
      highTriggers('テーブルを新構成で作り直す前にテーブルを空にする').some(
        (c) => c.trigger === 'ja-empty-storage-euphemism'
      )
    );
    assert.ok(
      highTriggers('The cleanup step empties the staging bucket nightly').some(
        (c) => c.trigger === 'empty-storage-euphemism'
      )
    );
  });
});

// ---------------------------------------------------------------------------
// #1356 — gemini review bypasses (tempered token / determiner-less verb)
// ---------------------------------------------------------------------------
describe('detectHumanApprovalCandidates — #1356 review-round hardening', () => {
  const highTriggers = (text) =>
    detectHumanApprovalCandidates(text).candidates.filter((c) => c.confidence === 'high');

  it('still fires when an excluded word appears AFTER the cleanup verb', () => {
    assert.ok(
      highTriggers('The job recursively wipes the renamed folder').some(
        (c) => c.trigger === 'recursive-cleanup-euphemism'
      ),
      'whole-span lookahead was bypassable by mentioning "renamed" nearby'
    );
  });

  it('fires on determiner-less verb usage of empty + singular noun', () => {
    assert.ok(
      highTriggers('The retention step will empty staging bucket after export').some(
        (c) => c.trigger === 'empty-storage-euphemism'
      )
    );
  });

  it('does not fire on adjectival singular with a preceding determiner', () => {
    assert.equal(
      highTriggers('The empty table is dropped from the report layout').length,
      0,
      'lookbehind must treat "the empty table" as adjectival'
    );
  });
});

// ---------------------------------------------------------------------------
// #1356 — reviewer findings round 2 (list boundaries / noun-phrase recall /
// LOW twin defense-in-depth / ReDoS for new patterns)
// ---------------------------------------------------------------------------
describe('detectHumanApprovalCandidates — #1356 round-2 regressions', () => {
  const highTriggers = (text) =>
    detectHumanApprovalCandidates(text).candidates.filter((c) => c.confidence === 'high');
  const allTriggers = (text) => detectHumanApprovalCandidates(text).candidates;

  it('does not match a phrase spanning two separate list items', () => {
    assert.equal(
      highTriggers('1. ログを再帰的に検索\n2. 整理したレポートを出す').length,
      0,
      'list-item boundary must stop phrase-span patterns'
    );
  });

  it('still matches a phrase split by a hard-wrapped continuation line', () => {
    assert.ok(
      highTriggers('一時ディレクトリを再帰的に\n   整理する後処理を追加する').some(
        (c) => c.trigger === 'ja-recursive-cleanup-euphemism'
      ),
      'continuation lines (no list marker) fold into one sentence'
    );
  });

  it('detects noun-stopped 初期化 task items (recall)', () => {
    assert.ok(
      highTriggers('ステージングテーブルの初期化').some(
        (c) => c.trigger === 'ja-empty-storage-euphemism'
      )
    );
  });

  it('does not fire on passive 初期化されて verification phrasing', () => {
    assert.equal(highTriggers('データベースが初期化されていないことを確認する').length, 0);
  });

  it('poisoned exclusion phrasing still surfaces as a LOW candidate', () => {
    const candidates = allTriggers('recursively refactor and wipe the scratch directory');
    assert.equal(
      candidates.filter((c) => c.confidence === 'high').length,
      0,
      'HIGH tier stays quiet (tempered exclusion)'
    );
    assert.ok(
      candidates.some((c) => c.trigger === 'recursive-cleanup-lowconf'),
      'exclusion-free LOW twin must keep the case visible to the adjudicator'
    );
  });

  it('new euphemism patterns are not vulnerable to slow scans (ReDoS)', () => {
    const longInput = `recursively ${'word '.repeat(20000)} nothing`;
    const start = Date.now();
    detectHumanApprovalCandidates(longInput);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `ReDoS: scan took ${elapsed}ms (expected < 500ms)`);
  });
});
