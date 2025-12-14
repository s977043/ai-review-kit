import { summarizeSkill } from './review-runner.mjs';
import { buildHeuristicComments } from './heuristic-review.mjs';
import { formatFindingMessage, validateFindingMessage } from './finding-format.mjs';

const DEFAULT_MODEL = process.env.RIVER_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_PROMPT_CHARS = 12000;
const MAX_PROMPT_PREVIEW_CHARS = 2000;
const NO_ISSUES_REGEX = /^NO_ISSUES/i;
const LINE_COMMENT_REGEX = /^(.+?):(\d+):\s*(.+)$/;

function resolveOpenAIConfig(options = {}) {
  return {
    apiKey: options.apiKey || process.env.RIVER_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    model: options.model || DEFAULT_MODEL,
    endpoint: options.endpoint || process.env.RIVER_OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
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

export function buildPrompt({ diffText, diffFiles, plan, phase, projectRules, maxChars = MAX_PROMPT_CHARS }) {
  const truncated = diffText.length > maxChars;
  const diffBody = truncated ? `${diffText.slice(0, maxChars)}\n...[truncated]` : diffText;
  const prompt = `You are River Reviewer, an AI code review agent.
Phase: ${phase}

Changed files:
${buildFileSummary(diffFiles)}

Relevant skills:
${buildSkillSummary(plan)}

${buildProjectRulesSection(projectRules)}Review the unified git diff below and produce concise findings.
- Write the <message> in Japanese.
- Output each finding on its own line using the format "<file>:<line>: <message>".
- In <message>, include short labels: "Finding:", "Impact:", "Fix:", "Severity:", "Confidence:".
- In <message>, include short labels: "Finding:", "Evidence:", "Impact:", "Fix:", "Severity:", "Confidence:".
- Use Severity: blocker|warning|nit and Confidence: high|medium|low.
- Focus on correctness, safety, and maintainability risks in the changed code.
- Prefer commenting on changed lines; if a point depends on context not visible in the diff, set Confidence: low.
- Limit to 8 findings. If there are no issues worth mentioning, reply with "NO_ISSUES".
- Keep messages brief (<=200 characters).

Diff:
${diffBody}`;
  return { prompt, truncated };
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

async function callOpenAI({ prompt, apiKey, model, endpoint }) {
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
      temperature: 0,
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content:
            'You are River Reviewer, an expert code review assistant. Respond in Japanese. You excel at spotting risky changes and explaining them briefly.',
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

  const comments = diff.files.map(file => {
    const line =
      file.addedLines[0] ||
      file.hunks[0]?.newStart ||
      1; /* default to first added line or hunk start to keep pointers stable */
    const hunkText = file.hunks.length ? `Changed around line ${file.hunks[0].newStart}` : 'File changed';
    return {
      file: file.path,
      line,
      message: `${hunkText}. ${skillText}`,
    };
  });

  return comments.length ? comments : [{ file: '(no-files)', line: 1, message: skillText }];
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
            fix: 'ログ付与+再throw（または呼び出し元へエラー伝播）を検討する',
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
            fix: '境界/失敗系を含む最小テストを1〜3件追加する',
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

/**
 * Generate review comments using LLM when configured, otherwise fall back to deterministic hints.
 */
export async function generateReview({
  diff,
  plan,
  phase,
  dryRun = false,
  model,
  apiKey,
  projectRules,
  maxPromptChars = MAX_PROMPT_CHARS,
}) {
  const promptInfo = buildPrompt({
    diffText: diff.diffText,
    diffFiles: diff.files,
    plan,
    phase,
    projectRules,
    maxChars: maxPromptChars,
  });
  const config = resolveOpenAIConfig({ model, apiKey });

  let comments = [];
  const debug = {
    promptTruncated: promptInfo.truncated,
    promptPreview: promptInfo.prompt.slice(0, MAX_PROMPT_PREVIEW_CHARS),
    llmModel: config.model,
  };

  const skipReason = dryRun
    ? 'dry-run enabled'
    : config.apiKey
      ? null
      : 'OPENAI_API_KEY (or RIVER_OPENAI_API_KEY) not set';

  if (!skipReason) {
    try {
      const output = await callOpenAI({
        prompt: promptInfo.prompt,
        apiKey: config.apiKey,
        model: config.model,
        endpoint: config.endpoint,
      });
      debug.rawLlmOutput = output;
      const parsed = parseLineComments(output);
      if (parsed !== null) {
        comments = parsed;
        debug.llmUsed = true;
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
      comments = buildFallbackComments(diff, plan);
      debug.heuristicsUsed = false;
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
    llmModel: config.model,
    debug,
  };
}
