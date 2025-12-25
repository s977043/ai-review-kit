// Unified default config supporting both legacy and skill-based flows
export const defaultConfig = Object.freeze({
  version: '1.0',
  model: {
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    temperature: 0,
    maxTokens: 600,
  },
  review: {
    language: 'ja',
    severity: 'normal',
    additionalInstructions: [],
  },
  exclude: {
    files: [],
    prLabelsToIgnore: [],
  },
  skills: [],
});

// Alias kept for compatibility with newer skill-only imports
export const defaultSkillConfig = defaultConfig;
