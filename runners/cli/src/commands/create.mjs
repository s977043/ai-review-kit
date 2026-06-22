import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { input, select, confirm } from '@inquirer/prompts';
import { Logger } from '../utils/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..', '..', '..');
const templateDir = join(repoRoot, 'scripts/templates/skill');
const skillsDir = join(repoRoot, 'skills');

function validateSkillId(id) {
  if (!id) return 'Skill ID is required';
  if (!/^[a-z0-9-]+$/.test(id)) {
    return 'Skill ID must contain only lowercase letters, numbers, and hyphens';
  }
  return true;
}

function validateVersion(version) {
  if (!version) return 'Version is required';
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return 'Version must be in semver format (x.y.z)';
  }
  return true;
}

function validateRequired(value, fieldName) {
  if (!value || value.trim() === '') {
    return `${fieldName} is required`;
  }
  return true;
}

function replacePlaceholders(content, replacements) {
  let result = content;
  const sortedReplacements = Object.entries(replacements).sort((a, b) => b[0].length - a[0].length);

  for (const [key, value] of sortedReplacements) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedKey, 'g');
    result = result.replace(regex, value);
  }

  return result;
}

function processTemplateFile(sourcePath, targetPath, replacements) {
  const content = readFileSync(sourcePath, 'utf-8');
  const processed = replacePlaceholders(content, replacements);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, processed, 'utf-8');
}

export async function createCommand(skillName, options) {
  const logger = new Logger({ silent: options.quiet });

  try {
    logger.info('Creating new skill\n');

    if (!existsSync(templateDir)) {
      logger.error(`Template directory not found: ${templateDir}`);
      process.exit(1);
    }

    let id = skillName;
    if (!id && !options.interactive) {
      logger.error('Skill name is required when not in interactive mode');
      logger.info('Usage: river create skill <name> or river create skill --interactive');
      process.exit(1);
    }

    if (options.interactive || !id) {
      id = await input({
        message: 'Skill ID (e.g., rr-midstream-code-quality-001):',
        default: id,
        validate: validateSkillId,
      });
    } else {
      const validationResult = validateSkillId(id);
      if (validationResult !== true) {
        logger.error(validationResult);
        process.exit(1);
      }
    }

    const skillPath = join(skillsDir, id);
    if (existsSync(skillPath)) {
      logger.error(`Skill already exists: ${skillPath}`);
      process.exit(1);
    }

    let version = options.version || '0.1.0';
    let name = id;
    let description = `Review skill: ${id}`;
    let phase = options.phase || 'midstream';
    let applyTo = options.applyTo || 'src/**/*.ts';
    let tags = options.tags || '';
    let severity = options.severity || 'minor';

    if (options.interactive) {
      version = await input({
        message: 'Version:',
        default: version,
        validate: validateVersion,
      });

      name = await input({
        message: 'Skill name:',
        default: name,
        validate: (value) => validateRequired(value, 'Skill name'),
      });

      description = await input({
        message: 'Description:',
        default: description,
        validate: (value) => validateRequired(value, 'Description'),
      });

      phase = await select({
        message: 'Phase:',
        choices: [
          { name: 'upstream', value: 'upstream' },
          { name: 'midstream', value: 'midstream' },
          { name: 'downstream', value: 'downstream' },
        ],
        default: phase,
      });

      applyTo = await input({
        message: 'File patterns (comma-separated globs):',
        default: applyTo,
      });

      tags = await input({
        message: 'Tags (comma-separated):',
        default: tags,
      });

      severity = await select({
        message: 'Severity:',
        choices: [
          { name: 'info', value: 'info' },
          { name: 'minor', value: 'minor' },
          { name: 'major', value: 'major' },
          { name: 'critical', value: 'critical' },
        ],
        default: severity,
      });

      const shouldProceed = await confirm({
        message: `Create skill at ${skillPath}?`,
        default: true,
      });

      if (!shouldProceed) {
        logger.info('Skill creation cancelled');
        return;
      }
    }

    const applyToArray = applyTo
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const tagsArray = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const replacements = {
      'rr-<phase>-<category>-<number>': id,
      '<Skill Name>': name,
      '<What this skill does>': description,
      '"0.1.0"': `"${version}"`,
      "  - 'src/**/*.ts'\n  - 'tests/**/*.test.ts'": applyToArray
        .map((p) => `  - '${p}'`)
        .join('\n'),
      '  - example\n  - category':
        tagsArray.length > 0 ? tagsArray.map((t) => `  - ${t}`).join('\n') : '  - example',
      'phase: midstream': `phase: ${phase}`,
      'severity: minor': `severity: ${severity}`,
    };

    logger.startSpinner('Creating skill files...');

    cpSync(templateDir, skillPath, { recursive: true });

    const filesToProcess = [
      'skill.yaml',
      'README.md',
      'prompt/system.md',
      'prompt/user.md',
      'eval/promptfoo.yaml',
    ];

    for (const file of filesToProcess) {
      const sourcePath = join(skillPath, file);
      if (existsSync(sourcePath)) {
        processTemplateFile(sourcePath, sourcePath, replacements);
      }
    }

    logger.succeedSpinner('Skill created successfully');

    logger.success(`\nSkill created at: ${skillPath}\n`);
    logger.info('Next steps:');
    logger.info(`  1. cd ${skillPath}`);
    logger.info('  2. Edit prompt/system.md and prompt/user.md');
    logger.info('  3. Add test fixtures to fixtures/');
    logger.info('  4. Add expected output to golden/');
    logger.info('  5. Validate: npm run validate:skill-yaml');
    logger.info('  6. Test: npx promptfoo eval (if configured)\n');
  } catch (error) {
    logger.failSpinner('Skill creation failed');
    logger.error(`Error: ${error.message}`);
    if (options.debug) {
      logger.error(error.stack);
    }
    process.exit(1);
  }
}
