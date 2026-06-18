import { mergeConfig } from '../config/loader.mjs';
import { computeFindingBreakdown } from './scoring/breakdown.mjs';
import { classifyFindings } from './finding-classifier.mjs';
import { defaultConfig } from '../config/default.mjs';
import { summarizeSkill } from '../../runners/core/review-runner.mjs';
import { buildHeuristicComments, HEURISTIC_SKILL_IDS } from './heuristic-review.mjs';
import { isOfflineMode } from './utils.mjs';
import {
  formatFindingMessage,
  validateFindingMessage,
  parseFindingMessage,
  normalizeSeverity,
} from './finding-format.mjs';
import { getReviewDepthConfig } from './review-plan-generator.mjs';
import { buildRepoContextSection } from './repo-context.mjs';
import { redactText } from './secret-redactor.mjs';

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
  const body = instructions.map((item) => `- ${item}`).join('\n');
  return `\n${header}\n${body}\n`;
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
- Use Severity: blocker|warning|nit and Confidence: high|medium|low.
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

// Transient-failure retry policy for LLM calls (#1196-adjacent adoption from the
// Gemma concurrent demo: in-process parallel review already exists; retry was the
// one gap). Helpers are pure and exported for unit testing.
const LLM_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const LLM_MAX_ATTEMPTS = 3; // 1 try + 2 retries
const LLM_RETRY_BASE_MS = 500;
const LLM_TIMEOUT_MS = 15000;

/** Retryable HTTP statuses: rate-limit and transient server/gateway errors. */
export function isRetryableStatus(status) {
  return LLM_RETRYABLE_STATUS.has(status);
}

/** Network-level errors worth retrying: timeouts, aborts, connection resets, DNS. */
export function isRetryableNetworkError(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const msg = `${err.code ?? ''} ${err.message ?? ''}`;
  return /fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
    msg
  );
}

/**
 * Backoff before the next attempt (ms). Honors a `Retry-After` header (seconds)
 * when present, else exponential: base * 2^(attempt-1).
 * @param {number} attempt - 1-based attempt that just failed.
 */
export function computeBackoffMs(
  attempt,
  { baseMs = LLM_RETRY_BASE_MS, retryAfterSec = null } = {}
) {
  // Guard before Number(): Number(null) and Number('') are 0, which would wrongly
  // be treated as "Retry-After: 0s" when the header is simply absent.
  if (retryAfterSec !== null && retryAfterSec !== undefined && retryAfterSec !== '') {
    const ra = Number(retryAfterSec);
    if (Number.isFinite(ra) && ra >= 0) return Math.round(ra * 1000);
  }
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callOpenAI({
  prompt,
  apiKey,
  model,
  endpoint,
  temperature,
  maxTokens,
  systemMessage,
  maxAttempts = LLM_MAX_ATTEMPTS,
}) {
  const body = JSON.stringify({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemMessage ?? buildSystemMessage('ja') },
      { role: 'user', content: prompt },
    ],
  });

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS), // fresh per attempt (one-shot)
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
      });
    } catch (err) {
      // Network error or timeout — retry transient failures with backoff.
      lastError = err;
      if (attempt < maxAttempts && isRetryableNetworkError(err)) {
        await sleep(computeBackoffMs(attempt));
        continue;
      }
      throw err;
    }

    if (res.ok) {
      const json = await res.json();
      return json.choices?.[0]?.message?.content?.trim() ?? '';
    }

    const detail = await res.text();
    if (attempt < maxAttempts && isRetryableStatus(res.status)) {
      await sleep(computeBackoffMs(attempt, { retryAfterSec: res.headers?.get?.('retry-after') }));
      continue;
    }
    throw new Error(`OpenAI API error ${res.status}: ${detail}`);
  }
  // Exhausted retries on a transient network error.
  throw lastError ?? new Error('OpenAI API error: retries exhausted');
}

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
    switch (c.kind) {
      case 'silent-catch':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: 'catch で例外が握りつぶされる可能性がある',
            evidence: 'catch 内で return（ログ/再throwなし）',
            impact: '障害調査や失敗検知が困難になる',
            fix: 'ログ+再throw / 上位へ返す / 無視するなら理由コメント+計測を検討する',
            severity: 'nit',
            confidence: 'high',
          }),
        };
      case 'missing-tests':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
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
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: '秘密情報（トークン/キー）の直書きの可能性がある',
            evidence: 'トークン/キーらしい文字列が追加されている',
            impact: '漏洩時に不正利用やインシデントにつながる',
            fix: '環境変数（GitHub Secrets等）へ移し、漏洩時はローテーションも検討する',
            severity: 'blocker',
            confidence: 'high',
          }),
        };
      case 'gh-actions-pull-request-target':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: 'pull_request_targetイベントは権限昇格のリスクがある',
            evidence: 'pull_request_targetトリガーが追加されている',
            impact: 'フォークからのPRで任意コードが本リポジトリの権限で実行される可能性',
            fix: 'pull_requestイベントを使用するか、pull_request_targetの場合はチェックアウト前に入力を検証する',
            severity: 'blocker',
            confidence: 'high',
          }),
        };
      case 'gh-actions-excessive-permissions':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: '過剰な権限設定（write-all）が検出された',
            evidence: 'permissions: write-all が設定されている',
            impact: 'ワークフローが侵害された場合の影響範囲が最大化される',
            fix: '最小権限の原則に従い、必要な権限のみを個別に指定する（例: contents: read, pull-requests: write）',
            severity: 'warning',
            confidence: 'high',
          }),
        };
      case 'gh-actions-secret-in-run':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: 'runブロック内でsecretsを直接使用している',
            evidence: 'run: と secrets.* が同一行に存在',
            impact: 'ログ出力やエラーメッセージでシークレットが漏洩する可能性',
            fix: 'シークレットを環境変数として設定し、envブロック経由で参照する',
            severity: 'warning',
            confidence: 'medium',
          }),
        };
      case 'gh-actions-unsanitized-input':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: 'ユーザー入力がサニタイズされずに使用されている',
            evidence: 'github.event.*.title/body/name がrunブロックで直接使用',
            impact: 'コマンドインジェクション攻撃のリスクがある',
            fix: 'jqやtoJSONを使用して入力をサニタイズする、または環境変数経由で渡す',
            severity: 'blocker',
            confidence: 'high',
          }),
        };
      case 'dangerous-eval':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: 'コード実行/インジェクションのリスクがある API が追加されている',
            evidence:
              'eval / new Function / dangerouslySetInnerHTML / document.write(ln) / 文字列引数の setTimeout・setInterval のいずれかが追加された',
            impact: '入力が信頼できない場合に任意コード実行や XSS につながる',
            fix: '動的評価を避ける（パース/ホワイトリスト化）、HTML はサニタイズして挿入し、タイマーには関数を渡す',
            severity: 'warning',
            confidence: 'high',
          }),
        };
      case 'focused-test':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: 'フォーカス済みテスト（.only）がコミットされている',
            evidence: 'describe/it/test 等の .only が追加された',
            impact: '他のテストが CI で実行されず、回帰を見逃す',
            fix: '.only を外してから commit する（誤ってフォーカスを残さない）',
            severity: 'warning',
            confidence: 'high',
          }),
        };
      case 'debugger-leftover':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: 'デバッグ用 `debugger` 文がコミットされている',
            evidence: '`debugger;` が追加された',
            impact: '実行が一時停止する／本番に混入すると不具合や情報露出につながる',
            fix: 'commit 前に `debugger` 文を削除する',
            severity: 'warning',
            confidence: 'high',
          }),
        };
      case 'insecure-tls':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: 'TLS 証明書検証が無効化されている',
            evidence:
              '`rejectUnauthorized: false` または `NODE_TLS_REJECT_UNAUTHORIZED=0` が追加された',
            impact: '中間者攻撃に対して脆弱になる',
            fix: '証明書検証を有効に保つ。自己署名証明書は CA を信頼ストアへ追加して対応する',
            severity: 'blocker',
            confidence: 'high',
          }),
        };
      case 'weak-hash':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: '弱いハッシュアルゴリズム（MD5 / SHA-1）が使われている',
            evidence: "`createHash('md5')` または `createHash('sha1')` が追加された",
            impact: '衝突攻撃に弱く、署名やパスワード等の用途では安全でない',
            fix: 'SHA-256 以上を使う。パスワードは bcrypt/scrypt/argon2 を使う',
            severity: 'warning',
            confidence: 'medium',
          }),
        };
      case 'command-injection':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: 'シェルコマンドが文字列補間で組み立てられている',
            evidence: '`exec`/`spawn` 系にテンプレートリテラルの `${...}` 補間が渡されている',
            impact: '補間値が信頼できない場合、コマンドインジェクションにつながる',
            fix: '引数配列を使う（例: `execFile(cmd, [args])`）、または入力を厳格に検証/エスケープする',
            severity: 'warning',
            confidence: 'medium',
          }),
        };
      case 'merge-conflict':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: '未解決のマージコンフリクトマーカーがコミットされている',
            evidence: '`<<<<<<<` / `>>>>>>>`（diff3 では `|||||||` も）マーカーが追加された',
            impact: 'コードが壊れ、ビルド/実行が失敗する',
            fix: 'コンフリクトを解消し、マーカーを完全に削除する',
            severity: 'blocker',
            confidence: 'high',
          }),
        };
      case 'disabled-test':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: '無効化されたテスト（.skip / xit / xdescribe / xcontext）がコミットされている',
            evidence: '`.skip` または `xit`/`xdescribe`/`xcontext` が追加された',
            impact: 'テストが実行されず、対象の挙動が未検証のまま残る',
            fix: '修正してスキップを外す。意図的な保留なら理由（Issue 等）をコメントで残す',
            severity: 'nit',
            confidence: 'medium',
          }),
        };
      case 'ts-suppression':
        return {
          file: c.file,
          line: c.line,
          skillId: c.skillId,
          message: formatFindingMessage({
            finding: '型チェックの抑制（@ts-ignore / @ts-nocheck）が追加されている',
            evidence: '`@ts-ignore` または `@ts-nocheck` が追加された',
            impact: '型エラーが隠れ、潜在的な不具合を見逃す',
            fix: '型を修正する。やむを得ない場合は範囲を限定した `@ts-expect-error` + 理由コメントを使う',
            severity: 'nit',
            confidence: 'medium',
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
  const promptInfo = buildPrompt({
    diffText: diff.diffText,
    diffFiles: diff.files,
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
        const redacted = parsed.map((c) => ({ ...c, message: redactSecrets(c.message) }));
        const checks = redacted.map((c) => validateFindingMessage(c.message));
        const invalidCount = checks.filter((c) => !c.ok).length;
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

  debug.fileClassification = fileTypes ?? null;

  // Verifier pass: filter findings that fail quality checks
  const { verifyFinding } = await import('./verifier.mjs');
  const verifierResults = comments.map((comment) => ({
    comment,
    verification: verifyFinding({
      finding: comment,
      diff: diff.diffText,
      skill: plan?.selected?.[0] ?? {},
      fileTypes,
    }),
  }));

  const verified = verifierResults.filter((r) => r.verification.verified).map((r) => r.comment);
  const rejected = verifierResults.filter((r) => !r.verification.verified);

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

  // Replace comments with verified-only set
  comments = verified;

  // Build structured findings from verified comments
  const findings = comments.map((c, i) => {
    const parsed = parseFindingMessage(c.message);
    const severity = normalizeSeverity(parsed.severity);
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
