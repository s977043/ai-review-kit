import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

const clientCache = new Map();

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function isRetriableError(err) {
  const status = err?.status ?? err?.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  if (err?.name === 'AbortError') return true;
  if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' || err?.code === 'ENOTFOUND') return true;
  return false;
}

async function withRetry(fn) {
  let attempt = 0;
  // simple linear backoff; enough to smooth transient 429/timeout for now
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const retriable = isRetriableError(err);
      if (!retriable || attempt > MAX_RETRIES) {
        if (process.env.RIVER_AI_RETRY_DEBUG === '1') {
          // eslint-disable-next-line no-console
          console.error(`[AI retry] giving up after ${attempt} attempts:`, err?.message || err);
        }
        throw err;
      }
      if (process.env.RIVER_AI_RETRY_DEBUG === '1') {
        // eslint-disable-next-line no-console
        console.warn(`[AI retry] attempt ${attempt} failed (${err?.message || err}); retrying...`);
      }
      await new Promise(res => setTimeout(res, RETRY_DELAY_MS * attempt));
    }
  }
}

export class AIClientFactory {
  static create({ modelName, temperature }) {
    if (!modelName) {
      throw new Error('モデル名が指定されていません (config.skills[].model を確認してください)');
    }
    const cacheKey = `${modelName}::${temperature ?? 'default'}`;
    if (clientCache.has(cacheKey)) {
      return clientCache.get(cacheKey);
    }
    const client =
      modelName.startsWith('gemini')
        ? new GeminiClient(modelName, temperature)
        : modelName.match(/^(gpt|o1)/)
          ? new OpenAIClient(modelName, temperature)
          : null;
    if (!client) throw new Error(`Unsupported model: ${modelName}`);
    clientCache.set(cacheKey, client);
    return client;
  }
}

class GeminiClient {
  constructor(modelName, temperature) {
    this.modelName = modelName;
    this.temperature = temperature ?? 0.2;
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY が設定されていません');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateReview(systemPrompt, diff) {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });

    const result = await withRetry(() =>
      model.generateContent({
        generationConfig: {
          temperature: this.temperature,
        },
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'user', parts: [{ text: `Here is the code diff to review:\n\n${diff}` }] },
        ],
      }),
    );

    return result.response.text();
  }
}

class OpenAIClient {
  constructor(modelName, temperature) {
    this.modelName = modelName;
    this.temperature = temperature ?? 0;
    const apiKey = process.env.OPENAI_API_KEY || process.env.RIVER_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY (または RIVER_OPENAI_API_KEY) が設定されていません');
    }
    this.openai = new OpenAI({ apiKey, timeout: 15000 });
  }

  async generateReview(systemPrompt, diff) {
    const isReasoning = this.modelName.startsWith('o1');

    const messages = isReasoning
      ? [
          {
            role: 'user',
            content: `${systemPrompt}\n\n---\n\nDiff:\n${diff}`,
          },
        ]
      : [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: diff },
        ];

    const response = await withRetry(() =>
      this.openai.chat.completions.create({
        model: this.modelName,
        messages,
        temperature: this.temperature,
      }),
    );

    return response.choices[0].message.content || '';
  }
}
