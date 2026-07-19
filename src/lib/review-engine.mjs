import { mergeConfig } from '../config/loader.mjs';
import { computeFindingBreakdown } from './scoring/breakdown.mjs';
import {
  classifyFindings,
  formatFindingMessage,
  validateFindingMessage,
  parseFindingMessage,
  normalizeSeverity,
} from './finding-factory.mjs';
import { defaultConfig } from '../config/default.mjs';
import { summarizeSkill } from '../../runners/core/review-runner.mjs';
import {
  buildHeuristicComments,
  HEURISTIC_SKILL_IDS,
  HEURISTIC_KIND_PRESENTATIONS,
} from './heuristic-review.mjs';
import { isOfflineMode } from './utils.mjs';
import { getReviewDepthConfig } from './review-plan-generator.mjs';
import { buildRepoContextSection } from './repo-context.mjs';
import { redactText } from './secret-redactor.mjs';
import { callChatCompletion } from './llm-pipeline.mjs';
import { buildLlmDiffView, isGeneratedArtifactPath } from './diff-processor.mjs';

const ENV_DEFAULT_MODEL = process.env.RIVER_OPENAI_MODEL || process.env.OPENAI_MODEL || null;
const MAX_PROMPT_CHARS = 12000;
const MAX_PROMPT_PREVIEW_CHARS = 2000;
const NO_ISSUES_REGEX = /^NO_ISSUES/i;
const LINE_COMMENT_REGEX = /^(.+?):(\d+):\s*(.+)$/;

/**
 * スキル名のサニタイズ: Markdown インジェクション対策
 */
function sanitizeSkillName(name) {
  if (!name) return '';
  return String(name).replace(/[\[\]`*_{}()#+\-.!|<>\n]/g, '');
}

function buildSystemMessage(language) {
  return language === 'en'
    ? 'You are River Review, an expert code review assistant. Respond in English. You excel at spotting risky changes and explaining them briefly.'
    : 'You are River Review, an expert code review assistant. Respond in Japanese. You excel at spotting risky changes and explaining them briefly.';
}

function buildLanguageInstruction(language) {
  return language === 'en'
    ? '- Write the <message> in English.'
    : '- <message>は日本語で記述すること。';
}

function buildSeverityInstruction(severity, language) {
  const japanese = {
    strict: '軽微な懸念も含めて網羅的に指摘する',
    normal: '重要度と再現性のバランスを取り、主要なリスクを指摘する',
    relaxed: '重大・致命的な問題に限定し、軽微な指摘は省く',
  };
  const english = {
    strict: 'Capture even minor risks and style regressions',
    normal: 'Balance breadth with impact; focus on notable risks',
    relaxed: 'Limit findings to critical or high-impact issues; skip nits',
  };
  const map = language === 'en' ? english : japanese;
  const label = language === 'en' ? 'Severity focus' : '厳格度';
  return `- ${label} (${severity}): ${map[severity] ?? map.normal}`;
}

function buildAdditionalSection(instructions, language) {
  if (!instructions?.length) return '';
  const header = language === 'en' ? 'Additional instructions:' : '追加指示:';
  // T64: additionalInstructions が単一行 "<file>:<line>: <message>" 形式と
  // 競合し、LLM出力のパース失敗を招いていたため、適用範囲を明示する。
  const formatNote =
    language === 'en'
      ? 'These additional instructions apply only to the content of each finding\'s <message>. Always keep the "<file>:<line>: <message>" line format above.'
      : 'これらの追加指示は各 finding の <message> 内容にのみ適用してください。上記の「<file>:<line>: <message>」という行フォーマット自体は常に維持してください。';
  const body = instructions.map((item) => `- ${item}`).join('\n');
  return `\n${header}\n${formatNote}\n${body}\n`;
}

function resolveOpenAIConfig(options = {}, config = defaultConfig) {
  const provider = config.model?.provider ?? 'openai';
  const modelName = options.model || ENV_DEFAULT_MODEL || config.model?.modelName;
  return {
    provider,
    apiKey: options.apiKey || process.env.RIVER_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    model: modelName,
    endpoint:
      options.endpoint ||
      process.env.RIVER_OPENAI_BASE_URL ||
      'https://api.openai.com/v1/chat/completions',
    temperature: config.model?.temperature ?? 0,
    maxTokens: config.model?.maxTokens ?? 600,
  };
}

function buildSkillSummary(plan) {
  if (!plan?.selected?.length) return 'No skills selected; provide general review notes.';
  const summaries = plan.selected.map((skill) => summarizeSkill(skill));
  const top = summaries.slice(0, 6);
  const body = top
    .map(
      (s) =>
        `- ${s.id}: ${s.name} [phase=${s.phase}, severity=${s.severity ?? 'unknown'}, modelHint=${s.modelHint}]`
    )
    .join('\n');
  const truncated =
    summaries.length > top.length ? `\n...and ${summaries.length - top.length} more skills.` : '';
  return `${body}${truncated}`;
}

function buildFileSummary(files = []) {
  if (!files.length) return 'No files changed';
  return files.map((file) => `- ${file.path} (hunks: ${file.hunks.length || 1})`).join('\n');
}

function buildProjectRulesSection(rulesText) {
  if (!rulesText) return '';
  return `\n### Project-specific review rules\n\n以下は、このリポジトリ専用のレビューガイドラインです。必ず考慮してください。\n\n---\n${rulesText}\n---\n`;
}

const MAX_PR_BODY_CHARS = 4000;

function buildPrDescriptionSection(prBody) {
  if (typeof prBody !== 'string' || !prBody.trim()) return '';
  const body =
    prBody.length > MAX_PR_BODY_CHARS
      ? `${prBody.slice(0, MAX_PR_BODY_CHARS)}\n...[truncated]`
      : prBody;
  return `\n### PR Description\n\n以下はこの変更の PR 本文です。差分そのものに加えて、PR 本文がレビュー可能な状態かを確認してください。\n\n- Why（変更理由）と What（変更内容）が書かれているか\n- 本文の説明が差分と一致しているか（説明にあるが差分に無い／差分にあるが説明に無い）\n- 影響範囲が書かれているか\n- テスト方針・確認方法が書かれているか\n- 関連 Issue / 仕様 / 設計へのリンクがあるか\n\nPR 本文に関する指摘は、対象を \`PR-DESCRIPTION:0\` として出力してください。\n\n---\n${body}\n---\n`;
}

// Opt-in (review.walkthrough). Asks the model to prepend a per-file walkthrough
// to its output so reviewers see what changed, the risk, and a reading order.
function buildWalkthroughSection(enabled) {
  if (!enabled) return '';
  return `\n### File Walkthrough (output request)\n\nFindings の前に "## File Walkthrough" セクションを出力してください。変更ファイルごとに 1 行で:\n- 何がどう変わったか（要約）\n- 変更リスク（high/medium/low）\n- 読むべき順番（依存や影響の大きい順）\nを示してください。差分に無いファイルは含めないでください。\n`;
}

// Opt-in (review.agentHandoff). Asks the model to append provider-agnostic
// fix instructions another AI agent can act on. Distinct from per-finding
// `suggestion` (a human hint); this is an executable instruction set.
function buildHandoffSection(enabled) {
  if (!enabled) return '';
  return `\n### Agent Handoff (output request)\n\nFindings の後に "## Agent Handoff" セクションを出力してください。blocking な指摘を別の AI エージェントが修正できるよう、特定のツール名・CLI 名を含めずに以下を記述してください:\n- 修正の目的\n- 対象ファイル\n- 制約（壊してはいけない挙動・後方互換）\n- 実装手順\n- テスト手順\n- 完了条件\n`;
}

function buildADRContextSection(relatedADRs) {
  if (!relatedADRs?.length) return '';
  const lines = ['\n### Related ADRs/Specs\n'];
  for (const adr of relatedADRs.slice(0, 5)) {
    lines.push(`- ${adr.title} (${adr.path}) — ${adr.matchReason}`);
  }
  lines.push('\nこれらの設計文書との整合性を考慮してレビューしてください。\n');
  return lines.join('\n');
}

function sanitizePath(p) {
  return String(p)
    .replace(/[\n\r]/g, '')
    .slice(0, 200);
}

function buildRiskAssessmentSection(riskAssessment) {
  if (!riskAssessment) return '';
  const { escalatedFiles, humanReviewFiles } = riskAssessment;
  if (!escalatedFiles?.length && !humanReviewFiles?.length) return '';
  const lines = ['\n### Risk Assessment\n'];
  if (humanReviewFiles?.length) {
    lines.push('以下のファイルは人間によるレビューが必須です:');
    for (const f of humanReviewFiles) lines.push('- ' + sanitizePath(f) + ': require_human_review');
  }
  if (escalatedFiles?.length) {
    lines.push('以下のファイルはエスカレーション対象です:');
    for (const f of escalatedFiles) lines.push('- ' + sanitizePath(f) + ': escalate');
  }
  lines.push('これらのファイルには特に注意してレビューしてください。\n');
  return lines.join('\n');
}

export function buildPrompt({
  diffText,
  diffFiles,
  plan,
  phase,
  projectRules,
  riskAssessment,
  memoryContext,
  relatedADRs,
  reviewMode,
  repoContext,
  prBody,
  maxChars = MAX_PROMPT_CHARS,
  config = defaultConfig,
}) {
  const effectiveConfig = mergeConfig(defaultConfig, config ?? {});
  const reviewConfig = effectiveConfig.review ?? defaultConfig.review;
  const language = reviewConfig.language ?? defaultConfig.review.language;
  const severity = reviewConfig.severity ?? defaultConfig.review.severity;
  const wantWalkthrough = reviewConfig.walkthrough ?? false;
  const wantHandoff = reviewConfig.agentHandoff ?? false;
  const truncated = diffText.length > maxChars;
  const diffBody = truncated ? `${diffText.slice(0, maxChars)}\n...[truncated]` : diffText;
  const depthConfig = getReviewDepthConfig(reviewMode ?? 'medium');
  const prompt = `You are River Review, an AI code review agent.
Phase: ${phase}

Changed files:
${buildFileSummary(diffFiles)}

Relevant skills:
${buildSkillSummary(plan)}

${buildProjectRulesSection(projectRules)}${buildRiskAssessmentSection(riskAssessment)}${buildADRContextSection(relatedADRs)}${buildRepoContextSection(repoContext)}${buildPrDescriptionSection(prBody)}${buildWalkthroughSection(wantWalkthrough)}${buildHandoffSection(wantHandoff)}Review the unified git diff below and produce concise findings.
${buildLanguageInstruction(language)}
- Output each finding on its own line using the format "<file>:<line>: <message>".
- In <message>, include short labels: "Finding:", "Evidence:", "Impact:", "Fix:", "Severity:", "Confidence:".
- Every finding MUST carry "Severity:" and "Confidence:". It MUST also carry "Evidence:" (>=5 chars) and "Fix:" (>=10 chars) — findings without them are discarded during verification. "Finding:" and "Impact:" are recommended.
- Use Severity: blocker|warning|nit and Confidence: high|medium|low.
- Example finding line: src/app.ts:42: Finding: retry loop swallows errors Evidence: catch block at src/app.ts drops err Impact: failures are masked Fix: rethrow or log err with context Severity: warning Confidence: high
- Focus on correctness, safety, and maintainability risks in the changed code.
- Prefer commenting on changed lines; if a point depends on context not visible in the diff, set Confidence: low.
- Limit to ${depthConfig.maxFindings} findings. If there are no issues worth mentioning, reply with "NO_ISSUES".
- Keep messages brief (<=200 characters).
- ${depthConfig.focusHint}
${buildSeverityInstruction(severity, language)}
${buildAdditionalSection(reviewConfig.additionalInstructions, language)}
Diff:
${diffBody}`;
  return { prompt, truncated, language, severity };
}

export function parseLineComments(outputText) {
  if (!outputText) return null;
  const comments = [];
  for (const rawLine of outputText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (NO_ISSUES_REGEX.test(line)) return [];
    const match = LINE_COMMENT_REGEX.exec(line);
    if (match) {
      comments.push({
        file: match[1].trim(),
        line: Number.parseInt(match[2], 10),
        message: match[3].trim(),
      });
    }
  }
  return comments.length ? comments : null;
}

// Transient-failure retry policy and the chat-completion call moved to
// llm-pipeline.mjs (#1338). The retry helpers are re-exported here so existing
// importers (tests, downstream consumers) keep working unchanged.
export { isRetryableStatus, isRetryableNetworkError, computeBackoffMs } from './llm-pipeline.mjs';

function buildFallbackComments(diff, plan, { llmSkipReason = null } = {}) {
  const allSkills = plan?.selected ?? [];
  // ヒューリスティック対応スキルは除外（ヒューリスティックで処理済み）
  const skills = allSkills.filter((skill) => {
    const skillId = skill.metadata?.id ?? skill.id;
    return !HEURISTIC_SKILL_IDS.includes(skillId);
  });

  const firstFile = diff.files?.find((f) => f?.path && f.path !== '/dev/null') ?? null;
  if (!firstFile) {
    return [
      {
        file: '(no-files)',
        line: 1,
        message: formatFindingMessage({
          finding: 'レビュー対象ファイルが特定できない',
          evidence: '差分ファイルが空',
          impact: 'レビューの自動化ができない',
          fix: '差分がある状態で再実行する',
          severity: 'warning',
          confidence: 'low',
        }),
      },
    ];
  }

  const line =
    firstFile.addedLines?.[0] ||
    firstFile.hunks?.[0]?.newStart ||
    1; /* default to first added line or hunk start to keep pointers stable */

  // Build specific reason message
  const evidenceBase = llmSkipReason
    ? `LLM: ${llmSkipReason}`
    : 'ヒューリスティック検出パターンに該当なし';

  // スキルがない場合は1件のコメントを生成
  if (skills.length === 0) {
    return [
      {
        file: firstFile.path,
        line,
        message: formatFindingMessage({
          finding: 'マッチするスキルがなく自動指摘を生成できなかった',
          evidence: evidenceBase,
          impact: '重要なリスクを見落とす可能性がある',
          fix: 'このファイル種別に対応するスキルを追加するか、手動レビューを実施する',
          severity: 'warning',
          confidence: 'low',
        }),
      },
    ];
  }

  // スキル単位でコメントを生成
  return skills.map((skill) => {
    const skillId = skill.metadata?.id ?? skill.id;
    const rawSkillName = skill.metadata?.name ?? skillId;
    const skillName = sanitizeSkillName(rawSkillName);
    return {
      file: firstFile.path,
      line,
      skillId,
      message: formatFindingMessage({
        finding: `スキル「${skillName}」の観点で自動指摘を生成できなかった`,
        evidence: evidenceBase,
        impact: 'このスキルが検出する問題を見落とす可能性がある',
        fix: `「${skillName}」の観点で手動レビューを実施する`,
        severity: 'warning',
        confidence: 'low',
      }),
    };
  });
}

function normalizeHeuristicComments(rawComments) {
  return rawComments.map((c) => {
    // kind → プレゼンテーションは heuristic-review.mjs の単一レジストリ
    // (HEURISTIC_KIND_PRESENTATIONS) から導出する。detector の追加はレジストリ
    // 1 箇所で完結し、ここに case を足す必要はない。
    const preset = HEURISTIC_KIND_PRESENTATIONS.get(c.kind);
    if (!preset) {
      return {
        file: c.file,
        line: c.line,
        message: formatFindingMessage({
          finding: `想定外のヒューリスティック（kind=${String(c.kind ?? 'unknown')}）`,
          evidence: 'ヒューリスティック kind が未知',
          impact: 'レビュー結果が不安定になる可能性がある',
          fix: 'ヒューリスティック定義と出力の対応を見直す',
          severity: 'warning',
          confidence: 'low',
        }),
      };
    }
    return {
      file: c.file,
      line: c.line,
      skillId: c.skillId,
      message: formatFindingMessage(preset),
    };
  });
}

function redactSecrets(text) {
  if (!text) return text;
  return String(text)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA****************')
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, 'ghp_***REDACTED***')
    .replace(/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, 'sk_***REDACTED***')
    .replace(/\bsk-[A-Za-z0-9]{16,}\b/g, 'sk-***REDACTED***')
    .replace(/-----BEGIN [^-]* PRIVATE KEY-----/g, '-----BEGIN PRIVATE KEY-----')
    .replace(/-----END [^-]* PRIVATE KEY-----/g, '-----END PRIVATE KEY-----');
}

/**
 * Generate review comments using LLM when configured, otherwise fall back to deterministic hints.
 */
export async function generateReview({
  diff,
  plan,
  phase,
  dryRun = false,
  includeFallback = true,
  model,
  apiKey,
  projectRules,
  fileTypes,
  relatedADRs,
  riskAssessment,
  reviewMode,
  repoContext,
  prBody,
  maxPromptChars = MAX_PROMPT_CHARS,
  config,
}) {
  const effectiveConfig = mergeConfig(defaultConfig, config ?? {});
  // LLM-facing view: strip non-reviewable build artifacts (dist bundles, source
  // maps) from BOTH the diff body and the "Changed files" summary. `diff` itself
  // stays raw so heuristics/fallback below keep seeing every changed file
  // (#1543/#1547).
  const llmDiff = buildLlmDiffView(diff);
  const promptInfo = buildPrompt({
    diffText: llmDiff.diffText,
    diffFiles: llmDiff.files,
    plan,
    phase,
    projectRules,
    relatedADRs,
    riskAssessment,
    reviewMode,
    repoContext,
    prBody,
    maxChars: maxPromptChars,
    config: effectiveConfig,
  });
  const openAIConfig = resolveOpenAIConfig({ model, apiKey }, effectiveConfig);
  const language = promptInfo.language ?? effectiveConfig.review.language;

  // #692 PR-D: defense-in-depth redaction at the artifact boundary.
  // PR-C already redacts repo context before it reaches the prompt, but
  // any other path (project rules with a pasted token, additional
  // instructions, etc.) could still slip a secret in. Build a single
  // redacted view of the prompt and use it everywhere the prompt would
  // otherwise leave process memory (debug.promptPreview, returned
  // `prompt`, downstream artifact writes). The LLM call still uses the
  // original `promptInfo.prompt` because it must.
  const safePrompt = redactText(promptInfo.prompt, {
    allowlist: effectiveConfig.security?.redact?.allowlist ?? [],
    ...(effectiveConfig.security?.redact?.entropyThreshold != null
      ? { entropyThreshold: effectiveConfig.security.redact.entropyThreshold }
      : {}),
    ...(effectiveConfig.security?.redact?.categories?.highEntropy === false
      ? { highEntropy: false }
      : {}),
  }).text;

  let comments = [];
  const debug = {
    promptTruncated: promptInfo.truncated,
    promptPreview: safePrompt.slice(0, MAX_PROMPT_PREVIEW_CHARS),
    llmModel: openAIConfig.model,
    llmProvider: openAIConfig.provider,
    reviewLanguage: language,
    reviewSeverity: promptInfo.severity,
    repoContext: repoContext
      ? {
          sections: repoContext.sections.map((s) => ({
            label: s.label,
            chars: s.content.length,
            file: s.file,
          })),
          totalChars: repoContext.totalChars,
          truncated: repoContext.truncated,
        }
      : null,
  };

  const skipReason = dryRun
    ? 'dry-run enabled'
    : isOfflineMode()
      ? 'offline (rules-only) mode enabled'
      : openAIConfig.provider !== 'openai'
        ? `provider ${openAIConfig.provider} is not supported yet`
        : openAIConfig.apiKey
          ? null
          : 'LLM API key (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY) not set';

  if (!skipReason) {
    try {
      const output = await callChatCompletion({
        prompt: promptInfo.prompt,
        apiKey: openAIConfig.apiKey,
        model: openAIConfig.model,
        endpoint: openAIConfig.endpoint,
        temperature: openAIConfig.temperature,
        maxTokens: openAIConfig.maxTokens,
        systemMessage: buildSystemMessage(language),
      });
      // T64 follow-up (gemini security-high): redact at storage time so the
      // raw LLM output never leaves process memory unmasked. Keeps the same
      // redaction invariant already applied to parsed comment messages below.
      debug.rawLlmOutput = redactSecrets(output);
      const parsed = parseLineComments(output);
      if (parsed !== null) {
        const redacted = parsed.map((c) => ({ ...c, message: redactSecrets(c.message) }));
        if (redacted.length === 0) {
          // NO_ISSUES: a legitimate "the LLM found nothing to flag" response.
          // Not a validation failure — must not be routed through the
          // invalid/fallback branch below (there are no findings to validate).
          comments = redacted;
          debug.llmUsed = true;
        } else {
          const checks = redacted.map((c) => validateFindingMessage(c.message));
          // T64 follow-up (#1529 E2E): a single truncated/malformed finding
          // (e.g. maxTokens cutoff dropping the trailing Severity:/Confidence:
          // labels) used to invalidate the whole batch and discard
          // otherwise-valid findings. Drop only the invalid findings and keep
          // the valid ones; fail-safe fallback still applies when *none* of
          // the findings are valid (validEntries.length === 0).
          const validEntries = redacted.filter((_, i) => checks[i].ok);
          const invalidEntries = redacted
            .map((c, i) => ({ comment: c, check: checks[i] }))
            .filter(({ check }) => !check.ok);
          const invalidCount = invalidEntries.length;
          if (validEntries.length > 0) {
            comments = validEntries;
            debug.llmUsed = true;
            if (invalidCount > 0) {
              debug.droppedInvalidFindings = invalidCount;
              const firstInvalid = invalidEntries[0];
              debug.droppedInvalidFindingsSample = {
                file: firstInvalid.comment.file,
                line: firstInvalid.comment.line,
                missing: firstInvalid.check.missing,
                invalid: firstInvalid.check.invalid,
              };
              debug.llmError = `LLM findings partially violated required format (dropped ${invalidCount} of ${redacted.length}); continuing with LLM using the remaining ${validEntries.length} valid finding(s).`;
            }
          } else {
            debug.llmUsed = false;
            debug.llmError = `LLM findings violate required format (invalidCount=${invalidCount}). Falling back.`;
          }
        }
      } else {
        debug.llmUsed = false;
        debug.llmError = 'LLM output could not be parsed';
      }
    } catch (err) {
      debug.llmUsed = false;
      debug.llmError = err.message;
    }
  } else {
    debug.llmUsed = false;
    debug.llmSkipped = skipReason;
  }

  if (!comments.length) {
    const heuristic = buildHeuristicComments({ diff, plan });
    debug.heuristicsUsed = true;
    if (heuristic.length) {
      comments = normalizeHeuristicComments(heuristic);
      debug.heuristicsCount = heuristic.length;
    } else {
      const llmSkipReason = debug.llmSkipped || debug.llmError || null;
      // If skipped due to missing API key, do not generate fallback warnings (user request)
      const isMissingKey = llmSkipReason && llmSkipReason.includes('not set');

      if (isMissingKey) {
        comments = [];
      } else {
        comments = includeFallback ? buildFallbackComments(diff, plan, { llmSkipReason }) : [];
      }
      debug.heuristicsCount = 0;
      debug.fallbackIncluded = includeFallback;
    }
  }

  const formatChecks = comments.map((c) => ({
    file: c.file,
    line: c.line,
    ...validateFindingMessage(c.message),
  }));
  const invalidCount = formatChecks.filter((c) => !c.ok).length;
  debug.findingFormat = invalidCount
    ? { ok: false, invalidCount, samples: formatChecks.filter((c) => !c.ok).slice(0, 3) }
    : { ok: true };
  // Surface findings that validated but omitted recommended content labels
  // (Finding:/Evidence:/Impact:/Fix:). These pass format validation on the
  // strength of Severity:/Confidence: alone, but the omission is worth
  // observing during calibration because such findings tend to be rejected by
  // the verifier downstream (Evidence:/Fix: are required there).
  const recommendedGaps = formatChecks.filter((c) => c.ok && c.missingRecommended.length > 0);
  if (recommendedGaps.length > 0) {
    debug.findingFormat.recommendedGaps = recommendedGaps.length;
    debug.findingFormat.recommendedGapsSample = recommendedGaps.slice(0, 3).map((c) => ({
      file: c.file,
      line: c.line,
      missingRecommended: c.missingRecommended,
    }));
  }

  debug.fileClassification = fileTypes ?? null;

  // Verifier pass: filter findings that fail quality checks
  const { verifyFinding } = await import('./verifier.mjs');
  const skill = plan?.selected?.[0] ?? {};
  const runVerifier = (cmts) =>
    cmts.map((comment) => ({
      comment,
      verification: verifyFinding({ finding: comment, diff: diff.diffText, skill, fileTypes }),
    }));

  const verifierResults = runVerifier(comments);
  let verified = verifierResults.filter((r) => r.verification.verified).map((r) => r.comment);
  const rejected = verifierResults.filter((r) => !r.verification.verified);

  // debug.verifierStats/verifierRejected describe the verifier pass over the
  // primary (LLM or first-pass heuristic) comment set — i.e. the signal for why
  // a fallback did or did not fire. The finally-emitted set is result.findings.
  debug.verifierRejected = rejected.map((r) => ({
    file: r.comment.file,
    line: r.comment.line,
    reasons: r.verification.reasons,
  }));
  debug.verifierStats = {
    total: comments.length,
    verified: verified.length,
    rejected: rejected.length,
  };

  // Fail-safe: mirror the format-validation fallback for a wholesale verifier
  // rejection. Inline-only findings (Severity:/Confidence: present but
  // Evidence:/Fix: omitted) pass format validation yet fail the verifier; the
  // heuristic fallback above only runs when the LLM produced *no* usable
  // comments (verifier runs after it), so without this branch a fully-rejected
  // LLM batch would emit an empty review. Degrade to the same safe heuristic/
  // fallback path instead. Guard on `!debug.heuristicsUsed` so a batch that was
  // already heuristic is not reprocessed.
  if (verified.length === 0 && verifierResults.length > 0 && !debug.heuristicsUsed) {
    debug.verifierAllRejected = true;
    const heuristic = buildHeuristicComments({ diff, plan });
    if (heuristic.length) {
      comments = normalizeHeuristicComments(heuristic);
      debug.heuristicsUsed = true;
      debug.heuristicsCount = heuristic.length;
    } else {
      const llmSkipReason = debug.llmSkipped || debug.llmError || null;
      const isMissingKey = llmSkipReason && llmSkipReason.includes('not set');
      comments = isMissingKey
        ? []
        : includeFallback
          ? buildFallbackComments(diff, plan, { llmSkipReason })
          : [];
      debug.heuristicsCount = 0;
      debug.fallbackIncluded = includeFallback;
    }
    // Re-verify the fallback set so the emitted comments still satisfy the
    // verifier invariant (heuristic/fallback findings use the full labeled
    // format and pass). verifierStats above intentionally keeps describing the
    // rejected LLM batch.
    verified = runVerifier(comments)
      .filter((r) => r.verification.verified)
      .map((r) => r.comment);
  }

  // Replace comments with verified-only set
  comments = verified;

  // #1597: Output-stage filter for findings that point at a machine-generated
  // build-artifact directory (a `dist/` path segment). #1570 excluded these
  // paths from the LLM-facing diff only; the heuristic detectors still scan the
  // raw diff.files by design (the #1070 canary boundary), so a heuristic finding
  // can still land on `runners/github-action/dist/index.mjs` and reach output.
  // Drop those findings here — the SINGLE choke point where `comments` becomes
  // both the emitted PR comments AND the source of `findings`/`classified` — so
  // display, PR comments, and score (rubric penalty is computed from `findings`)
  // all exclude them consistently. The generated artifact's quality derives from
  // its source, so scoring it would double-count. Detection stays intact;
  // suppressed findings are surfaced in debug for observability. Uses
  // `isGeneratedArtifactPath`, which is intentionally narrower than the LLM
  // diff's `isExcludedFile`: it matches only the generated directory, so real
  // findings on `.md` / lock files are NOT suppressed from output.
  const keptComments = [];
  const suppressedGeneratedPathComments = [];
  for (const c of comments) {
    if (isGeneratedArtifactPath(c.file)) {
      suppressedGeneratedPathComments.push(c);
    } else {
      keptComments.push(c);
    }
  }
  if (suppressedGeneratedPathComments.length > 0) {
    comments = keptComments;
    debug.suppressedGeneratedPathFindings = suppressedGeneratedPathComments.length;
    debug.suppressedGeneratedPathFindingsSample = suppressedGeneratedPathComments
      .slice(0, 3)
      .map((c) => ({ file: c.file, line: c.line }));
  }

  // Build structured findings from verified comments
  const findings = comments.map((c, i) => {
    const parsed = parseFindingMessage(c.message);
    const severity = normalizeSeverity(parsed.severity);
    // Confidence is guaranteed present+valid here (validateFindingMessage gates
    // it upstream), so the 'medium' branch is currently unreachable; it is kept
    // as a conservative default in case an unverified path ever reaches this.
    const confidence =
      parsed.confidence && ['high', 'medium', 'low'].includes(parsed.confidence)
        ? parsed.confidence
        : 'medium';
    return {
      id: `rr-${i + 1}`,
      ruleId: c.skillId || 'unknown',
      file: c.file,
      lineStart: c.line ?? null,
      lineEnd: c.line ?? null,
      title: parsed.title || c.message.slice(0, 80),
      message: c.message,
      severity,
      confidence,
      status: /** @type {'open'} */ ('open'),
      evidence: parsed.evidence,
      suggestion: parsed.suggestion || null,
    };
  });

  findings.sort((a, b) => {
    const bA = computeFindingBreakdown(a);
    const bB = computeFindingBreakdown(b);
    return bB.composite - bA.composite;
  });

  const classified = classifyFindings(findings, { reviewMode: reviewMode ?? 'medium' });

  return {
    comments,
    findings,
    classified,
    // The returned prompt flows into local-runner result, artifacts, and
    // dashboards. Use the redacted view so a leaked secret never leaves
    // process memory through these paths. The LLM call above used the
    // original promptInfo.prompt and is unaffected.
    prompt: safePrompt,
    promptTruncated: promptInfo.truncated,
    llmModel: openAIConfig.model,
    debug,
  };
}
