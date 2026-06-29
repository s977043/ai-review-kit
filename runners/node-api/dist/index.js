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
import { loadSkills as coreLoadSkills, loadSkillFile as coreLoadSkillFile, loadSkillMetadata as coreLoadSkillMetadata, loadAllSkillMetadata as coreLoadAllSkillMetadata, defaultPaths, SkillLoaderError, } from '@river-review/core-runner/skill-loader';
import { buildExecutionPlan as coreBuildExecutionPlan, selectSkills as coreSelectSkills, matchesPhase as coreMatchesPhase, rankByModelHint as coreRankByModelHint, summarizeSkill as coreSummarizeSkill, } from '@river-review/core-runner/review-runner';
export { parseProvider, parseFindings } from './ai-helpers.js';
import { parseProvider, parseFindings } from './ai-helpers.js';
/** Resolve API key from environment. Currently only openai is supported. */
function resolveApiKey(providerType) {
    if (providerType === 'openai')
        return process.env.OPENAI_API_KEY;
    return undefined;
}
/** Call an OpenAI-compatible chat completions endpoint via fetch. */
async function callOpenAICompatible(params) {
    const endpoint = params.endpoint ?? 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
            model: params.model,
            temperature: 0.1,
            max_tokens: 2000,
            messages: [
                { role: 'system', content: params.systemMessage },
                { role: 'user', content: params.userMessage },
            ],
        }),
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`AI API error ${response.status}: ${detail}`);
    }
    const json = (await response.json());
    return json.choices?.[0]?.message?.content?.trim() ?? '';
}
/** Execute a skill against diff/file content using an AI provider. */
async function executeSkillWithAI(skill, providerStr, files, diffText) {
    const { type: providerType, model } = parseProvider(providerStr);
    if (providerType !== 'openai') {
        throw new Error(`Provider "${providerType}" is not yet supported. Only "openai" is currently supported.`);
    }
    const apiKey = resolveApiKey(providerType);
    if (!apiKey) {
        throw new Error(`No API key found for provider "${providerType}". Set the OPENAI_API_KEY environment variable.`);
    }
    const systemMessage = skill.body;
    const userParts = [];
    if (diffText)
        userParts.push(`## Code Diff\n\n\`\`\`diff\n${diffText}\n\`\`\``);
    if (files.length > 0)
        userParts.push(`## Files Under Review\n\n${files.join('\n')}`);
    userParts.push('## Task\n\nReview the code diff above and identify issues according to your skill instructions.');
    const userMessage = userParts.join('\n\n');
    const output = await callOpenAICompatible({ model, apiKey, systemMessage, userMessage });
    return parseFindings(output, skill.metadata.id, files);
}
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
export async function loadSkills(options = {}) {
    const { skillsDir, schemaPath, phase } = options;
    const skills = await coreLoadSkills({
        skillsDir,
        schemaPath,
    });
    // Filter by phase if specified
    if (phase) {
        return skills.filter((skill) => coreMatchesPhase(skill, phase));
    }
    return skills;
}
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
export async function loadSkillFile(filePath, options = {}) {
    return coreLoadSkillFile(filePath, options);
}
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
export async function loadSkillMetadata(filePath, options = {}) {
    return coreLoadSkillMetadata(filePath, options);
}
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
export async function loadAllSkillMetadata(options = {}) {
    return coreLoadAllSkillMetadata(options);
}
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
export function selectSkills(skills, options) {
    return coreSelectSkills(skills, {
        phase: options.phase,
        changedFiles: options.changedFiles,
        availableContexts: options.availableContexts ?? [],
        availableDependencies: options.availableDependencies,
    });
}
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
export async function buildExecutionPlan(options) {
    const result = await coreBuildExecutionPlan({
        phase: options.phase,
        changedFiles: options.changedFiles,
        availableContexts: options.availableContexts ?? [],
        availableDependencies: options.availableDependencies,
        preferredModelHint: options.preferredModelHint ?? 'balanced',
        skills: options.skills,
        diffText: options.diffText,
    });
    return result;
}
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
export async function review(options) {
    const { phase = 'midstream', files = [], skillsDir, availableContexts = ['diff', 'fullFile'], availableDependencies, preferredModelHint = 'balanced', diffText, provider, concurrency = 3, } = options;
    // Load skills
    const skills = await loadSkills({ skillsDir, phase });
    // Build execution plan
    const plan = await buildExecutionPlan({
        phase,
        changedFiles: files,
        availableContexts,
        availableDependencies,
        preferredModelHint,
        skills,
        diffText,
    });
    // Execute selected skills with configurable concurrency; individual failures are non-fatal
    const allFindings = [];
    if (provider) {
        const skills = plan.selected;
        if (concurrency <= 0) {
            // unlimited: original behavior
            const results = await Promise.allSettled(skills.map((skill) => executeSkillWithAI(skill, provider, files, diffText)));
            for (const result of results) {
                if (result.status === 'fulfilled')
                    allFindings.push(...result.value);
            }
        }
        else {
            // chunk-based concurrency
            for (let i = 0; i < skills.length; i += concurrency) {
                const chunk = skills.slice(i, i + concurrency);
                const results = await Promise.allSettled(chunk.map((skill) => executeSkillWithAI(skill, provider, files, diffText)));
                for (const result of results) {
                    if (result.status === 'fulfilled')
                        allFindings.push(...result.value);
                }
            }
        }
    }
    const bySeverity = { critical: 0, major: 0, minor: 0, info: 0 };
    for (const f of allFindings) {
        bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    }
    const result = {
        findings: allFindings,
        summary: {
            totalFindings: allFindings.length,
            bySeverity,
            filesReviewed: files.length,
            skillsExecuted: plan.selected.length,
        },
        metadata: {
            phase,
            files,
            timestamp: new Date().toISOString(),
            skillsExecuted: plan.selected.map((s) => s.metadata.id),
            skillsSkipped: plan.skipped.map((s) => s.skill.metadata.id),
        },
    };
    return result;
}
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
export async function evaluateSkill(options) {
    const { skillId, provider, files = [], inputContexts: _inputContexts = [], skillsDir } = options;
    const startTime = Date.now();
    try {
        // Load all skills and find the target skill
        const skills = await loadSkills({ skillsDir });
        const skill = skills.find((s) => s.metadata.id === skillId);
        if (!skill) {
            throw new Error(`Skill not found: ${skillId}`);
        }
        const findings = await executeSkillWithAI(skill, provider, files);
        const executionTime = Date.now() - startTime;
        return {
            skill,
            success: true,
            findings,
            executionTime,
        };
    }
    catch (error) {
        const executionTime = Date.now() - startTime;
        return {
            skill: {}, // Placeholder
            success: false,
            error: error instanceof Error ? error.message : String(error),
            executionTime,
        };
    }
}
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
export function getDefaultPaths() {
    return defaultPaths;
}
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
export function matchesPhase(skill, phase) {
    return coreMatchesPhase(skill, phase);
}
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
export function rankByModelHint(skills, preferredModelHint = 'balanced') {
    return coreRankByModelHint(skills, preferredModelHint);
}
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
export function summarizeSkill(skill) {
    return coreSummarizeSkill(skill);
}
// Re-export SkillLoaderError for error handling
export { SkillLoaderError };
//# sourceMappingURL=index.js.map