import { mergeConfig } from '../config/loader.mjs';
import { defaultConfig } from '../config/default.mjs';
import { summarizeSkill } from './review-runner.mjs';
import { buildHeuristicComments } from './heuristic-review.mjs';
import { formatFindingMessage, validateFindingMessage } from './finding-format.mjs';

const ENV_DEFAULT_MODEL = process.env.RIVER_OPENAI_MODEL || process.env.OPENAI_MODEL || null;
const MAX_PROMPT_CHARS = 12000;
const MAX_PROMPT_PREVIEW_CHARS = 2000;
const NO_ISSUES_REGEX = /^NO_ISSUES/i;
const LINE_COMMENT_REGEX = /^(.+?):(\d+):\s*(.+)$/;

function buildSystemMessage(language) {
  return language === 'en'
    ? 'You are River Reviewer, an expert code review assistant. Respond in English. You excel at spotting risky changes and explaining them briefly.'
    : 'You are River Reviewer, an expert code review assistant. Respond in Japanese. You excel at spotting risky changes and explaining them briefly.';
}

function buildLanguageInstruction(language) {
  return language === 'en' ? '- Write the <message> in English.' : '- <message>は日本語で記述すること。';
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
  const body = instructions.map(item => `- ${item}`).join('\n');
  return `\n${header}\n${body}\n`;
}

function resolveOpenAIConfig(options = {}, config = defaultConfig) {
  const provider = config.model?.provider ?? 'openai';
  const modelName = options.model || ENV_DEFAULT_MODEL || config.model?.modelName;
  return {
    provider,
    apiKey: options.apiKey || process.env.RIVER_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    model: modelName,
    endpoint: options.endpoint || process.env.RIVER_OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
    temperature: config.model?.temperature ?? 0,
    maxTokens: config.model?.maxTokens ?? 600,
  };
}

function buildSkillSummary(plan) {
  if (!plan?.selected?.length) return 'No skills selected; provide general review notes.';
  const summaries = plan.selected.map(skill => summarizeSkill(skill));
  const top = summaries.slice(0, 6);
  const body = top
    .map(
      s =>
        `- ${s.id}: ${s.name} [phase=${s.phase}, severity=${s.severity ?? 'unknown'}, modelHint=${s.modelHint}]`,
    )
    .join('\n');
  const truncated = summaries.length > top.length ? `\n...and ${summaries.length - top.length} more skills.` : '';
  return `${body}${truncated}`;
}

function buildFileSummary(files = []) {
  if (!files.length) return 'No files changed';
  return files.map(file => `- ${file.path} (hunks: ${file.hunks.length || 1})`).join('\n');
}

function buildProjectRulesSection(rulesText) {
  if (!rulesText) return '';
  return `\n### Project-specific review rules\n\n以下は、このリポジトリ専用のレビューガイドラインです。必ず考慮してください。\n\n---\n${rulesText}\n---\n`;
}

export function buildPrompt({ diffText, diffFiles, plan, phase, projectRules, maxChars = MAX_PROMPT_CHARS, config = defaultConfig }) {
  const effectiveConfig = mergeConfig(defaultConfig, config ?? {});
  const reviewConfig = effectiveConfig.review ?? defaultConfig.review;
  const language = reviewConfig.language ?? defaultConfig.review.language;
  const severity = reviewConfig.severity ?? defaultConfig.review.severity;
  const truncated = diffText.length > maxChars;
  const diffBody = truncated ? `${diffText.slice(0, maxChars)}\n...[truncated]` : diffText;
  const prompt = `You are River Reviewer, an AI code review agent.
Phase: ${phase}

Changed files:
${buildFileSummary(diffFiles)}

Relevant skills:
${buildSkillSummary(plan)}

${buildProjectRulesSection(projectRules)}Review the unified git diff below and produce concise findings.
${buildLanguageInstruction(language)}
- Output each finding on its own line using the format "<file>:<line>: <message>".
- In <message>, include short labels: "Finding:", "Evidence:", "Impact:", "Fix:", "Severity:", "Confidence:".
- Use Severity: blocker|warning|nit and Confidence: high|medium|low.
- Focus on correctness, safety, and maintainability risks in the changed code.
- Prefer commenting on changed lines; if a point depends on context not visible in the diff, set Confidence: low.
- Limit to 8 findings. If there are no issues worth mentioning, reply with "NO_ISSUES".
- Keep messages brief (<=200 characters).
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

async function callOpenAI({ prompt, apiKey, model, endpoint, temperature, maxTokens, systemMessage }) {
  const controller = AbortSignal.timeout(15000);
  const res = await fetch(endpoint, {
    method: 'POST',
    signal: controller,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: systemMessage ?? buildSystemMessage('ja'),
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${detail}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() ?? '';
}

function buildFallbackComments(diff, plan) {
  const skillNames = (plan?.selected ?? []).map(skill => skill.metadata?.name ?? skill.metadata?.id ?? skill.id);
  const skillText = skillNames.length
    ? `Matched skills: ${skillNames.join(', ')}`
    : 'No matching skills; manual review recommended.';

  const firstFile = diff.files?.find(f => f?.path && f.path !== '/dev/null') ?? null;
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
  const hunkText = firstFile.hunks?.length ? `Changed around line ${firstFile.hunks[0].newStart}` : 'File changed';
  return [
    {
      file: firstFile.path,
      line,
      message: formatFindingMessage({
        finding: '自動レビューの指摘を生成できなかった',
        evidence: hunkText,
        impact: '重要なリスクを見落とす可能性がある',
        fix: `手動レビューを行い、必要なら applyTo を調整する（${skillText}）`,
        severity: 'warning',
        confidence: 'low',
      }),
    },
  ];
}

function normalizeHeuristicComments(rawComments) {
  return rawComments.map(c => {
    switch (c.kind) {
      case 'silent-catch':
        return {
          file: c.file,
          line: c.line,
          message: formatFindingMessage({
            finding: 'catch で例外が握りつぶされる可能性がある',
            evidence: 'catch 内で return（ログ/再throwなし）',
            impact: '障害調査や失敗検知が困難になる',
            fix: 'ログ+再throw / 上位へ返す / 無視するなら理由コメント+計測を検討する',
            severity: 'warning',
            confidence: 'high',
          }),
        };
      case 'missing-tests':
        return {
          file: c.file,
          line: c.line,
          message: formatFindingMessage({
            finding: '挙動変更に対するテスト差分が見当たらない',
            evidence: 'コード差分あり・テスト差分なし',
            impact: '回帰の検知漏れや仕様逸脱が起きやすい',
            fix: '新分岐/例外/境界の最小テストを1〜3件追加する',
            severity: 'warning',
            confidence: 'medium',
          }),
        };
      case 'hardcoded-secret':
        return {
          file: c.file,
          line: c.line,
          message: formatFindingMessage({
            finding: '秘密情報（トークン/キー）の直書きの可能性がある',
            evidence: 'トークン/キーらしい文字列が追加されている',
            impact: '漏洩時に不正利用やインシデントにつながる',
            fix: '環境変数（GitHub Secrets等）へ移し、漏洩時はローテーションも検討する',
            severity: 'blocker',
            confidence: 'high',
          }),
        };
      default:
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
  maxPromptChars = MAX_PROMPT_CHARS,
  config,
}) {
  const effectiveConfig = mergeConfig(defaultConfig, config ?? {});
  const promptInfo = buildPrompt({
    diffText: diff.diffText,
    diffFiles: diff.files,
    plan,
    phase,
    projectRules,
    maxChars: maxPromptChars,
    config: effectiveConfig,
  });
  const openAIConfig = resolveOpenAIConfig({ model, apiKey }, effectiveConfig);
  const language = promptInfo.language ?? effectiveConfig.review.language;

  let comments = [];
  const debug = {
    promptTruncated: promptInfo.truncated,
    promptPreview: promptInfo.prompt.slice(0, MAX_PROMPT_PREVIEW_CHARS),
    llmModel: openAIConfig.model,
    llmProvider: openAIConfig.provider,
    reviewLanguage: language,
    reviewSeverity: promptInfo.severity,
  };

  const skipReason = dryRun
    ? 'dry-run enabled'
    : openAIConfig.provider !== 'openai'
      ? `provider ${openAIConfig.provider} is not supported yet`
      : openAIConfig.apiKey
        ? null
        : 'OPENAI_API_KEY (or RIVER_OPENAI_API_KEY) not set';

  if (!skipReason) {
    try {
      const output = await callOpenAI({
        prompt: promptInfo.prompt,
        apiKey: openAIConfig.apiKey,
        model: openAIConfig.model,
        endpoint: openAIConfig.endpoint,
        temperature: openAIConfig.temperature,
        maxTokens: openAIConfig.maxTokens,
        systemMessage: buildSystemMessage(language),
      });
      debug.rawLlmOutput = output;
      const parsed = parseLineComments(output);
      if (parsed !== null) {
        const redacted = parsed.map(c => ({ ...c, message: redactSecrets(c.message) }));
        const checks = redacted.map(c => validateFindingMessage(c.message));
        const invalidCount = checks.filter(c => !c.ok).length;
        if (invalidCount === 0) {
          comments = redacted;
          debug.llmUsed = true;
        } else {
          debug.llmUsed = false;
          debug.llmError = `LLM findings violate required format (invalidCount=${invalidCount}). Falling back.`;
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
    if (heuristic.length) {
      comments = normalizeHeuristicComments(heuristic);
      debug.heuristicsUsed = true;
      debug.heuristicsCount = heuristic.length;
    } else {
      comments = includeFallback ? buildFallbackComments(diff, plan) : [];
      debug.heuristicsUsed = false;
      debug.fallbackIncluded = includeFallback;
    }
  }

  const formatChecks = comments.map(c => ({
    file: c.file,
    line: c.line,
    ...validateFindingMessage(c.message),
  }));
  const invalidCount = formatChecks.filter(c => !c.ok).length;
  debug.findingFormat = invalidCount
    ? { ok: false, invalidCount, samples: formatChecks.filter(c => !c.ok).slice(0, 3) }
    : { ok: true };

  return {
    comments,
    prompt: promptInfo.prompt,
    promptTruncated: promptInfo.truncated,
    llmModel: openAIConfig.model,
    debug,
  };
}
