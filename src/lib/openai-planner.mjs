import { callChatCompletion } from './llm-pipeline.mjs';

const DEFAULT_PLANNER_MODEL =
  process.env.RIVER_PLANNER_MODEL ||
  process.env.RIVER_OPENAI_MODEL ||
  process.env.OPENAI_MODEL ||
  'gpt-4o-mini';

const DEFAULT_TIMEOUT_MS = 15000;

function resolveOpenAIConfig(options = {}) {
  return {
    apiKey: options.apiKey || process.env.RIVER_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    model: options.model || DEFAULT_PLANNER_MODEL,
    endpoint:
      options.endpoint ||
      process.env.RIVER_OPENAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://api.openai.com/v1/chat/completions',
  };
}

function resolvePlannerTimeoutMs(options = {}) {
  if (
    typeof options.timeoutMs === 'number' &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
  ) {
    return options.timeoutMs;
  }
  const value = Number(process.env.RIVER_PLANNER_TIMEOUT);
  if (Number.isFinite(value) && value > 0) return value;
  return DEFAULT_TIMEOUT_MS;
}

function buildPlannerPrompt({ skills, context }) {
  const phase = context?.phase ?? 'midstream';
  const changedFiles = Array.isArray(context?.changedFiles) ? context.changedFiles : [];
  const availableContexts = Array.isArray(context?.availableContexts)
    ? context.availableContexts
    : [];
  const impactTags = Array.isArray(context?.impactTags) ? context.impactTags : [];
  const skillsText = (skills || [])
    .map((s) => `- ${s.id}: ${s.name} (${s.phase}) — ${s.description}`)
    .join('\n');

  return `You are River Review, an AI skill planner.

Goal: pick the most relevant review skills for this PR diff, and order them by priority.

Context:
- phase: ${phase}
- changedFiles: ${changedFiles.join(', ') || '(none)'}
- availableContexts: ${availableContexts.join(', ') || '(none)'}
- impactTags: ${impactTags.join(', ') || '(none)'}

Candidate skills:
${skillsText}

Rules:
- Output MUST be valid JSON only (no markdown, no code fences).
- Output format: [{"id":"<skill id>","priority":<number>,"reason":"<short reason>"}]
- Include only skills you recommend to run. If none are needed, output [].
- Do not invent ids; use only ids from the candidate list.
`;
}

const PLANNER_SYSTEM_MESSAGE =
  'You are River Review, an expert code review skill planner. Return valid JSON only; do not wrap in Markdown.';

// Chat-completion transport lives in llm-pipeline.mjs (#1338). The planner
// historically made a single attempt with no retry; maxAttempts: 1 preserves
// that behavior exactly.
function callOpenAI({ prompt, apiKey, model, endpoint, timeoutMs }) {
  return callChatCompletion({
    prompt,
    systemMessage: PLANNER_SYSTEM_MESSAGE,
    apiKey,
    model,
    endpoint,
    temperature: 0,
    maxTokens: 600,
    timeoutMs: timeoutMs ?? resolvePlannerTimeoutMs(),
    maxAttempts: 1,
  });
}

function parsePlannerJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        throw new Error('planner output is not valid JSON');
      }
    }
    throw new Error('planner output is not valid JSON');
  }
}

// --- テスト用 named export (内部ヘルパー) ---
export { resolveOpenAIConfig, resolvePlannerTimeoutMs, buildPlannerPrompt, parsePlannerJson };

export function createOpenAIPlanner(options = {}) {
  const config = resolveOpenAIConfig(options);
  const timeoutMs = resolvePlannerTimeoutMs(options);
  return {
    model: config.model,
    endpoint: config.endpoint,
    plan: async ({ skills, context }) => {
      if (!config.apiKey) {
        throw new Error(
          'AI API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY) not set'
        );
      }
      const prompt = buildPlannerPrompt({ skills, context });
      const output = await callOpenAI({
        prompt,
        apiKey: config.apiKey,
        model: config.model,
        endpoint: config.endpoint,
        timeoutMs,
      });
      const parsed = parsePlannerJson(output);
      return Array.isArray(parsed) ? parsed : [];
    },
  };
}
