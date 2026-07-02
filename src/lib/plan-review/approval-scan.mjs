/**
 * Human-approval artifact scan (#1363, extracted from review-plan.mjs).
 *
 * Scans the pbi-input and plan artifacts for human-approval triggers and
 * converts them into findings + an audit trail. Extracted verbatim from
 * runReviewPlan so review-plan.mjs stays focused on artifact routing and
 * assembly — behavior is unchanged (the #1348 / #1357 contract tests and the
 * plan-review canary suite pin it).
 *
 * Responsibilities:
 *  - per-file scan (finding `file` attribution, gemini review #1168),
 *  - LLM adjudicator wiring (#1348 S1): default derivation only on the
 *    executeReview path (--plan-only stays no-LLM); escalation-only contract
 *    lives in adjudicateHumanApproval,
 *  - cross-file trigger dedup with stable finding IDs (#1170 F5),
 *  - audit entries (mode + candidate count) for supervisability (#1347).
 *
 * Non-blocking by design: read errors fall back to empty text so the rest of
 * the artifact is unaffected.
 */

import {
  detectHumanApprovalCandidates,
  adjudicateHumanApproval,
} from './human-approval-policy.mjs';
import { createHumanApprovalAdjudicator } from './llm-adjudicator.mjs';

/**
 * @param {object} opts
 * @param {object} opts.resolved - resolved artifacts map (pbi-input / plan)
 * @param {object} opts.artifact - the artifact being built (findings mutated)
 * @param {string} opts.phase - SDLC phase for emitted findings
 * @param {boolean} opts.executeReview - gates default adjudicator derivation
 * @param {Function|null|undefined} opts.humanApprovalAdjudicator - explicit
 *   adjudicator override; undefined = derive default, null = regex-only
 * @param {object} opts.config - effective config (adjudicator model fallback)
 * @param {(p: string) => Promise<string>} opts.readFileImpl
 * @returns {Promise<{ humanApprovalRequired: boolean, audit: Array<object> }>}
 */
export async function scanArtifactsForHumanApproval({
  resolved,
  artifact,
  phase,
  executeReview,
  humanApprovalAdjudicator,
  config,
  readFileImpl,
}) {
  let humanApprovalRequired = false;
  const pbiPath = resolved?.['pbi-input']?.path;
  const planPath = resolved?.plan?.path;

  // LLM adjudicator wiring (#1348 S1). `undefined` = derive the default:
  // only the executeReview path may call an LLM (the --plan-only path is
  // documented as never making an LLM call). `null` (or an unavailable
  // environment — offline / no OpenAI-compatible key) keeps the pre-#1348
  // regex-only behavior. The adjudicator is escalation-only by contract.
  const effectiveAdjudicator =
    humanApprovalAdjudicator !== undefined
      ? humanApprovalAdjudicator
      : executeReview
        ? createHumanApprovalAdjudicator({ config })
        : null;
  // Per-file audit trail (mode + candidate count) surfaced under debug.
  const audit = [];

  // Stable IDs already emitted across both files, keyed by trigger name, to
  // deduplicate when the same trigger fires in both pbi-input and plan
  // (#1170 F5). Each trigger gets one finding (attributed to the FIRST file
  // that contained it); subsequent occurrences of the same trigger in other
  // files are merged into the existing finding's message rather than emitting
  // a duplicate. This preserves the invariant: one finding per trigger.
  const emittedTriggers = new Map(); // trigger → finding object
  const alsoInAppended = new Set(); // `${trigger}:${filePath}` pairs already appended

  const scanFile = async (filePath) => {
    let text = '';
    try {
      text = await readFileImpl(filePath);
    } catch {
      // non-blocking — missing / unreadable file is not an error
    }
    const { candidates } = detectHumanApprovalCandidates(text);
    const approval = await adjudicateHumanApproval({
      text,
      candidates,
      artifactKind: filePath === pbiPath ? 'pbi-input' : 'plan',
      adjudicator: effectiveAdjudicator,
    });
    if (candidates.length > 0) {
      audit.push({
        file: filePath,
        mode: approval.mode,
        candidates: candidates.length,
        required: approval.required,
      });
    }
    if (approval.required) {
      humanApprovalRequired = true;
      artifact.findings = artifact.findings ?? [];

      // Determine new triggers not yet emitted (dedup cross-file)
      const newTriggers = approval.triggers.filter((t) => !emittedTriggers.has(t));
      const dupTriggers = approval.triggers.filter((t) => emittedTriggers.has(t));

      // Merge duplicate triggers into the existing finding's message
      for (const t of dupTriggers) {
        const existing = emittedTriggers.get(t);
        const key = `${t}:${filePath}`;
        if (existing && !existing.file.includes(filePath) && !alsoInAppended.has(key)) {
          existing.message += `; also in ${filePath}`;
          alsoInAppended.add(key);
        }
      }

      if (newTriggers.length > 0) {
        // Derive a stable finding ID from the trigger names and file role
        // so the finding ID is deterministic across runs (#1170 F5).
        const fileRole = filePath === pbiPath ? 'pbi' : 'plan';
        const triggerId = newTriggers[0].replace(/[^a-z0-9-]/g, '-');
        const id = `rr-human-approval-${fileRole}-${triggerId}`;
        const finding = {
          id,
          ruleId: 'rr-plan-review-human-approval',
          severity: 'info',
          // `phase` is required by the finding schema — its absence made any
          // artifact containing this finding schema-invalid (latent since
          // #1348; surfaced by the S2 gate E2E test that ajv-validates a
          // triggering artifact).
          phase,
          title: 'Human approval required',
          message: `Plan contains triggers requiring human approval: ${newTriggers.join(', ')}`,
          file: filePath,
        };
        artifact.findings.push(finding);
        for (const t of newTriggers) {
          emittedTriggers.set(t, finding);
        }
      }
    }
  };

  if (pbiPath) await scanFile(pbiPath);
  if (planPath) await scanFile(planPath);

  return { humanApprovalRequired, audit };
}
