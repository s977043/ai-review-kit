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
  if (typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    return options.timeoutMs;
  }
  const value = Number(process.env.RIVER_PLANNER_TIMEOUT);
  if (Number.isFinite(value) && value > 0) return value;
  return DEFAULT_TIMEOUT_MS;
}

function buildPlannerPrompt({ skills, context }) {
  const phase = context?.phase ?? 'midstream';
  const changedFiles = Array.isArray(context?.changedFiles) ? context.changedFiles : [];
  const availableContexts = Array.isArray(context?.availableContexts) ? context.availableContexts : [];
  const impactTags = Array.isArray(context?.impactTags) ? context.impactTags : [];
  const skillsText = (skills || [])
    .map(s => `- ${s.id}: ${s.name} (${s.phase}) — ${s.description}`)
    .join('\n');

  return `You are River Reviewer, an AI skill planner.

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

async function callOpenAI({ prompt, apiKey, model, endpoint, timeoutMs }) {
  const signal = AbortSignal.timeout(timeoutMs ?? resolvePlannerTimeoutMs());
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
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
            'You are River Reviewer, an expert code review skill planner. Return valid JSON only; do not wrap in Markdown.',
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

export function createOpenAIPlanner(options = {}) {
  const config = resolveOpenAIConfig(options);
  const timeoutMs = resolvePlannerTimeoutMs(options);
  return {
    model: config.model,
    endpoint: config.endpoint,
    plan: async ({ skills, context }) => {
      if (!config.apiKey) {
        throw new Error('OPENAI_API_KEY (or RIVER_OPENAI_API_KEY) not set');
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
