// Shared CLI render / output helpers.
//
// Extracted verbatim from src/cli.mjs as part of the CLI dispatch refactor
// (split main() into per-subcommand handlers). These helpers are shared by the
// `doctor` and default `run` handlers and by cli.mjs itself, so they live in a
// standalone module to avoid a circular import between cli.mjs and the command
// handlers. Behavior, messages, and exit codes are unchanged; only the enclosing
// module and the relative import depth differ from the original inline code.
import { readFileSync } from 'node:fs';
import {
  RESERVED_FINDING_LABELS,
  SEVERITY_RANK,
  severityToPriority,
} from '../lib/finding-factory.mjs';
import { resolveVerdict, scoreReview } from '../lib/scoring/engine.mjs';
import { AXES, AXIS_LABELS_JA } from '../lib/scoring/rubric.mjs';
import { deriveRunGate } from '../lib/run-gate.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const MAX_PROMPT_PREVIEW_LENGTH = 800;
const MAX_RAW_LLM_OUTPUT_PREVIEW_LENGTH = 1500;
export const MAX_DIFF_PREVIEW_LINES = 200;
const COMMENT_MARKER = '<!-- river-review -->';

/**
 * #1713: severity vocabulary for the human-facing markdown digest.
 *
 * The label set and their ordering are NOT redefined here — they are derived
 * from `SEVERITY_RANK` (the severity SSoT in finding-factory), so this module
 * cannot drift into a second ordering. Only the emoji are local.
 *
 * The same emoji mapping also exists in
 * `runners/github-action/post-inline-comments.cjs`, which is a standalone
 * `actions/github-script` runner: it is CommonJS, is not bundled by
 * `npm run build:action`, and cannot import ESM from `src/`. Sharing one
 * constant across that boundary is a separate change (see #1713 follow-ups).
 */
const SEVERITY_EMOJI = { critical: '🔴', major: '🟠', minor: '🟡', info: 'ℹ️' };
const SEVERITY_ORDER = Object.keys(SEVERITY_RANK).sort(
  (a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a]
);
/**
 * Progressive-disclosure boundary: `major` and above (= P1 / P2 via
 * `severityToPriority`) stay expanded; `minor` / `info` are folded into a
 * `<details>` block. Nothing is dropped or truncated — folding is not hiding.
 */
const EXPAND_FROM_RANK = SEVERITY_RANK.major;

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
  // #1666: import the label set instead of re-listing it here. The local copy
  // had drifted — `Suggestion`, `Scope`, and the traceability refs were never
  // broken onto their own bullet, so they ran into the preceding field.
  const labels = RESERVED_FINDING_LABELS;
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

/**
 * #1713: neutralize closing tags that would let free-form finding text escape
 * the `<details>` block it is folded into. The text is preserved verbatim as
 * escaped literals — nothing is deleted or truncated.
 *
 * @param {string} text
 * @returns {string}
 */
function neutralizeDetailsClosers(text) {
  return String(text).replace(/<\/(details|summary)\b/gi, '&lt;/$1');
}

/**
 * #1713: wrap a body in a collapsible `<details>` block.
 *
 * The blank line after `</summary>` is load-bearing: GitHub only renders the
 * markdown inside a details block when it is separated from the summary by an
 * empty line. `summary` must always carry a count so the reader can decide
 * whether to expand without expanding.
 *
 * @param {string} summary summary label, including a count
 * @param {string} body full markdown body (never truncated)
 * @returns {string}
 */
function wrapInDetails(summary, body) {
  return `<details>\n<summary>${summary}</summary>\n\n${neutralizeDetailsClosers(body)}\n\n</details>\n`;
}

/**
 * #1713: `**🔴 1 / 🟠 3**`-style breakdown, highest severity first. Severities
 * with a zero count are omitted so a clean run does not print four zeroes.
 *
 * @param {Record<string, number>} countsBySeverity
 * @returns {string}
 */
function formatSeverityBreakdown(countsBySeverity) {
  return SEVERITY_ORDER.filter((severity) => (countsBySeverity[severity] ?? 0) > 0)
    .map((severity) => `${SEVERITY_EMOJI[severity]} ${countsBySeverity[severity]}`)
    .join(' / ');
}

function countFindingsBySeverity(findings) {
  const counts = {};
  for (const finding of findings ?? []) {
    const severity = finding?.severity;
    counts[severity] = (counts[severity] ?? 0) + 1;
  }
  return counts;
}

/**
 * #1713: comments carry no severity of their own — the structured findings do.
 * `review-engine.mjs` builds `findings` from `comments` 1:1 and then re-sorts
 * the findings, so the two lists cannot be zipped by index; the join has to be
 * by content. Suppression filters both lists together (local-runner.mjs), so a
 * rendered comment normally has a matching finding.
 */
function commentSeverityKey({ ruleId, file, line, message }) {
  return [ruleId || 'unknown', file ?? '', line ?? '', message ?? ''].join('\u0000');
}

function buildCommentSeverityIndex(findings) {
  const index = new Map();
  for (const finding of findings ?? []) {
    const key = commentSeverityKey({
      ruleId: finding.ruleId,
      file: finding.file,
      line: finding.lineStart,
      message: finding.message,
    });
    if (!index.has(key)) index.set(key, finding.severity);
  }
  return index;
}

function severityOfComment(comment, index) {
  const key = commentSeverityKey({
    ruleId: comment.skillId,
    file: comment.file,
    line: comment.line ?? null,
    message: comment.message,
  });
  // Fail-safe: an unmatched comment is treated as `major` so it stays expanded
  // — the same direction as normalizeSeverity's unknown → major.
  return index.get(key) ?? 'major';
}

/**
 * #1713 Slice 1: split findings at the `major` boundary. `critical` / `major`
 * render expanded under 要対応; `minor` / `info` are folded into a `<details>`
 * block that keeps their full text.
 *
 * @param {object} result runLocalReview result
 * @returns {{ sections: string[], expandedCount: number, collapsedCount: number }}
 */
function formatFindingsSectionsMarkdown(result) {
  const index = buildCommentSeverityIndex(result.findings);
  const expanded = [];
  const collapsed = [];
  const expandedCounts = {};
  const collapsedCounts = {};

  for (const comment of result.comments ?? []) {
    const severity = severityOfComment(comment, index);
    if ((SEVERITY_RANK[severity] ?? EXPAND_FROM_RANK) >= EXPAND_FROM_RANK) {
      expanded.push(comment);
      expandedCounts[severity] = (expandedCounts[severity] ?? 0) + 1;
    } else {
      collapsed.push(comment);
      collapsedCounts[severity] = (collapsedCounts[severity] ?? 0) + 1;
    }
  }

  const sections = [];
  if (expanded.length) {
    sections.push(
      `### 要対応 (${expanded.length} 件: ${formatSeverityBreakdown(expandedCounts)})\n\n${formatCommentsMarkdown(expanded)}\n`
    );
  }
  if (collapsed.length) {
    sections.push(
      wrapInDetails(
        `軽微・参考の指摘 (${collapsed.length} 件: ${formatSeverityBreakdown(collapsedCounts)})`,
        formatCommentsMarkdown(collapsed)
      )
    );
  }
  return { sections, expandedCount: expanded.length, collapsedCount: collapsed.length };
}

/**
 * #1713 Slice 1: the selected / skipped skill listing, folded into the
 * execution `<details>` block instead of being printed at full height.
 */
function formatPlanBodyMarkdown(summary) {
  const selected = summary.selected.length
    ? summary.selected.map((id) => `- \`${id}\``).join('\n')
    : '- _none_';
  const lines = [`**選択されたスキル (${summary.selected.length})**`, '', selected];
  if (summary.skipped.length) {
    lines.push(
      '',
      `**スキップされたスキル (${summary.skipped.length})**`,
      '',
      summary.skipped.map((item) => `- \`${item.id}\`: ${item.reasons.join('; ')}`).join('\n')
    );
  }
  return lines.join('\n');
}

/**
 * #1713 Slice 1: LLM / planner / impact-tag / skill-selection execution log,
 * collapsed behind one summary line. This is the review *log*, not the review
 * *result*, so it must not sit above the verdict.
 */
function formatExecutionDetailsMarkdown(result) {
  const summary = formatPlan(result.plan);
  const body = `${formatDebugSummaryMarkdown(result)}\n\n${formatPlanBodyMarkdown(summary)}`;
  return wrapInDetails(
    `レビュー実行の内訳（選択 ${summary.selected.length} / スキップ ${summary.skipped.length}）`,
    body
  );
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
  // #1713 Slice 1: the JSON artifact is built exactly once. It carries the
  // canonical decision AND emits the schema-validation warning on stderr, so a
  // second call would both recompute and duplicate that warning.
  const artifact = formatJsonOutput(result, phase);
  const score = scoreReview(artifact.issues ?? []);
  // formatJsonOutput already resolved the canonical verdict; reuse it so the
  // Markdown headline and score section cannot drift from JSON/YAML/HTML
  // (#1170 F3).
  score.verdict = resolveVerdict(artifact.decision, score.verdict);

  const { sections: findingSections, expandedCount } = formatFindingsSectionsMarkdown(result);

  const header = `${COMMENT_MARKER}
## River Review

${formatHeadlineMarkdown(result, phase, score)}
`;
  const noBlockerNote = formatNoBlockerNoteMarkdown(result.findings ?? [], expandedCount);
  const riskSection = formatRiskSummaryMarkdown(result.plan);
  const humanReviewSection = formatHumanReviewFilesMarkdown(result);
  const teamLeadSection = formatTeamLeadReportMarkdown(result.teamLeadReport);
  const prioritySummary = formatPrioritySummaryMarkdown(result);
  const scoreSection = formatScoreSectionMarkdown(score);
  const executionSection = formatExecutionDetailsMarkdown(result);
  console.log(
    [
      header,
      noBlockerNote,
      riskSection,
      humanReviewSection,
      teamLeadSection,
      ...findingSections,
      prioritySummary,
      scoreSection,
      executionSection,
    ]
      .filter(Boolean)
      .join('\n')
  );
}

/**
 * #1713 Slice 1: the one-line human-facing headline pinned to the top of the
 * report — verdict, severity breakdown, score, phase. Every value it prints is
 * already computed elsewhere (deriveRunGate via formatJsonOutput, scoreReview,
 * the finding set); this only lays them out. It never changes a verdict.
 *
 * @param {object} result runLocalReview result
 * @param {string} phase
 * @param {{ overall: number, verdict: string }} score resolved score
 * @returns {string}
 */
export function formatHeadlineMarkdown(result, phase, score) {
  const findings = result.findings ?? [];
  const suppressed = result.classified?.suppressed?.length ?? 0;

  let findingsPart;
  if (findings.length === 0) {
    findingsPart = suppressed > 0 ? `指摘 0 件（抑制 ${suppressed} 件）` : '指摘 0 件';
  } else {
    const breakdown = formatSeverityBreakdown(countFindingsBySeverity(findings));
    const suppressedNote = suppressed > 0 ? `、抑制 ${suppressed} 件` : '';
    findingsPart = `${breakdown}（計 ${findings.length} 件${suppressedNote}）`;
  }

  return [
    `**判定: ${score.verdict}**`,
    findingsPart,
    `スコア ${score.overall}/100`,
    `フェーズ \`${phase}\``,
  ].join(' · ');
}

/**
 * #1713 Slice 1: the "nothing blocks the merge" line. Returned only when the
 * 要対応 section would otherwise be absent, so the reader never has to infer
 * "no section" from a missing heading.
 */
function formatNoBlockerNoteMarkdown(findings, expandedCount) {
  if (findings.length === 0) return '✅ マージ前に対応が必要な指摘はありません。\n';
  if (expandedCount === 0) {
    return '✅ マージ前必須（P1 / P2）の指摘はありません。軽微・参考の指摘のみです。\n';
  }
  return null;
}

/**
 * #1713 Slice 1: files the risk map flagged as human-review-required. Split out
 * of 優先度サマリー so it stays visible when that section is folded — it is a
 * gate-relevant signal, not part of the count breakdown.
 */
function formatHumanReviewFilesMarkdown(result) {
  const humanReviewFiles = result.plan?.riskMap?.require_human_review ?? [];
  if (!humanReviewFiles.length) return null;
  return [
    '> **Human review required**',
    ...humanReviewFiles.map((f) => `> - ${sanitizeForMarkdown(f)}`),
    '',
  ].join('\n');
}

/**
 * #1713 Slice 2: render the deterministic Tech Lead digest in markdown.
 *
 * Ported from `formatSummaryFromJson` in
 * `runners/github-action/post-inline-comments.cjs`, whose rendering only ever
 * reached the inline-comment surface that the `inline_comments` input gates off
 * by default. `teamLeadReport` is null on a single-reviewer run (`--reviewers`
 * absent), in which case every section here is omitted and the output is
 * byte-identical to the Slice 1 output.
 *
 * Overlap rule with 要対応: `top3Findings` is a POINTER list — one line per
 * finding (severity emoji + consensus badge + title + location). The full text
 * (Finding / Evidence / Impact / Fix) is rendered exactly once, in 要対応 or in
 * the collapsed 軽微・参考 block, and is never repeated here.
 *
 * Display-only: it must not override severity, `decision`, or `gate`.
 */
function formatTeamLeadReportMarkdown(teamLeadReport) {
  if (!teamLeadReport) return null;
  const lines = [];

  const top3 = teamLeadReport.top3Findings ?? [];
  if (top3.length > 0) {
    lines.push(`### 優先確認の指摘 (${top3.length} 件)`, '');
    for (const finding of top3) {
      const emoji = SEVERITY_EMOJI[finding.severity] ?? '🔵';
      const badge = formatConsensusBadge(finding.consensusLevel);
      const location = finding.file
        ? ` (\`${finding.file}${finding.lineStart ? `:${finding.lineStart}` : ''}\`)`
        : '';
      lines.push(`- ${emoji}${badge} **${sanitizeForMarkdown(finding.title)}**${location}`);
    }
    lines.push('');
  }

  const consensus = teamLeadReport.consensusSummary;
  if (consensus && consensus.total > 0) {
    lines.push(
      `_合意度: ★★★ 合意 ${consensus.consensus} / ★★ 複数 ${consensus.multi} / ★ 単独 ${consensus.single}（計 ${consensus.total} 件）_`,
      ''
    );
  }

  const blindSpots = teamLeadReport.blindSpots ?? [];
  if (blindSpots.length > 0) {
    const labels = blindSpots.map((b) => sanitizeForMarkdown(b.label)).join(', ');
    lines.push(`_未実行のレビュー観点 (${blindSpots.length}): ${labels}_`, '');
  }

  return lines.length ? lines.join('\n') : null;
}

function formatConsensusBadge(consensusLevel) {
  if (consensusLevel === 'consensus') return ' ★★★';
  if (consensusLevel === 'multi') return ' ★★';
  return '';
}

/**
 * #1713 Slice 1: the P1〜P4 count table, folded into a `<details>` block whose
 * summary already carries every count. The headline shows the same numbers in
 * severity vocabulary; this keeps the priority vocabulary available without
 * spending four visible lines on it.
 *
 * The suppression count is reported ONCE — in the headline. Its per-reason
 * breakdown stays here, which is what the removed standalone blockquote (the
 * duplicate at the bottom of the report) used to carry.
 */
function formatPrioritySummaryMarkdown(result) {
  const findings = result.findings ?? [];
  const counts = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const f of findings) {
    const p = severityToPriority(f.severity);
    counts[p]++;
  }

  const lines = [];

  if (counts.P1 > 0) {
    lines.push(`> **P1 (マージ前必須修正): ${counts.P1} 件**\n`);
  }

  lines.push(
    `- P1 (must fix before merge): ${counts.P1} 件`,
    `- P2 (should fix or waive): ${counts.P2} 件`,
    `- P3 (recommended improvement): ${counts.P3} 件`,
    `- P4 (informational): ${counts.P4} 件`
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
    lines.push(`- 抑制済み: ${suppressed.length} 件 (主な理由: ${topReasons})`);
  }

  return wrapInDetails(
    `優先度サマリー (P1 ${counts.P1} / P2 ${counts.P2} / P3 ${counts.P3} / P4 ${counts.P4})`,
    lines.join('\n')
  );
}

/**
 * #1713 Slice 1: the per-axis score breakdown, folded into a `<details>` block.
 * The overall score and the verdict are already in the headline; the five axis
 * lines and the "reference value" caveat are the part a reader opens on demand.
 *
 * Takes the already-resolved score (printMarkdownReport builds the JSON
 * artifact once) instead of recomputing it.
 *
 * @param {{ overall: number, verdict: string, axes: Record<string, number> }} score
 * @returns {string}
 */
function formatScoreSectionMarkdown(score) {
  const lines = [];
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
  return wrapInDetails(`スコア内訳 (${score.overall}/100)`, lines.join('\n'));
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
// Exported (not just used internally by validateOutputArtifact) so a canary
// test can assert directly that schema loading succeeds — see #1599, where a
// dist-only regression silently disabled validation because the failure mode
// (falling back to null) is otherwise invisible from validateOutputArtifact's
// return value alone.
export function getOutputSchemaValidator() {
  if (outputSchemaValidator !== undefined) return outputSchemaValidator;
  try {
    // Pass the URL object straight to readFileSync instead of resolving it via
    // fileURLToPath: readFileSync natively supports file: URLs, and this also
    // sidesteps a dist-only regression (#1599) where ncc rewrites the `new
    // URL(...)` expression into a plain path string
    // (`__nccwpck_require__.ab + "output.schema.json"`) — fileURLToPath then
    // throws `TypeError [ERR_INVALID_URL]: Invalid URL` because that string is
    // not a valid file: URL, while readFileSync accepts the plain path as-is.
    const schemaPath = new URL('../../schemas/output.schema.json', import.meta.url);
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
      // #1644 Phase 1: the JSON output is the artifact governed by
      // output.schema.json, so `scope` must reach it for the schema field to be
      // observable at all. yaml/html surfaces stay unchanged (Phase 2).
      ...(f.scope ? { scope: f.scope } : {}),
      // #1666 (#1545 Phase 2): same reachability rule as `scope` — a schema
      // field that stops at the finding object is an unreachable spec. Guard on
      // Array.isArray + length (not truthiness) so neither an empty array nor a
      // non-array value reaches the JSON artifact, where the schema requires an
      // array. yaml/html surfaces stay unchanged (out of Phase 2).
      ...(Array.isArray(f.criterionRefs) && f.criterionRefs.length > 0
        ? { criterionRefs: f.criterionRefs }
        : {}),
      ...(Array.isArray(f.artifactRefs) && f.artifactRefs.length > 0
        ? { artifactRefs: f.artifactRefs }
        : {}),
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

  // #1689 review B3: reviewer roles cut off by the per-role timeout were only
  // observable in-process (`reviewerResults` / `debug`), both of which this
  // formatter drops — so from the CLI a timed-out role was indistinguishable
  // from a role that found nothing. Emit the role names at the top level, and
  // only when non-empty so an untouched run keeps its exact previous shape.
  const timedOutRoles = (result.reviewerResults ?? [])
    .filter((r) => r?.timedOut === true)
    .map((r) => r.role);

  const artifact = {
    issues,
    summary,
    ...(decision !== undefined ? { decision } : {}),
    ...(gate ? { gate } : {}),
    ...(timedOutRoles.length > 0 ? { timedOutRoles } : {}),
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
