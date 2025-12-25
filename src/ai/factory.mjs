import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

export class AIClientFactory {
  static create(modelName) {
    if (modelName.startsWith('gemini')) {
      return new GeminiClient(modelName);
    }
    if (modelName.startsWith('gpt') || modelName.startsWith('o1')) {
      return new OpenAIClient(modelName);
    }
    throw new Error(`Unsupported model: ${modelName}`);
  }
}

class GeminiClient {
  constructor(modelName) {
    this.modelName = modelName;
    // Assume GOOGLE_API_KEY is set in environment
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }

  async generateReview(systemPrompt, diff) {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    
    // For Thinking models, we might need adjustments, but standard generateContent works usually.
    // Constructing a structured prompt.
    const result = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'user', parts: [{ text: `Here is the code diff to review:

${diff}` }] }
      ]
    });
    
    return result.response.text();
  }
}

class OpenAIClient {
  constructor(modelName) {
    this.modelName = modelName;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async generateReview(systemPrompt, diff) {
    const isReasoning = this.modelName.startsWith('o1');
    
    // o1 models currently do not support "system" role, use "user" instead.
    const messages = isReasoning 
      ? [{ role: 'user', content: `${systemPrompt}

---

Diff:
${diff}` }]
      : [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: diff }
        ];

    const response = await this.openai.chat.completions.create({
      model: this.modelName,
      messages: messages,
    });

    return response.choices[0].message.content || '';
  }
}
