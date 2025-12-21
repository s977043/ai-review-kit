export const defaultConfig = Object.freeze({
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
});
