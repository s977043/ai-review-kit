// Shared CLI render / output helpers.
//
// Extracted verbatim from src/cli.mjs as part of the CLI dispatch refactor
// (split main() into per-subcommand handlers). These helpers are shared by the
// `doctor` and default `run` handlers and by cli.mjs itself, so they live in a
// standalone module to avoid a circular import between cli.mjs and the command
// handlers. Behavior, messages, and exit codes are unchanged; only the enclosing
// module and the relative import depth differ from the original inline code.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { severityToPriority } from '../lib/finding-factory.mjs';
import { resolveVerdict, scoreReview } from '../lib/scoring/engine.mjs';
import { AXES, AXIS_LABELS_JA } from '../lib/scoring/rubric.mjs';
import { deriveRunGate } from '../lib/run-gate.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const MAX_PROMPT_PREVIEW_LENGTH = 800;
const MAX_RAW_LLM_OUTPUT_PREVIEW_LENGTH = 1500;
export const MAX_DIFF_PREVIEW_LINES = 200;
const COMMENT_MARKER = '<!-- river-review -->';

export function printHintLines(lines = []) {
  const hints = lines.filter(Boolean);
  if (!hints.length) return;
  console.error('\nHints:');
  hints.forEach((line) => console.error(`- ${line}`));
}

function formatPlan(plan) {
  // Defensive defaults: a plan may arrive without selected/skipped (e.g. an
  // empty `{}` from `--explain` when no plan was computed). Never throw.
  const selected = (plan?.selected ?? []).map((skill) => skill.metadata?.id ?? skill.id);
  const skipped = (plan?.skipped ?? []).map((item) => ({
    id: item.skill?.metadata?.id ?? item.skill?.id,
    reasons: item.reasons ?? [],
  }));
  const reasonCounts = skipped.reduce((acc, item) => {
    (item.reasons || []).forEach((reason) => {
      acc.set(reason, (acc.get(reason) ?? 0) + 1);
    });
    return acc;
  }, new Map());
  return { selected, skipped, reasonCounts };
}

export function printPlan(plan) {
  const summary = formatPlan(plan);
  if (summary.selected.length) {
    console.log(`Selected skills (${summary.selected.length}): ${summary.selected.join(', ')}`);
  } else {
    console.log('Selected skills (0): none matched this diff');
  }
  if (summary.skipped.length) {
    console.log('Skipped skills:');
    summary.skipped.forEach((item) => {
      console.log(`- ${item.id}: ${item.reasons.join('; ')}`);
    });
    if (summary.reasonCounts.size) {
      console.log('Skip reasons summary:');
      for (const [reason, count] of summary.reasonCounts.entries()) {
        console.log(`- ${reason}: ${count}`);
      }
    }
  }
}

export function printComments(comments) {
  if (!comments.length) {
    console.log('No review comments generated.');
    return;
  }
  console.log('Review comments:');
  comments.forEach((comment) => {
    console.log(`- ${comment.file}:${comment.line}: ${comment.message}`);
  });
}

function formatMessageForMarkdown(message) {
  const labels = ['Finding', 'Evidence', 'Impact', 'Fix', 'Severity', 'Confidence'];
  let result = message;
  for (const label of labels) {
    result = result.replace(new RegExp(`\\s*${label}:`, 'g'), `\n  - **${label}:**`);
  }
  return result;
}

function groupCommentsBySkill(comments) {
  return (comments ?? []).reduce((groups, comment) => {
    const key = comment.skillId || '';
    (groups[key] = groups[key] || []).push(comment);
    return groups;
  }, {});
}

/**
 * Markdown インジェクション対策: 特殊文字をエスケープ
 */
function sanitizeForMarkdown(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&')
    .replace(/\n/g, ' ');
}

function formatCommentsMarkdown(comments) {
  if (!comments?.length) return '_No findings._';

  // スキル単位でグループ化
  const bySkill = groupCommentsBySkill(comments);
  const entries = Object.entries(bySkill);

  // スキルIDがないグループのみの場合は従来形式
  if (entries.length === 1 && entries[0][0] === '') {
    return comments
      .map((c) => `- \`${c.file}:${c.line}\`${formatMessageForMarkdown(c.message)}`)
      .join('\n');
  }

  // skillId でソートして出力順序を安定化
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  // スキル単位でセクション化
  return entries
    .map(([skillId, items]) => {
      // skillId をサニタイズして Markdown インジェクションを防止
      const safeSkillId = sanitizeForMarkdown(skillId);
      const header = skillId ? `#### 🔍 ${safeSkillId}` : '#### その他';
      const body = items
        .map((c) => `- \`${c.file}:${c.line}\`${formatMessageForMarkdown(c.message)}`)
        .join('\n');
      return `${header}\n${body}`;
    })
    .join('\n\n');
}

function formatPlanMarkdown(plan) {
  const summary = formatPlan(plan);
  const selected = summary.selected.length
    ? summary.selected.map((id) => `- \`${id}\``).join('\n')
    : '- _none_';

  if (!summary.skipped.length) {
    return `### 選択されたスキル (${summary.selected.length})\n${selected}\n`;
  }

  const skippedLines = summary.skipped
    .map((item) => `- \`${item.id}\`: ${item.reasons.join('; ')}`)
    .join('\n');
  return `### 選択されたスキル (${summary.selected.length})\n${selected}\n\n<details>\n<summary>スキップされたスキル (${summary.skipped.length})</summary>\n\n${skippedLines}\n\n</details>\n`;
}

function formatDebugSummaryMarkdown(result) {
  const debug = result.reviewDebug ?? {};
  const llmStatus = debug.llmUsed
    ? `used (\`${debug.llmModel}\`)`
    : debug.llmSkipped || debug.llmError
      ? `skipped (${debug.llmSkipped || debug.llmError})`
      : 'not used';

  const plan = result.plan ?? {};
  const plannerStatus = formatPlannerStatus(plan, { markdown: true });
  const impactTags = Array.isArray(plan?.impactTags) ? plan.impactTags : [];
  const impactSummary = impactTags.length ? impactTags.map((t) => `\`${t}\``).join(', ') : '`none`';

  return [
    `- LLM: ${llmStatus}`,
    `- Planner: ${plannerStatus}`,
    `- Impact tags: ${impactSummary}`,
    `- 変更ファイル数: ${result.changedFiles.length}`,
    `- トークン見積もり: ${result.tokenEstimate}`,
  ].join('\n');
}

export function formatPlannerStatus(plan, { markdown = false } = {}) {
  const wrap = (value) => (markdown ? `\`${value}\`` : value);
  const requested = Boolean(plan?.plannerRequested);
  const mode = plan?.plannerMode || 'off';
  if (!requested || mode === 'off') return wrap('off');
  if (plan?.plannerSkipped) return `${wrap(mode)} skipped (${plan.plannerSkipped})`;
  if (plan?.plannerFallback) {
    const reason = plan?.plannerError || '';
    return reason ? `${wrap(mode)} fallback (${reason})` : `${wrap(mode)} fallback`;
  }
  return plan?.plannerUsed ? `${wrap(mode)} used` : `${wrap(mode)} not used`;
}

function logPreview(title, text, maxLength, log, { leadingNewline = false } = {}) {
  if (!text) return;
  const preview = text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  const prefix = leadingNewline ? '\n' : '';
  log(`${prefix}${title}:`);
  log(preview);
}

function formatRiskSummaryMarkdown(plan) {
  const risk = plan?.riskAssessment;
  if (!risk) return '';
  const badge =
    risk.aggregateAction === 'require_human_review'
      ? '🔴 require_human_review'
      : risk.aggregateAction === 'escalate'
        ? '🟡 escalate'
        : '🟢 comment_only';
  const lines = ['### リスク評価\n', '**判定**: ' + badge + '\n'];
  if (risk.humanReviewFiles?.length) {
    lines.push('**人間レビュー必須**:');
    for (const f of risk.humanReviewFiles) lines.push('- ' + sanitizeForMarkdown(f));
    lines.push('');
  }
  if (risk.escalatedFiles?.length) {
    lines.push('**エスカレーション対象**:');
    for (const f of risk.escalatedFiles) lines.push('- ' + sanitizeForMarkdown(f));
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * #1067: true when no LLM key is configured (LLM review skipped) AND there are
 * no static findings — i.e. the run would otherwise post a value-less boilerplate
 * PR comment (skipped-skills list / impact tags / token estimate). Used to emit a
 * single concise note instead.
 */
export function isLlmlessEmptyReview(result) {
  const debug = result?.reviewDebug ?? {};
  const llmKeyMissing = typeof debug.llmSkipped === 'string' && /not set/i.test(debug.llmSkipped);
  const noFindings = (result?.comments?.length ?? 0) === 0;
  return llmKeyMissing && noFindings;
}

export function printMarkdownReport(result, phase) {
  if (isLlmlessEmptyReview(result)) {
    console.log(
      `${COMMENT_MARKER}
## River Review

- フェーズ: \`${phase}\`
- LLM レビュー未設定（\`ANTHROPIC_API_KEY\` / \`OPENAI_API_KEY\` / \`GOOGLE_API_KEY\` のいずれも未設定）のため静的チェックのみ実行し、**指摘はありません**。いずれか 1 つを設定すると LLM レビューが有効になり、リポジトリ固有の規約・差分スコープ等の観点でレビューします。`
    );
    return;
  }
  const header = `${COMMENT_MARKER}
## River Review

- フェーズ: \`${phase}\`
${formatDebugSummaryMarkdown(result)}
`;
  const planSection = formatPlanMarkdown(result.plan);
  const riskSection = formatRiskSummaryMarkdown(result.plan);
  const prioritySummary = formatPrioritySummaryMarkdown(result);
  const scoreSection = formatScoreSectionMarkdown(result, phase);
  const findings = `### 指摘\n${formatCommentsMarkdown(result.comments)}\n`;
  const suppressedSummary = formatSuppressedSummaryMarkdown(result.classified);
  console.log(
    [header, planSection, riskSection, prioritySummary, scoreSection, findings, suppressedSummary]
      .filter(Boolean)
      .join('\n')
  );
}

function formatSuppressedSummaryMarkdown(classified) {
  if (!classified?.suppressed?.length) return null;
  const counts = {};
  for (const f of classified.suppressed) {
    counts[f.suppressReason] = (counts[f.suppressReason] ?? 0) + 1;
  }
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r, n]) => `${r}(${n})`)
    .join(', ');
  return `> _${classified.suppressed.length} 件の指摘を抑制しました (主な理由: ${top})_\n`;
}

function formatPrioritySummaryMarkdown(result) {
  const findings = result.findings ?? [];
  const counts = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const f of findings) {
    const p = severityToPriority(f.severity);
    counts[p]++;
  }

  const lines = ['### 優先度サマリー\n'];

  if (counts.P1 > 0) {
    lines.push(`> **P1 (マージ前必須修正): ${counts.P1} 件**\n`);
  }

  lines.push(
    `- P1 (must fix before merge): ${counts.P1} 件`,
    `- P2 (should fix or waive): ${counts.P2} 件`,
    `- P3 (recommended improvement): ${counts.P3} 件`,
    `- P4 (informational): ${counts.P4} 件`,
    ''
  );

  const suppressed = result.classified?.suppressed ?? [];
  if (suppressed.length > 0) {
    const reasonCounts = {};
    for (const f of suppressed) {
      reasonCounts[f.suppressReason] = (reasonCounts[f.suppressReason] ?? 0) + 1;
    }
    const topReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r, n]) => `${r}(${n})`)
      .join(', ');
    lines.push(`- 抑制済み: ${suppressed.length} 件 (主な理由: ${topReasons})`, '');
  }

  const humanReviewFiles = result.plan?.riskMap?.require_human_review ?? [];
  if (humanReviewFiles.length > 0) {
    lines.push('> **Human review required**');
    for (const f of humanReviewFiles) lines.push(`> - ${sanitizeForMarkdown(f)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatScoreSectionMarkdown(result, phase) {
  const artifact = formatJsonOutput(result, phase);
  const score = scoreReview(artifact.issues ?? []);
  // formatJsonOutput already resolved the canonical verdict; reuse it so the
  // Markdown score section cannot drift from JSON/YAML/HTML (#1170 F3).
  score.verdict = resolveVerdict(artifact.decision, score.verdict);
  const lines = ['### スコア (参考値)'];
  lines.push('');
  lines.push(`結果(スコア): **${score.overall}/100**`);
  lines.push(`判定: **${score.verdict}**`);
  lines.push('');
  lines.push('内訳:');
  for (const axis of AXES) {
    lines.push(`- ${AXIS_LABELS_JA[axis]}: ${score.axes[axis]}/100`);
  }
  lines.push('');
  lines.push(
    '> スコアは severity と axis から決定論的に算出された **参考値** (`derived: true`)。HITL レビューと併用してください。'
  );
  lines.push('');
  return lines.join('\n');
}

/**
 * #1045 A3 (#1141): human-readable explanation of which skills / gates / config
 * tier were resolved for this run. A focused alias over the same deterministic
 * resolution the planner already computed — printed to stderr so it never
 * corrupts machine-readable stdout (json / yaml).
 */
export function printExplain(result, { log = console.error } = {}) {
  const summary = formatPlan(result?.plan ?? {});
  log('\nResolution (--explain):');

  // Config tier that won (CLI > repo-local > global > built-in default).
  const sourceLabel =
    result?.configSource === 'file'
      ? 'repository-local'
      : result?.configSource === 'global'
        ? 'user-global'
        : 'built-in default';
  log(`- Config: ${sourceLabel}${result?.configPath ? ` (${result.configPath})` : ''}`);

  // Skill / gate resolution.
  log(
    `- Planner: ${formatPlannerStatus(result?.plan ?? {})}` +
      (result?.manualReviewMode ? ` / review mode: ${result.manualReviewMode}` : '')
  );
  if (summary.selected.length) {
    log(`- Selected skills (${summary.selected.length}): ${summary.selected.join(', ')}`);
  } else {
    log('- Selected skills (0): none matched this diff');
  }
  if (summary.skipped.length) {
    log(`- Skipped skills (${summary.skipped.length}):`);
    summary.skipped.forEach((item) => {
      log(`  - ${item.id}: ${item.reasons.join('; ')}`);
    });
  }
}

export function printDebugInfo(result, { log = console.log } = {}) {
  const debug = result.reviewDebug ?? {};
  const rawTokens = result.rawTokenEstimate ?? result.tokenEstimate;
  const reduction = result.reduction ?? 0;
  const plannerStatus = formatPlannerStatus(result.plan ?? {});
  const impactTags = Array.isArray(result.plan?.impactTags) ? result.plan.impactTags : [];
  log(`\nDebug info:
- LLM: ${debug.llmUsed ? `used (\`${debug.llmModel}\`)` : debug.llmSkipped || debug.llmError || 'not used'}
- Planner: ${plannerStatus}
- Impact tags: ${impactTags.join(', ') || 'none'}
- Token estimate (raw -> optimized): ${rawTokens} -> ${result.tokenEstimate} (${reduction}% reduction)
- Prompt truncated: ${debug.promptTruncated ? 'yes' : 'no'}
- Changed files (${result.changedFiles.length}): ${result.changedFiles.join(', ')}
- Project rules: ${result.projectRules ? 'present' : 'none'}
- Available contexts: ${(result.availableContexts || []).join(', ') || 'none'}
- Available dependencies: ${
    result.availableDependencies
      ? result.availableDependencies.join(', ')
      : 'not specified (skip disabled)'
  }
`);
  if (debug.llmError) {
    log(`LLM error: ${debug.llmError}`);
    // T64: パース失敗時に生のLLM出力が見えず切り分けができなかったため、
    // debug.rawLlmOutput があれば truncate してログに出す。
    logPreview('Raw LLM output', debug.rawLlmOutput, MAX_RAW_LLM_OUTPUT_PREVIEW_LENGTH, log);
  }
  logPreview('Prompt preview', debug.promptPreview, MAX_PROMPT_PREVIEW_LENGTH, log);
  logPreview(
    'Project-specific review rules (preview)',
    result.projectRules,
    MAX_PROMPT_PREVIEW_LENGTH,
    log,
    { leadingNewline: true }
  );
  if (result.plan?.skipped?.length) {
    log('\nSkipped skills detail:');
    result.plan.skipped.forEach((item) => {
      const id = item.skill?.metadata?.id ?? item.skill?.id ?? '(unknown)';
      log(`- ${id}: ${item.reasons.join('; ')}`);
    });
  }
  log('\n--- diff preview ---');
  log(result.diffText.split('\n').slice(0, MAX_DIFF_PREVIEW_LINES).join('\n'));
}

/**
 * Lazily compiled validator for schemas/output.schema.json (draft 2020-12).
 * Compiled once on first use; null if the schema cannot be loaded so a
 * validation problem never breaks JSON output emission.
 */
let outputSchemaValidator;
function getOutputSchemaValidator() {
  if (outputSchemaValidator !== undefined) return outputSchemaValidator;
  try {
    const schemaPath = fileURLToPath(new URL('../../schemas/output.schema.json', import.meta.url));
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    outputSchemaValidator = ajv.compile(schema);
  } catch (err) {
    console.error(`Warning: could not load output.schema.json for validation: ${err.message}`);
    outputSchemaValidator = null;
  }
  return outputSchemaValidator;
}

/**
 * Validate a formatted artifact against output.schema.json at runtime and
 * report violations to stderr (#1254). Reporting only — the artifact is still
 * returned so a non-conforming LLM payload surfaces loudly instead of failing
 * silently downstream.
 */
export function validateOutputArtifact(artifact) {
  const validate = getOutputSchemaValidator();
  if (!validate) return;
  if (!validate(artifact)) {
    console.error(
      `Warning: JSON output does not conform to schemas/output.schema.json:\n${JSON.stringify(
        validate.errors,
        null,
        2
      )}`
    );
  }
}

/**
 * Format review result as JSON conforming to schemas/output.schema.json.
 * Consumes the structured findings[] produced by the Finding Pipeline.
 * Additively includes a top-level `decision` field derived from scoreReview verdict.
 */
export function formatJsonOutput(result, phase) {
  const issueCountBySeverity = { info: 0, minor: 0, major: 0, critical: 0 };
  const issueCountByPhase = { upstream: 0, midstream: 0, downstream: 0 };

  const issues = (result.findings ?? []).map((f) => {
    issueCountBySeverity[f.severity]++;
    issueCountByPhase[phase] = (issueCountByPhase[phase] ?? 0) + 1;
    return {
      id: f.id,
      ruleId: f.ruleId,
      reviewer: f.reviewer,
      title: f.title,
      message: f.message,
      severity: f.severity,
      confidence: f.confidence,
      status: f.status,
      evidence: f.evidence,
      phase,
      file: f.file,
      ...(f.lineStart ? { line: f.lineStart } : {}),
      ...(f.lineEnd && f.lineEnd !== f.lineStart ? { lineEnd: f.lineEnd } : {}),
      ...(f.suggestion ? { suggestion: f.suggestion } : {}),
      ...(f.consensusLevel ? { consensusLevel: f.consensusLevel } : {}),
      ...(f.reviewerRole ? { reviewerRole: f.reviewerRole } : {}),
    };
  });

  const priorityCounts = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const f of result.findings ?? []) {
    const p = severityToPriority(f.severity);
    priorityCounts[p]++;
  }
  const prioritySummary = {
    counts: priorityCounts,
    requiresImmediateAttention: priorityCounts.P1 > 0,
  };

  const summary = { issueCountBySeverity, issueCountByPhase, prioritySummary };
  const riskAssessment = result.plan?.riskAssessment;
  if (riskAssessment) {
    summary.riskSummary = {
      aggregateAction: riskAssessment.aggregateAction,
      escalatedFiles: riskAssessment.escalatedFiles,
      humanReviewFiles: riskAssessment.humanReviewFiles,
    };
  }
  // Gate + decision derivation shared with the run-record audit trail
  // (#1350 S3): extracted to src/lib/run-gate.mjs so the persisted record
  // and the JSON output always carry the same gate.
  const { decision, gate } = deriveRunGate(result);

  const artifact = {
    issues,
    summary,
    ...(decision !== undefined ? { decision } : {}),
    ...(gate ? { gate } : {}),
    ...(result.teamLeadReport ? { teamLeadReport: result.teamLeadReport } : {}),
  };
  validateOutputArtifact(artifact);
  return artifact;
}

export function countChangedLines(files) {
  let lines = 0;
  for (const file of files ?? []) {
    for (const hunk of file.hunks ?? []) {
      lines += (hunk.lines ?? []).filter((l) => l.startsWith('+') || l.startsWith('-')).length;
    }
  }
  return lines;
}
