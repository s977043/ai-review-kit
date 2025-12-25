import { z } from 'zod';
import { ConfigSchema, SkillSchema, RuleSchema, AIModelSchema } from '../config/schema.mjs';

export type RiverConfig = z.infer<typeof ConfigSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type AIModel = z.infer<typeof AIModelSchema>;

// Re-export for compatibility
export { ConfigSchema, SkillSchema, RuleSchema, AIModelSchema };
