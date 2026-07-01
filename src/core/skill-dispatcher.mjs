import path from 'node:path'; // Added for path.join
import { minimatch } from 'minimatch';
import { loadConfig } from '../config/loader.mjs';
import { loadSkillsCached as loadSkills } from '../../runners/core/skill-cache.mjs';
import { AIClientFactory } from '../ai/factory.mjs';
import { buildSystemPrompt } from '../prompts/buildSystemPrompt.mjs';
import { isLlmEnabled } from '../lib/utils.mjs';
import { isUsageTelemetryEnabled, persistUsageEvents } from '../lib/usage-persistence.mjs';

const MODEL_HINT_TO_NAME = {
  cheap: 'gpt-4o-mini',
  balanced: 'gpt-4o',
  'high-accuracy': 'gpt-4o',
};

function resolveModelName(skill) {
  if (skill.model) return skill.model;
  if (skill.modelHint && MODEL_HINT_TO_NAME[skill.modelHint]) {
    return MODEL_HINT_TO_NAME[skill.modelHint];
  }
  return MODEL_HINT_TO_NAME.balanced;
}

function shouldExclude(filePath, patterns = []) {
  return patterns.some((pattern) => minimatch(filePath, pattern, { dot: true }));
}

export class SkillDispatcher {
  constructor(repoRoot) {
    this.repoRoot = repoRoot;
  }

  async run(changedFiles, getFileDiff, phase = 'midstream', dryRun = false, debug = false) {
    const config = await loadConfig(this.repoRoot);
    const results = [];
    const language = config.review?.language || 'en';
    const llmEnabled = isLlmEnabled();

    let skills = (config.skills || []).map((skill) => ({
      ...skill,
      phase: skill.phase ?? skill.trigger?.phase,
      files: skill.files ?? skill.applyTo ?? [],
    }));
    if (skills.length === 0) {
      // Fallback: load skills from local directory if not in config
      console.log('Loading skills from local directory...');
      const loaded = await loadSkills({ skillsDir: path.join(this.repoRoot, 'skills') });
      skills = loaded.map((s) => ({
        ...s.metadata,
        body: s.body, // Include body for prompt generation
        files: s.metadata.files || s.metadata.applyTo || [], // Normalize files
      }));
    }
    console.log(`Loaded ${skills.length} skills. Filtering by phase: ${phase}`);

    if (skills.length === 0) {
      console.log('No skills configured or found in skills/ directory.');
      return results;
    }

    const excludePatterns = config.exclude?.files ?? [];
    const reviewFiles = changedFiles.filter((file) => !shouldExclude(file, excludePatterns));

    if (!reviewFiles.length) {
      console.log('No files to review after applying exclude patterns.');
      return results;
    }

    for (const file of reviewFiles) {
      // 1. Identify applicable skills for this file
      const fileMatched = skills.filter((skill) =>
        (skill.files || []).some((pattern) => minimatch(file, pattern, { dot: true }))
      );
      const phaseMatched = fileMatched.filter(
        (skill) =>
          !skill.phase ||
          skill.phase === phase ||
          (Array.isArray(skill.phase) && skill.phase.includes(phase))
      );
      const applicableSkills = phaseMatched.filter(
        (skill) => !(skill.exclude ?? []).some((pattern) => minimatch(file, pattern, { dot: true }))
      );

      if (applicableSkills.length === 0) {
        if (debug) {
          const excluded = phaseMatched.filter((skill) =>
            (skill.exclude ?? []).some((pattern) => minimatch(file, pattern, { dot: true }))
          );
          console.log(
            `Skipping ${file}: matched files ${fileMatched.length}/${skills.length}, phase ok ${phaseMatched.length}/${fileMatched.length}, excluded ${excluded.length}.`
          );
        }
        continue;
      }

      console.log(
        `Analyzing ${file} with skills: ${applicableSkills.map((s) => s.name).join(', ')}`
      );

      // 2. Execute skills in parallel
      const diff = await getFileDiff(file); // Dependency injection for file reading (once per file)

      const skillPromises = applicableSkills.map(async (skill) => {
        try {
          const modelName = resolveModelName(skill);
          const systemPrompt = buildSystemPrompt(skill, language);

          if (debug) {
            console.log(
              `\n--- System Prompt Debug (${skill.name}) ---\n${systemPrompt}\n-----------------------------------\n`
            );
          }

          if (dryRun) {
            console.log(`  -> Invoking (dry-run) ${modelName} for skill "${skill.name}"...`);
            return {
              file,
              skill: skill.name,
              review: `(dry-run) Skipped LLM call for skill: ${skill.name}`,
            };
          }

          if (!llmEnabled) {
            console.log(`  -> Skipped (no API key) skill "${skill.name}"...`);
            return {
              file,
              skill: skill.name,
              review: `(skipped) LLM API key not set for skill: ${skill.name}`,
            };
          }

          const client = AIClientFactory.create({
            modelName,
            temperature: skill.temperature ?? 0,
            maxTokens: skill.maxTokens,
            disableCache: skill.disableCache,
          });
          console.log(`  -> Invoking ${modelName} for skill "${skill.name}"...`);
          const review = await client.generateReview(systemPrompt, diff);

          const result = {
            file,
            skill: skill.name,
            review,
          };
          // Only Anthropic populates lastUsage today. Future providers can
          // adopt the same convention; consumers should handle `undefined`.
          if (client.lastUsage) {
            result.usage = client.lastUsage;
          }
          return result;
        } catch (error) {
          console.error(`  [Error] Failed to execute skill "${skill.name}" on ${file}:`, error);
          // Return error info in the result so it can be reported if needed
          return {
            file,
            skill: skill.name,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const fileResults = await Promise.all(skillPromises);
      results.push(...fileResults);
    }

    if (isUsageTelemetryEnabled()) {
      try {
        await persistUsageEvents(results, { rootDir: this.repoRoot });
      } catch (err) {
        // Persistence is non-critical; failing here must not break the
        // review pipeline. Log and continue.
        console.warn(`[usage telemetry] failed to persist events: ${err?.message || err}`);
      }
    }

    return results;
  }
}
