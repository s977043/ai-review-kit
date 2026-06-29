#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { reviewCommand } from './commands/review.mjs';
import { evalCommand } from './commands/eval.mjs';
import { createCommand } from './commands/create.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('river')
  .description('River Review CLI - AI-powered code review tool')
  .version(packageJson.version);

// river review command
program
  .command('review')
  .description('Review files in current branch')
  .argument('[files...]', 'Files to review (glob patterns)')
  .option('-p, --phase <phase>', 'Review phase (upstream|midstream|downstream)', 'midstream')
  .option('--model-hint <hint>', 'Model hint preference (cheap|balanced|high-accuracy)', 'balanced')
  .option('--context <contexts>', 'Available contexts (comma-separated: diff,fullFile,tests,etc.)')
  .option('--dependency <dependencies>', 'Available dependencies (comma-separated)')
  .option('--dry-run', 'Show execution plan without running review', false)
  .option('-v, --verbose', 'Show detailed output including skipped skills', false)
  .option('-q, --quiet', 'Suppress non-essential output', false)
  .option('--debug', 'Show debug information', false)
  .action(reviewCommand);

// river eval command
program
  .command('eval')
  .description('Evaluate a skill or all skills')
  .argument('[skill]', 'Path to skill file or directory')
  .option('-a, --all', 'Evaluate all skills', false)
  .option('-v, --verbose', 'Show detailed skill information', false)
  .option('-q, --quiet', 'Suppress non-essential output', false)
  .option('--debug', 'Show debug information', false)
  .action(evalCommand);

// river create command
const createCmd = program.command('create').description('Create new resources');

createCmd
  .command('skill')
  .description('Create a new skill')
  .argument('[name]', 'Skill ID (e.g., security)')
  .option('-i, --interactive', 'Interactive mode with prompts', false)
  .option('--version <version>', 'Skill version (semver format)', '0.1.0')
  .option('--phase <phase>', 'Review phase', 'midstream')
  .option('--apply-to <patterns>', 'File patterns (glob)', 'src/**/*.ts')
  .option('--tags <tags>', 'Tags (comma-separated)', '')
  .option('--severity <severity>', 'Severity level', 'minor')
  .option('-q, --quiet', 'Suppress non-essential output', false)
  .option('--debug', 'Show debug information', false)
  .action(createCommand);

// Parse and execute
program.parse();
