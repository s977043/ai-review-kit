#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFrontMatter } from '../src/lib/skill-loader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const agentSkillsDir = path.join(repoRoot, 'skills', 'agent-skills');

function isKebabCaseName(name) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

async function hasReferencesDir(dirPath) {
  try {
    const stat = await fs.stat(path.join(dirPath, 'references'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function listSkillPackages(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(dirPath, entry.name);
    const skillPath = path.join(entryPath, 'SKILL.md');
    try {
      const stat = await fs.stat(skillPath);
      if (stat.isFile()) {
        packages.push(skillPath);
        continue;
      }
    } catch {
      // Continue to nested directories.
    }
    const nested = await listSkillPackages(entryPath);
    packages.push(...nested);
  }

  return packages.sort();
}

async function validateSkill(skillPath) {
  const relativePath = path.relative(repoRoot, skillPath);
  const dirName = path.basename(path.dirname(skillPath));
  const errors = [];

  if (!isKebabCaseName(dirName)) {
    errors.push('dir name must be lowercase kebab-case');
  }

  let metadata;
  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const parsed = parseFrontMatter(content);
    metadata = parsed.metadata ?? {};
  } catch (err) {
    errors.push(`frontmatter parse failed: ${err.message}`);
  }

  if (!metadata?.name || typeof metadata.name !== 'string') {
    errors.push('missing metadata.name');
  } else if (metadata.name !== dirName) {
    errors.push(`metadata.name must match directory name (${dirName})`);
  }

  if (!metadata?.description || typeof metadata.description !== 'string') {
    errors.push('missing metadata.description');
  }

  if (errors.length) {
    console.error(`❌ ${relativePath}`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    return false;
  }

  console.log(`✅ ${relativePath}`);
  const hasRefs = await hasReferencesDir(path.dirname(skillPath));
  if (!hasRefs) {
    console.warn(`⚠️  ${relativePath}: references/ directory is missing`);
  }
  return true;
}

async function validateAgentSkills() {
  try {
    await fs.access(agentSkillsDir);
  } catch {
    console.warn('⚠️  No skills/agent-skills directory found.');
    return true;
  }

  const packages = await listSkillPackages(agentSkillsDir);
  if (!packages.length) {
    console.warn('⚠️  No Agent Skills packages found under skills/agent-skills/.');
    return true;
  }

  let success = true;
  for (const skillPath of packages) {
    const ok = await validateSkill(skillPath);
    if (!ok) success = false;
  }
  return success;
}

const ok = await validateAgentSkills();
if (!ok) {
  process.exitCode = 1;
}
