#!/usr/bin/env node
import path from 'path';
import { defaultPaths, createSkillValidator, loadSchema, loadSkillFile, listSkillFiles } from '../src/lib/skill-loader.mjs';

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
    const relativePath = filePath.replace(`${defaultPaths.repoRoot}${path.sep}`, '');
    try {
      await loadSkillFile(filePath, { validator });
      console.log(`✅ ${relativePath}`);
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
