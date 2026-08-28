#!/usr/bin/env node
import { tracer, enabled as otelEnabled } from '../src/tracing.mjs';
import { SpanStatusCode } from '@opentelemetry/api';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { isDirectRun } from './lib/is-direct-run.mjs';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'agents/spec/agent.schema.json');
const examplesDir = path.join(repoRoot, 'agents/examples');

export async function loadSchema() {
  const raw = await fs.readFile(schemaPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to parse JSON schema at ${schemaPath}: ${err.message}`);
    throw err;
  }
}

export async function listAgentFiles() {
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

// schema をコンパイルして検証関数を返す純関数。CLI 実行時は validateAgents()
// から、in-process テストからは直接呼び出して検出ロジック（schema 検証）を
// 単体検証できるよう export する。
export async function createAgentValidator(schema) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);

  // Make sure Ajv recognizes the https draft-07 meta-schema without
  // mutating the user's schema document. This avoids switching the
  // schema $schema property while allowing Ajv to validate properly.
  //
  // #1982: 取得は **モジュール解決経由**で行う。以前は
  // `path.join(repoRoot, 'node_modules', 'ajv', ...)` の絶対パスを
  // `fs.readFile` していたが、`git worktree` で作った作業ツリーには
  // `node_modules/` が無い。Node のモジュール解決は親ディレクトリを遡るので
  // `import Ajv from 'ajv'` は通る一方、絶対パスの `fs.readFile` は遡らず
  // ENOENT になり、worktree でだけ `tests/validate-agents.test.mjs` が落ちた。
  //
  // `createRequire(import.meta.url)` を選んだ理由:
  //   - 本リポジトリの既存慣習にあたる。`scripts/build-social-assets.mjs:10-11`
  //     が同じ形（`require('@resvg/resvg-js/package.json')`）で npm パッケージ内の
  //     JSON を読んでおり、新しいパターンを増やさずに済む。
  //   - `ajv` は `exports` マップを持たない（実測: `require('ajv/package.json').exports`
  //     が `undefined`）ため、subpath 解決が塞がれていない。
  //   - 同期で読めるため、成否が `createAgentValidator` の呼び出し 1 点に集約される。
  //
  // 採らなかった手段:
  //   - `import.meta.resolve()` + `fs.readFile`: 解決自体は成功する（実測済み）が、
  //     URL → パス変換と非同期ファイル読みが残るだけで、絶対パス版と同じ
  //     「ファイルシステムを直接叩く」形が温存される。本リポジトリに利用実績も無い。
  //   - `await import(..., { with: { type: 'json' } })`: 同じく成功するが、
  //     JSON import attributes を使うモジュールは本リポジトリにまだ 1 つも無く、
  //     このスクリプトだけ構文面を先行させる理由が無い。
  //
  // ここで try/catch を張らないのも意図的。解決に失敗した場合、直後の
  // `ajv.compile(schema)` が必ず `no schema with key or ref ".../draft-07/schema#"`
  // で落ちる。warn に落とすと本当の原因（meta-schema を取れていない）が隠れ、
  // 呼び出し側には無関係に見えるエラーだけが残る。fail-safe の向きとして、
  // 取得できない事実をそのまま投げる。
  const draft7 = require('ajv/dist/refs/json-schema-draft-07.json');
  // The draft7 meta-schema file typically uses 'http://' in `$id`.
  // Ajv already registers the http variant. To support https in
  // schema $schema fields, register a clone of the meta-schema with
  // the https id to avoid conflicts.
  const draft7Https = { ...draft7, $id: 'https://json-schema.org/draft-07/schema#' };
  ajv.addMetaSchema(draft7Https, 'https://json-schema.org/draft-07/schema#');

  return ajv.compile(schema);
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
      }
    });
  } else {
    schema = await loadSchema();
  }
  const validate = await createAgentValidator(schema);
  const files = otelEnabled
    ? await tracer.startActiveSpan('list-files', async (span) => {
        try {
          return await listAgentFiles();
        } catch (e) {
          span.recordException(e);
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
    if (otelEnabled) {
      await tracer.startActiveSpan(
        'validate-file',
        { attributes: { 'file.path': filePath } },
        async (fileSpan) => {
          try {
            const result = await validateSingleFile(filePath, validate, repoRoot);
            if (!result) {
              success = false;
            }
          } catch (err) {
            fileSpan.recordException(err);
            fileSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            success = false;
          } finally {
            fileSpan.end();
          }
        }
      );
    } else {
      const result = await validateSingleFile(filePath, validate, repoRoot);
      if (!result) {
        success = false;
      }
    }
  }

  return success;
}

async function validateSingleFile(filePath, validate, repoRoot) {
  const relativePath = path.relative(repoRoot, filePath);
  const raw = await fs.readFile(filePath, 'utf8');
  let data = {};
  try {
    data = yaml.load(raw) ?? {};
  } catch (err) {
    console.error(`❌ ${relativePath}`);
    console.error(`  - YAML parsing error: ${err.message}`);
    throw err;
  }
  const valid = validate(data);

  if (valid) {
    console.log(`✅ ${relativePath}`);
    return true;
  } else {
    console.error(`❌ ${relativePath}`);
    for (const err of validate.errors ?? []) {
      const instance = err.instancePath || '/';
      console.error(`  - ${instance}: ${err.message}`);
    }
    return false;
  }
}

async function main() {
  const ok = await validateAgents();
  if (!ok) {
    process.exitCode = 1;
  }
}

if (isDirectRun(import.meta.url)) {
  await main();
}
