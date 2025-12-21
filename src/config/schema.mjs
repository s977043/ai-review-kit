import { z } from 'zod';

export const modelConfigSchema = z.object({
  provider: z.enum(['google', 'openai', 'anthropic']).optional(),
  modelName: z.string().min(1).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const reviewConfigSchema = z.object({
  language: z.enum(['ja', 'en']).optional(),
  severity: z.enum(['strict', 'normal', 'relaxed']).optional(),
  additionalInstructions: z.array(z.string().min(1)).optional(),
});

export const excludeConfigSchema = z.object({
  files: z.array(z.string().min(1)).optional(),
  prLabelsToIgnore: z.array(z.string().min(1)).optional(),
});

export const riverReviewerConfigSchema = z.object({
  model: modelConfigSchema.optional(),
  review: reviewConfigSchema.optional(),
  exclude: excludeConfigSchema.optional(),
});
