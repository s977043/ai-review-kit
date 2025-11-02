#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'agents/spec/agent.schema.json');
const examplesDir = path.join(repoRoot, 'agents/examples');

async function loadSchema() {
  const raw = await fs.readFile(schemaPath, 'utf8');
  return JSON.parse(raw);
}

async function listAgentFiles() {
  try {
    const entries = await fs.readdir(examplesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.agent.yaml'))
      .map((entry) => path.join(examplesDir, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function validateAgents() {
  const schema = await loadSchema();
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);

  // AJV includes draft-07 meta-schema with http URL by default
  // Our schema uses https for security best practice, so we normalize it
  if (schema.$schema === 'https://json-schema.org/draft-07/schema#') {
    schema.$schema = 'http://json-schema.org/draft-07/schema#';
  }

  const validate = ajv.compile(schema);
  const files = await listAgentFiles();

  if (files.length === 0) {
    console.warn('⚠️  No agent files found in agents/examples.');
    return true;
  }

  let success = true;

  for (const filePath of files) {
    const relativePath = path.relative(repoRoot, filePath);
    const raw = await fs.readFile(filePath, 'utf8');
    const data = yaml.load(raw) ?? {};
    const valid = validate(data);

    if (valid) {
      console.log(`✅ ${relativePath}`);
    } else {
      success = false;
      console.error(`❌ ${relativePath}`);
      for (const err of validate.errors ?? []) {
        const instance = err.instancePath || '/';
        console.error(`  - ${instance}: ${err.message}`);
      }
    }
  }

  return success;
}

const ok = await validateAgents();
if (!ok) {
  process.exitCode = 1;
}
