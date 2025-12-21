import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigLoader, ConfigLoaderError } from '../src/config/loader.mjs';
import { defaultConfig } from '../src/config/default.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'river-config-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('設定ファイルがない場合はデフォルトを返す', async () => {
  await withTempDir(async dir => {
    const loader = new ConfigLoader();
    const result = await loader.load(dir);
    assert.equal(result.source, 'default');
    assert.equal(result.path, null);
    assert.deepEqual(result.config, defaultConfig);
  });
});

test('一部のみ上書きした設定をマージできる', async () => {
  await withTempDir(async dir => {
    const configPath = path.join(dir, '.river-reviewer.json');
    const custom = {
      model: { modelName: 'gpt-custom' },
      review: { language: 'en', additionalInstructions: ['Focus on security'] },
      exclude: { files: ['**/*.md'] },
    };
    await fs.writeFile(configPath, JSON.stringify(custom), 'utf8');

    const loader = new ConfigLoader();
    const result = await loader.load(dir);
    assert.equal(result.source, 'file');
    assert.equal(result.path, configPath);
    assert.equal(result.config.model.modelName, 'gpt-custom');
    assert.equal(result.config.review.language, 'en');
    assert.deepEqual(result.config.review.additionalInstructions, ['Focus on security']);
    assert.deepEqual(result.config.exclude.files, ['**/*.md']);
    assert.deepEqual(result.config.exclude.prLabelsToIgnore, defaultConfig.exclude.prLabelsToIgnore);
    assert.equal(result.config.review.severity, defaultConfig.review.severity);
  });
});

test('スキーマ違反の設定はエラーになる', async () => {
  await withTempDir(async dir => {
    const configPath = path.join(dir, '.river-reviewer.json');
    await fs.writeFile(configPath, JSON.stringify({ model: { provider: 'unknown' } }), 'utf8');
    const loader = new ConfigLoader();
    await assert.rejects(loader.load(dir), ConfigLoaderError);
  });
});
