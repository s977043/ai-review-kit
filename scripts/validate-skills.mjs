#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'schemas', 'skill.schema.json');
const skillsDir = path.join(repoRoot, 'skills');
const allowedExt = new Set(['.md', '.mdx', '.yaml', '.yml']);

async function loadSchema() {
  const raw = await fs.readFile(schemaPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to parse JSON schema at ${schemaPath}: ${err.message}`);
    throw err;
  }
}

async function listSkillFiles(dir = skillsDir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listSkillFiles(entryPath);
      files.push(...nested);
    } else if (allowedExt.has(path.extname(entry.name)) && entry.name !== '.gitkeep') {
      files.push(entryPath);
    }
  }
  return files;
}

function parseFrontMatter(content, filePath) {
  if (!content.startsWith('---')) {
    throw new Error('Missing front matter block (---)');
  }
  const end = content.indexOf('\n---', 3);
  if (end === -1) {
    throw new Error('Unterminated front matter block');
  }
  const yamlBlock = content.slice(3, end).trim();
  if (!yamlBlock) {
    throw new Error('Front matter is empty');
  }
  try {
    return yaml.load(yamlBlock) ?? {};
  } catch (err) {
    throw new Error(`Front matter YAML parse error: ${err.message}`);
  }
}

async function parseSkillFile(filePath) {
  const ext = path.extname(filePath);
  const raw = await fs.readFile(filePath, 'utf8');
  if (ext === '.md' || ext === '.mdx') {
    return parseFrontMatter(raw, filePath);
  }
  try {
    return yaml.load(raw) ?? {};
  } catch (err) {
    throw new Error(`YAML parse error: ${err.message}`);
  }
}

async function validateSkills() {
  const schema = await loadSchema();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  let files;
  try {
    files = await listSkillFiles();
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
    const relativePath = path.relative(repoRoot, filePath);
    try {
      const data = await parseSkillFile(filePath);
      const valid = validate(data);
      if (valid) {
        console.log(`✅ ${relativePath}`);
      } else {
        console.error(`❌ ${relativePath}`);
        for (const err of validate.errors ?? []) {
          const instance = err.instancePath || '/';
          console.error(`  - ${instance}: ${err.message}`);
        }
        success = false;
      }
    } catch (err) {
      console.error(`❌ ${relativePath}`);
      console.error(`  - ${err.message}`);
      success = false;
    }
  }

  return success;
}

const ok = await validateSkills();
if (!ok) {
  process.exitCode = 1;
}
