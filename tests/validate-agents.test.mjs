import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as yaml from 'js-yaml';
import { loadSchema, createAgentValidator, listAgentFiles } from '../scripts/validate-agents.mjs';

// validate-agents.mjs の検出ロジック（ajv による schema 検証）を、プロセス起動なしで
// in-process に検証する。CLI 実行（agents:validate / trace:validate）は従来どおり
// subprocess で CI が担保する。

test('createAgentValidator: 実 example は schema を満たす（in-process happy）', async () => {
  const schema = await loadSchema();
  const validate = await createAgentValidator(schema);
  const files = await listAgentFiles();
  assert.ok(files.length > 0, 'agents/examples に .agent.yaml が存在すること');
  const data = yaml.load(await fs.readFile(files[0], 'utf8')) ?? {};
  assert.equal(validate(data), true);
});

test('createAgentValidator: required 欠落の空オブジェクトは不合格（in-process violation）', async () => {
  const schema = await loadSchema();
  const validate = await createAgentValidator(schema);
  assert.equal(validate({}), false);
  assert.ok((validate.errors ?? []).length > 0);
});
