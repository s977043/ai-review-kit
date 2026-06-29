/**
 * River Review Node.js API
 *
 * Programmatic interface for using River Review in custom Node.js applications.
 *
 * @example
 * ```typescript
 * import { review, loadSkills } from '@river-review/node-api';
 *
 * // Review files
 * const results = await review({
 *   phase: 'midstream',
 *   files: ['src/**\/*.ts'],
 *   baseBranch: 'main',
 * });
 *
 * // Load skills
 * const skills = await loadSkills({
 *   skillsDir: './skills',
 *   phase: 'midstream',
 * });
 * ```
 *
 * @module @river-review/node-api
 */
import { SkillLoaderError } from '@river-review/core-runner/skill-loader';
export type { Phase, Severity, InputContext, OutputKind, ModelHint, Dependency, SkillMetadata, SkillDefinition, LoadSkillsOptions, ReviewOptions, SkillSelectionResult, Finding, ReviewSummary, ReviewMetadata, ReviewResult, EvaluateSkillOptions, EvaluationResult, } from './types.js';
import type { LoadSkillsOptions, ReviewOptions, SkillSelectionResult, ReviewResult, EvaluateSkillOptions, EvaluationResult, SkillDefinition, Phase, InputContext, Dependency, ModelHint } from './types.js';
export { parseProvider, parseFindings } from './ai-helpers.js';
/**
 * Load all skills from the skills directory.
 *
 * This function discovers and loads all skill definitions, validating them
 * against the skill schema. Skills can be filtered by phase if specified.
 *
 * @param options - Options for loading skills
 * @returns Promise resolving to array of skill definitions
 *
 * @example
 * ```typescript
 * // Load all skills
 * const allSkills = await loadSkills();
 *
 * // Load skills from custom directory
 * const customSkills = await loadSkills({
 *   skillsDir: '/path/to/skills',
 * });
 *
 * // Load skills for specific phase
 * const midstreamSkills = await loadSkills({
 *   phase: 'midstream',
 * });
 * ```
 */
export declare function loadSkills(options?: LoadSkillsOptions): Promise<SkillDefinition[]>;
/**
 * Load a single skill file.
 *
 * @param filePath - Absolute path to the skill file
 * @param options - Optional loading options
 * @returns Promise resolving to skill definition
 *
 * @example
 * ```typescript
 * const skill = await loadSkillFile('/path/to/skill.md');
 * console.log(skill.metadata.id);
 * ```
 */
export declare function loadSkillFile(filePath: string, options?: Pick<LoadSkillsOptions, 'schemaPath'>): Promise<SkillDefinition>;
/**
 * Load only skill metadata for a single file (Stage 1 of Progressive Disclosure).
 *
 * Unlike {@link loadSkillFile}, the returned object does not include the skill `body`.
 * Use this when you need to filter or route skills before committing to the cost of
 * loading the full instruction text.
 *
 * @param filePath - Absolute path to the skill file
 * @param options - Optional loading options
 * @returns Promise resolving to `{ metadata, path }`
 *
 * @example
 * ```typescript
 * const { metadata, path } = await loadSkillMetadata('/path/to/skill.md');
 * console.log(metadata.id, path);
 * ```
 */
export declare function loadSkillMetadata(filePath: string, options?: Pick<LoadSkillsOptions, 'schemaPath'>): Promise<{
    metadata: SkillDefinition['metadata'];
    path: string;
}>;
/**
 * Load metadata for all skills under the skills directory
 * (Stage 1 of Progressive Disclosure).
 *
 * Returns an array of `{ metadata, path }` objects without skill bodies. Validation,
 * excluded-tag filtering, and duplicate-id handling match {@link loadSkills}.
 *
 * @param options - Options for loading skills
 * @returns Promise resolving to array of `{ metadata, path }` entries
 *
 * @example
 * ```typescript
 * const summaries = await loadAllSkillMetadata();
 * for (const { metadata, path } of summaries) {
 *   console.log(metadata.id, path);
 * }
 * ```
 */
export declare function loadAllSkillMetadata(options?: Pick<LoadSkillsOptions, 'skillsDir' | 'schemaPath'>): Promise<Array<{
    metadata: SkillDefinition['metadata'];
    path: string;
}>>;
/**
 * Select skills based on review context.
 *
 * This function filters skills based on phase, file patterns, available contexts,
 * and dependencies. It returns both selected skills and skipped skills with reasons.
 *
 * @param skills - Array of skill definitions to filter
 * @param options - Review context options
 * @returns Skill selection result with selected and skipped skills
 *
 * @example
 * ```typescript
 * const skills = await loadSkills();
 * const selection = selectSkills(skills, {
 *   phase: 'midstream',
 *   changedFiles: ['src/app.ts', 'src/utils.ts'],
 *   availableContexts: ['diff', 'fullFile'],
 * });
 *
 * console.log(`Selected: ${selection.selected.length}`);
 * console.log(`Skipped: ${selection.skipped.length}`);
 * ```
 */
export declare function selectSkills(skills: SkillDefinition[], options: {
    phase: Phase;
    changedFiles: string[];
    availableContexts?: InputContext[];
    availableDependencies?: Dependency[];
}): {
    selected: SkillDefinition[];
    skipped: Array<{
        skill: SkillDefinition;
        reasons: string[];
    }>;
};
/**
 * Build an execution plan for skill execution.
 *
 * This function creates an optimized execution plan by selecting relevant skills,
 * ranking them by impact tags and model hints, and optionally using an LLM planner
 * for intelligent prioritization.
 *
 * @param options - Execution plan options
 * @returns Promise resolving to skill selection result with execution plan
 *
 * @example
 * ```typescript
 * const plan = await buildExecutionPlan({
 *   phase: 'midstream',
 *   changedFiles: ['src/app.ts'],
 *   availableContexts: ['diff', 'fullFile'],
 *   preferredModelHint: 'balanced',
 *   diffText: '... git diff output ...',
 * });
 *
 * for (const skill of plan.selected) {
 *   console.log(`Execute: ${skill.metadata.id}`);
 * }
 * ```
 */
export declare function buildExecutionPlan(options: {
    phase: Phase;
    changedFiles: string[];
    availableContexts?: InputContext[];
    availableDependencies?: Dependency[];
    preferredModelHint?: ModelHint;
    skills?: SkillDefinition[];
    diffText?: string;
}): Promise<SkillSelectionResult>;
/**
 * Review files using River Review skills.
 *
 * This is the main entry point for programmatic code review. It loads skills,
 * builds an execution plan, and returns a structured result.
 *
 * Note: This function currently returns the execution plan. Actual skill execution
 * requires integration with an AI provider, which should be implemented by the caller.
 *
 * @param options - Review options
 * @returns Promise resolving to review result
 *
 * @example
 * ```typescript
 * const result = await review({
 *   phase: 'midstream',
 *   files: ['src/**\/*.ts'],
 *   availableContexts: ['diff', 'fullFile'],
 *   preferredModelHint: 'balanced',
 * });
 *
 * console.log(`Found ${result.summary.totalFindings} findings`);
 * ```
 */
export declare function review(options: ReviewOptions): Promise<ReviewResult>;
/**
 * Evaluate a specific skill with an AI provider.
 *
 * This function is a placeholder for skill evaluation functionality.
 * Actual implementation requires AI provider integration.
 *
 * @param options - Evaluation options
 * @returns Promise resolving to evaluation result
 *
 * @example
 * ```typescript
 * const result = await evaluateSkill({
 *   skillId: 'security-basic',
 *   provider: 'openai:gpt-4o',
 *   files: ['src/app.ts'],
 * });
 *
 * if (result.success) {
 *   console.log(`Found ${result.findings?.length} findings`);
 * }
 * ```
 */
export declare function evaluateSkill(options: EvaluateSkillOptions): Promise<EvaluationResult>;
/**
 * Get default paths used by River Review.
 *
 * @returns Object containing default paths for repository root, skills directory, and schema
 *
 * @example
 * ```typescript
 * const paths = getDefaultPaths();
 * console.log(`Skills directory: ${paths.skillsDir}`);
 * ```
 */
export declare function getDefaultPaths(): {
    repoRoot: string;
    skillsDir: string;
    schemaPath: string;
};
/**
 * Check if a skill matches a specific phase.
 *
 * @param skill - Skill definition or metadata
 * @param phase - Phase to check
 * @returns True if skill matches the phase
 *
 * @example
 * ```typescript
 * const skill = await loadSkillFile('/path/to/skill.md');
 * if (matchesPhase(skill, 'midstream')) {
 *   console.log('Skill applies to midstream phase');
 * }
 * ```
 */
export declare function matchesPhase(skill: SkillDefinition | SkillDefinition['metadata'], phase: Phase): boolean;
/**
 * Rank skills by model hint preference.
 *
 * @param skills - Skills to rank
 * @param preferredModelHint - Preferred model hint
 * @returns Ranked skills
 *
 * @example
 * ```typescript
 * const skills = await loadSkills();
 * const ranked = rankByModelHint(skills, 'balanced');
 * ```
 */
export declare function rankByModelHint(skills: SkillDefinition[], preferredModelHint?: ModelHint): SkillDefinition[];
/**
 * Summarize a skill for display or planning.
 *
 * @param skill - Skill definition to summarize
 * @returns Skill summary object
 *
 * @example
 * ```typescript
 * const skill = await loadSkillFile('/path/to/skill.md');
 * const summary = summarizeSkill(skill);
 * console.log(summary);
 * ```
 */
export declare function summarizeSkill(skill: SkillDefinition): {
    id: string;
    name: string;
    description: string;
    phase: Phase | Phase[];
    tags?: string[];
};
export { SkillLoaderError };
//# sourceMappingURL=index.d.ts.map