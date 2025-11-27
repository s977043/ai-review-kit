#!/usr/bin/env node
import { tracer, enabled as otelEnabled } from '../src/tracing.mjs';
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
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to parse JSON schema at ${schemaPath}: ${err.message}`);
    throw err;
  }
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
  let schema;
  if (otelEnabled) {
    schema = await tracer.startActiveSpan('load-schema', async (span) => {
      try {
        const s = await loadSchema();
        // mark as ok
        // No explicit status API used here to keep SDK compatibility
        return s;
      } catch (e) {
        span.recordException(e);
        throw e;
      } finally {
        span.end();
      }
    });
  } else {
    schema = await loadSchema();
  }
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);

  // Make sure Ajv recognizes the https draft-07 meta-schema without
  // mutating the user's schema document. This avoids switching the
  // schema $schema property while allowing Ajv to validate properly.
  // Attempt to register the draft-07 https meta-schema with Ajv without
  // mutating the schema object. This avoids rewriting the schema's $schema
  // property to the http variant while still allowing validation to proceed.
  const draft7Path = path.join(repoRoot, 'node_modules', 'ajv', 'dist', 'refs', 'json-schema-draft-07.json');
  try {
    const json = await fs.readFile(draft7Path, 'utf8');
    const draft7 = JSON.parse(json);
    // The draft7 meta-schema file typically uses 'http://' in `$id`.
    // Ajv already registers the http variant. To support https in
    // schema $schema fields, register a clone of the meta-schema with
    // the https id to avoid conflicts.
    const draft7Https = { ...draft7, $id: 'https://json-schema.org/draft-07/schema#' };
    ajv.addMetaSchema(draft7Https, 'https://json-schema.org/draft-07/schema#');
  } catch (err) {
    console.warn('⚠️  Could not register draft-07 meta-schema for https; attempting without addMetaSchema:', err.message);
  }

  const validate = ajv.compile(schema);
  const files = otelEnabled
    ? await tracer.startActiveSpan('list-files', async (span) => {
      try {
        const f = await listAgentFiles();
        span.end();
        return f;
      } catch (e) {
        span.recordException(e);
        span.end();
        throw e;
      }
    })
    : await listAgentFiles();

  if (files.length === 0) {
    console.warn('⚠️  No agent files found in agents/examples.');
    return true;
  }

  let success = true;

  for (const filePath of files) {
    let fileSpan;
    if (otelEnabled) {
      fileSpan = tracer.startSpan('validate-file', { attributes: { 'file.path': filePath } });
    }
    const relativePath = path.relative(repoRoot, filePath);
    const raw = await fs.readFile(filePath, 'utf8');
    let data = {};
    try {
      data = yaml.load(raw) ?? {};
    } catch (err) {
      if (fileSpan) {
        fileSpan.recordException(err);
      }
      success = false;
      console.error(`❌ ${relativePath}`);
      console.error(`  - YAML parsing error: ${err.message}`);
      continue;
    }
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
    if (fileSpan) {
      fileSpan.end();
    }
  }

  return success;
}

const ok = await validateAgents();
if (!ok) {
  process.exitCode = 1;
}
