import { z } from 'zod';

export const AIModelSchema = z.enum([
  'gemini-2.0-flash',          // Default: Fast & Smart
  'gemini-2.0-flash-thinking', // Reasoning: For Security/Architecture
  'gemini-2.0-pro',            // High Spec
  'gemini-1.5-pro',            // Legacy Balanced
  'gpt-4o',                    // OpenAI Option
  'o1',                        // OpenAI Reasoning
  'o1-mini',                   // OpenAI Fast Reasoning
]);

export const RuleSchema = z.object({
  id: z.string().describe('Unique identifier for the rule'),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  description: z.string(),
  context: z.string().describe('Why this matters (Understanding)'),
  patterns: z.array(z.string()).describe('Keywords or patterns to look for'),
  anti_patterns: z.array(z.string()).describe('Bad code examples'),
  fix_guidance: z.string().describe('How to fix it (Expertise Transfer)'),
});

export const SkillSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  files: z.array(z.string()).describe('Glob patterns for target files'),
  exclude: z.array(z.string()).optional(),
  model: AIModelSchema.default('gemini-2.0-flash'),
  temperature: z.number().min(0).max(1).default(0.2),
  rules: z.array(RuleSchema),
});

export const ConfigSchema = z.object({
  version: z.string().default('1.0'),
  skills: z.array(SkillSchema),
});