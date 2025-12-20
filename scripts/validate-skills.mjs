#!/usr/bin/env node
import path from 'path';
import { defaultPaths, createSkillValidator, loadSchema, loadSkillFile, listSkillFiles } from '../src/lib/skill-loader.mjs';

function hasSection(text, patterns) {
  return patterns.some(re => re.test(text));
}

function warnMissingGuardsAndNonGoals(skill, relativePath) {
  const tags = skill?.metadata?.tags ?? [];
  const excludedTags = ['sample', 'hello', 'policy', 'process'];
  if (Array.isArray(tags) && tags.some(t => excludedTags.includes(t))) return;
  const body = skill.body ?? '';
  const hasNonGoals = hasSection(body, [/^##\s+Non-goals\b/m, /^##\s+非目的\b/m, /扱わないこと/m]);
  const hasGuards = hasSection(body, [/^##\s+False-positive guards\b/m, /抑制条件/m, /誤検知ガード/m]);
  if (hasNonGoals && hasGuards) return;
  const missing = [];
  if (!hasNonGoals) missing.push('Non-goals');
  if (!hasGuards) missing.push('False-positive guards');
  console.warn(`⚠️  ${relativePath}: Missing section(s): ${missing.join(', ')}`);
}

async function validateSkills() {
  const schema = await loadSchema(defaultPaths.schemaPath);
  const validator = createSkillValidator(schema);
  let files = [];
  try {
    files = await listSkillFiles(defaultPaths.skillsDir);
  } catch (err) {
    console.error(`❌ Failed to list skills: ${err.message}`);
    throw err;
  }

  if (!files.length) {
    console.warn('⚠️  No skill files found under skills/.');
    return true;
  }

  let success = true;
  for (const filePath of files) {
    const relativePath = path.relative(defaultPaths.repoRoot, filePath);
    try {
      const skill = await loadSkillFile(filePath, { validator });
      console.log(`✅ ${relativePath}`);
      warnMissingGuardsAndNonGoals(skill, relativePath);
    } catch (err) {
      console.error(`❌ ${relativePath}`);
      if (err.details && Array.isArray(err.details)) {
        for (const detail of err.details) {
          const instance = detail.instancePath || '/';
          console.error(`  - ${instance}: ${detail.message}`);
        }
      } else {
        console.error(`  - ${err.message}`);
      }
      success = false;
    }
  }

  return success;
}

const ok = await validateSkills();
if (!ok) {
  process.exitCode = 1;
}
