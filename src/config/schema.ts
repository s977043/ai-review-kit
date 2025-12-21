import {
  excludeConfigSchema,
  modelConfigSchema,
  reviewConfigSchema,
  riverReviewerConfigSchema,
} from './schema.mjs';
import type { RiverReviewerConfig } from '../../types/config';

export type { RiverReviewerConfig };
export { modelConfigSchema, reviewConfigSchema, excludeConfigSchema, riverReviewerConfigSchema };
export type RiverReviewerConfigInput = import('zod').infer<typeof riverReviewerConfigSchema>;
