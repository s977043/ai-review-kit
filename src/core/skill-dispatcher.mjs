import { minimatch } from 'minimatch';
import { loadConfig } from '../config/loader.mjs';
import { AIClientFactory } from '../ai/factory.mjs';
import { buildSystemPrompt } from '../prompts/buildSystemPrompt.mjs';

function shouldExclude(filePath, patterns = []) {
  return patterns.some(pattern => minimatch(filePath, pattern, { dot: true }));
}

export class SkillDispatcher {
  constructor(configPath) {
    this.configPath = configPath;
  }

  async run(changedFiles, getFileDiff) {
    const config = await loadConfig(this.configPath);
    const results = [];

    const skills = config.skills || [];
    console.log(`Loaded ${skills.length} skills from config.`);

    if (skills.length === 0) {
      console.log('No skills configured. Please add skills to your configuration file (or check if you are using the legacy config format).');
      return results;
    }

    const excludePatterns = config.exclude?.files ?? [];
    const reviewFiles = changedFiles.filter(file => !shouldExclude(file, excludePatterns));

    if (!reviewFiles.length) {
      console.log('No files to review after applying exclude patterns.');
      return results;
    }

    for (const file of reviewFiles) {
      // 1. Identify applicable skills for this file
      const applicableSkills = skills.filter(
        skill =>
          skill.files.some(pattern => minimatch(file, pattern, { dot: true })) &&
          !(skill.exclude ?? []).some(pattern => minimatch(file, pattern, { dot: true })),
      );

      if (applicableSkills.length === 0) continue;

      console.log(`Analyzing ${file} with skills: ${applicableSkills.map(s => s.name).join(', ')}`);

      // 2. Execute each skill (Potential for parallel execution here)
      for (const skill of applicableSkills) {
        try {
          const client = AIClientFactory.create({ modelName: skill.model, temperature: skill.temperature });
          const systemPrompt = buildSystemPrompt(skill);
          const diff = await getFileDiff(file); // Dependency injection for file reading

          console.log(`  -> Invoking ${skill.model} for skill "${skill.name}"...`);
          const review = await client.generateReview(systemPrompt, diff);

          results.push({
            file,
            skill: skill.name,
            review,
          });
        } catch (error) {
          console.error(`  [Error] Failed to execute skill "${skill.name}" on ${file}:`, error);
        }
      }
    }

    return results;
  }
}
