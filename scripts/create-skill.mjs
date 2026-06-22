#!/usr/bin/env node
/**
 * Create Skill Scaffolding Tool
 *
 * Generates a new skill from template with interactive prompts.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const templateDir = join(repoRoot, 'scripts/templates/skill');
const skillsDir = join(repoRoot, 'skills');

/**
 * Prompt user for input with retry on validation failure
 */
async function prompt(rl, question, defaultValue, validator = null) {
  while (true) {
    const answer = await rl.question(
      defaultValue ? `${question} (${defaultValue}): ` : `${question}: `
    );
    const value = answer.trim() || defaultValue || '';

    if (validator) {
      const validation = validator(value);
      if (validation !== true) {
        console.error(`❌ ${validation}`);
        continue; // Retry on validation failure
      }
    }

    return value;
  }
}

/**
 * Validate skill ID format
 */
function validateSkillId(id) {
  if (!id) return 'スキルIDは必須です';
  if (!/^[a-z0-9-]+$/.test(id)) {
    return 'スキルIDは小文字、数字、ハイフンのみ使用できます';
  }
  return true;
}

/**
 * Validate version format
 */
function validateVersion(version) {
  if (!version) return 'バージョンは必須です';
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return 'バージョンはsemver形式（x.y.z）である必要があります';
  }
  return true;
}

/**
 * Validate required field
 */
function validateRequired(fieldName) {
  return (value) => {
    if (!value) return `${fieldName}は必須です`;
    return true;
  };
}

/**
 * Validate phase
 */
function validatePhase(phase) {
  if (!['upstream', 'midstream', 'downstream'].includes(phase)) {
    return 'フェーズは upstream、midstream、または downstream である必要があります';
  }
  return true;
}

/**
 * Validate severity
 */
function validateSeverity(severity) {
  if (!['info', 'minor', 'major', 'critical'].includes(severity)) {
    return '重要度は info、minor、major、または critical である必要があります';
  }
  return true;
}

/**
 * Replace placeholders in file content with safer strategy
 */
function replacePlaceholders(content, replacements) {
  let result = content;

  // Sort replacements by length (descending) to replace more specific patterns first
  const sortedReplacements = Object.entries(replacements).sort((a, b) => b[0].length - a[0].length);

  for (const [key, value] of sortedReplacements) {
    // Escape special regex characters in the key
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedKey, 'g');
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * Process template file
 */
function processTemplateFile(sourcePath, targetPath, replacements) {
  const content = readFileSync(sourcePath, 'utf-8');
  const processed = replacePlaceholders(content, replacements);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, processed, 'utf-8');
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 新しいスキルを作成\n');

  // Check template directory existence
  if (!existsSync(templateDir)) {
    console.error(`❌ テンプレートディレクトリが見つかりません: ${templateDir}`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });

  try {
    // Collect user input with validation and retry
    const id = await prompt(
      rl,
      'スキルID（例: rr-midstream-code-quality-001）',
      null,
      validateSkillId
    );

    // Check if skill already exists
    const skillPath = join(skillsDir, id);
    if (existsSync(skillPath)) {
      console.error(`❌ スキルは既に存在します: ${skillPath}`);
      rl.close();
      process.exit(1);
    }

    const version = await prompt(rl, 'バージョン', '0.1.0', validateVersion);

    const name = await prompt(
      rl,
      'スキル名（例: コード品質レビュー）',
      null,
      validateRequired('スキル名')
    );

    const description = await prompt(
      rl,
      '説明（このスキルが何をチェックするか）',
      null,
      validateRequired('説明')
    );

    const phase = await prompt(
      rl,
      'フェーズ (upstream/midstream/downstream)',
      'midstream',
      validatePhase
    );

    const applyTo = await prompt(rl, 'ファイルパターン（glob、カンマ区切り）', 'src/**/*.ts');
    const applyToArray = applyTo
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const tags = await prompt(rl, 'タグ（カンマ区切り）', '');
    const tagsArray = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const severity = await prompt(
      rl,
      '重要度 (info/minor/major/critical)',
      'minor',
      validateSeverity
    );

    rl.close();

    // Prepare replacements with more specific patterns first
    const replacements = {
      // Most specific patterns first to avoid unintended replacements
      'rr-<phase>-<category>-<number>': id,
      '<Skill Name>': name,
      '<What this skill does>': description,
      "'0.1.0'": `'${version}'`,
      // Multi-line patterns
      "  - 'src/**/*.ts'\n  - 'tests/**/*.test.ts'": applyToArray
        .map((p) => `  - '${p}'`)
        .join('\n'),
      // Tag patterns
      '  - example\n  - category':
        tagsArray.length > 0 ? tagsArray.map((t) => `  - ${t}`).join('\n') : '  - example',
      // YAML value patterns (more specific)
      'category: midstream': `category: ${phase}`,
      'phase: midstream': `phase: ${phase}`,
      'severity: minor': `severity: ${severity}`,
    };

    console.log('\n📝 スキルファイルを作成中...\n');

    // Copy template structure
    cpSync(templateDir, skillPath, { recursive: true });

    // Process template files
    const filesToProcess = [
      'SKILL.md',
      'README.md',
      'prompt/system.md',
      'prompt/user.md',
      'eval/promptfoo.yaml',
    ];

    for (const file of filesToProcess) {
      const sourcePath = join(skillPath, file);
      if (existsSync(sourcePath)) {
        processTemplateFile(sourcePath, sourcePath, replacements);
        console.log(`  ✅ ${file}`);
      }
    }

    console.log(`\n✅ スキルを作成しました: ${skillPath}\n`);
    console.log('次のステップ:');
    console.log(`  1. cd ${skillPath}`);
    console.log('  2. prompt/system.md と prompt/user.md を編集');
    console.log('  3. fixtures/ にテストフィクスチャを追加');
    console.log('  4. golden/ に期待される出力を追加');
    console.log('  5. バリデーション実行: npm run validate:skill-yaml');
    console.log('  6. テスト実行: npx promptfoo eval（設定済みの場合）\n');
  } catch (error) {
    rl.close();
    console.error('❌ エラー:', error.message);
    process.exit(1);
  }
}

main();
