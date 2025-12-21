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

test('YAML 形式の設定ファイルも読み込める', async () => {
  await withTempDir(async dir => {
    const configPath = path.join(dir, '.river-reviewer.yaml');
    const custom = [
      'model:',
      '  provider: anthropic',
      '  modelName: claude-3-5-sonnet',
      'review:',
      '  language: ja',
      '  severity: strict',
      'exclude:',
      '  files:',
      '    - "**/*.test.ts"',
    ].join('\n');
    await fs.writeFile(configPath, custom, 'utf8');

    const loader = new ConfigLoader();
    const result = await loader.load(dir);
    assert.equal(result.source, 'file');
    assert.equal(result.path, configPath);
    assert.equal(result.config.model.provider, 'anthropic');
    assert.equal(result.config.review.severity, 'strict');
    assert.deepEqual(result.config.exclude.files, ['**/*.test.ts']);
  });
});

test('.yml 拡張子の設定ファイルも検出できる', async () => {
  await withTempDir(async dir => {
    const configPath = path.join(dir, '.river-reviewer.yml');
    await fs.writeFile(
      configPath,
      [
        'model:',
        '  provider: google',
        '  modelName: gemini-1.5-flash',
        'review:',
        '  language: en',
      ].join('\n'),
      'utf8',
    );

    const loader = new ConfigLoader();
    const result = await loader.load(dir);
    assert.equal(result.source, 'file');
    assert.equal(result.path, configPath);
    assert.equal(result.config.model.provider, 'google');
    assert.equal(result.config.review.language, 'en');
  });
});

test('トップレベルがオブジェクトでない設定はエラーになる', async () => {
  await withTempDir(async dir => {
    const configPath = path.join(dir, '.river-reviewer.json');
    await fs.writeFile(configPath, JSON.stringify(['not', 'an', 'object']), 'utf8');
    const loader = new ConfigLoader();
    await assert.rejects(loader.load(dir), ConfigLoaderError);
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
