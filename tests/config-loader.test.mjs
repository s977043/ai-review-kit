import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigLoader, ConfigLoaderError, defaultGlobalConfigDir } from '../src/config/loader.mjs';
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
  await withTempDir(async (dir) => {
    const loader = new ConfigLoader();
    const result = await loader.load(dir);
    assert.equal(result.source, 'default');
    assert.equal(result.path, null);
    assert.deepEqual(result.config, defaultConfig);
  });
});

test('一部のみ上書きした設定をマージできる', async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.json');
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
    assert.deepEqual(
      result.config.exclude.prLabelsToIgnore,
      defaultConfig.exclude.prLabelsToIgnore
    );
    assert.equal(result.config.review.severity, defaultConfig.review.severity);
  });
});

// #1689 review W1b: 検証エラーの詳細は `error.issues` から組み立てる。zod 4 で
// 削除された `error.errors` を読んでいたため TypeError となり、周囲の catch が
// 汎用の「読み込みに失敗しました」へ握り潰していた。
test('検証エラーのメッセージに zod issue の内容が含まれる (Legacy Schema)', async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.json');
    await fs.writeFile(configPath, JSON.stringify({ review: { language: 'fr' } }), 'utf8');

    const loader = new ConfigLoader();
    await assert.rejects(
      () => loader.load(dir),
      (err) => {
        assert.ok(err instanceof ConfigLoaderError, `expected ConfigLoaderError, got ${err?.name}`);
        assert.match(err.message, /Legacy Schema/);
        assert.match(err.message, /review\.language/, 'the offending path must appear');
        assert.ok(
          !/読み込みに失敗しました/.test(err.message),
          'must not degrade into the generic read-failure message'
        );
        return true;
      }
    );
  });
});

test('検証エラーのメッセージに zod issue の内容が含まれる (Skill Schema)', async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.json');
    // `version` present → the loader takes the skill-schema branch.
    await fs.writeFile(
      configPath,
      JSON.stringify({ version: '1.0', review: { severity: 'harsh' } }),
      'utf8'
    );

    const loader = new ConfigLoader();
    await assert.rejects(
      () => loader.load(dir),
      (err) => {
        assert.ok(err instanceof ConfigLoaderError);
        assert.match(err.message, /Skill Schema/);
        assert.match(err.message, /review\.severity/);
        return true;
      }
    );
  });
});

// #1689 review W1a: `review.reviewers` は CLI の --reviewers と同名なので、
// 配列を書かれても従来どおり無害に無視されること（run 全体を落とさないこと）。
test('review.reviewers に配列を書いても読み込みは成功する', async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ review: { language: 'ja', reviewers: ['bug-hunter'] } }),
      'utf8'
    );

    const loader = new ConfigLoader();
    const result = await loader.load(dir);
    assert.equal(result.source, 'file');
    assert.equal(result.config.review.language, 'ja');
    assert.equal(result.config.review.reviewers, undefined, '未知キーとして除去される');
  });
});

test('review.orchestrator の設定はマージ後も保持される', async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ review: { orchestrator: { timeoutMs: 120000, progress: false } } }),
      'utf8'
    );

    const loader = new ConfigLoader();
    const result = await loader.load(dir);
    assert.deepEqual(result.config.review.orchestrator, { timeoutMs: 120000, progress: false });
  });
});

test('YAML 形式の設定ファイルも読み込める', async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.yaml');
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
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.yml');
    await fs.writeFile(
      configPath,
      [
        'model:',
        '  provider: google',
        '  modelName: gemini-1.5-flash',
        'review:',
        '  language: en',
      ].join('\n'),
      'utf8'
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
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.json');
    await fs.writeFile(configPath, JSON.stringify(['not', 'an', 'object']), 'utf8');
    const loader = new ConfigLoader();
    await assert.rejects(loader.load(dir), ConfigLoaderError);
  });
});

test('トップレベルがオブジェクトでないYAML設定はエラーになる', async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.yml');
    await fs.writeFile(configPath, '- not\n- an\n- object', 'utf8');
    const loader = new ConfigLoader();
    await assert.rejects(loader.load(dir), ConfigLoaderError);
  });
});

test('不正なYAML構文はエラーになる', async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.yaml');
    await fs.writeFile(configPath, 'model:\n  invalid indentation\nkey: value', 'utf8');
    const loader = new ConfigLoader();
    await assert.rejects(loader.load(dir), ConfigLoaderError);
  });
});

test('複数の設定ファイルがある場合は優先順位に従う', async () => {
  await withTempDir(async (dir) => {
    const jsonPath = path.join(dir, '.river-review.json');
    const yamlPath = path.join(dir, '.river-review.yaml');
    const ymlPath = path.join(dir, '.river-review.yml');

    await fs.writeFile(jsonPath, JSON.stringify({ review: { language: 'en' } }), 'utf8');
    await fs.writeFile(yamlPath, 'review:\n  language: ja', 'utf8');
    await fs.writeFile(ymlPath, 'review:\n  language: ja', 'utf8');

    const loader = new ConfigLoader();
    const result = await loader.load(dir);
    assert.equal(result.path, jsonPath);
    assert.equal(result.config.review.language, 'en');
  });
});

test('スキーマ違反の設定はエラーになる', async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, '.river-review.json');
    await fs.writeFile(configPath, JSON.stringify({ model: { provider: 'unknown' } }), 'utf8');
    const loader = new ConfigLoader();
    await assert.rejects(loader.load(dir), ConfigLoaderError);
  });
});

// Global user tier (#1045 A2): resolution order repo-local > global > built-in.
test('global tier: グローバル設定のみのとき適用され source=global', async () => {
  await withTempDir(async (repoDir) => {
    await withTempDir(async (globalDir) => {
      await fs.writeFile(
        path.join(globalDir, 'config.json'),
        JSON.stringify({ review: { language: 'en' } }),
        'utf8'
      );
      const loader = new ConfigLoader({ globalConfigDir: globalDir });
      const result = await loader.load(repoDir);
      assert.equal(result.source, 'global');
      assert.equal(result.path, path.join(globalDir, 'config.json'));
      assert.equal(result.config.review.language, 'en');
    });
  });
});

test('global tier: repo-local が global を上書きする（repo 優先）', async () => {
  await withTempDir(async (repoDir) => {
    await withTempDir(async (globalDir) => {
      await fs.writeFile(
        path.join(globalDir, 'config.json'),
        JSON.stringify({ review: { language: 'en', additionalInstructions: ['from-global'] } }),
        'utf8'
      );
      await fs.writeFile(
        path.join(repoDir, '.river-review.json'),
        JSON.stringify({ review: { language: 'ja' } }),
        'utf8'
      );
      const loader = new ConfigLoader({ globalConfigDir: globalDir });
      const result = await loader.load(repoDir);
      assert.equal(result.source, 'file');
      assert.equal(result.path, path.join(repoDir, '.river-review.json'));
      // repo wins for language
      assert.equal(result.config.review.language, 'ja');
      // global still contributes keys the repo did not set
      assert.deepEqual(result.config.review.additionalInstructions, ['from-global']);
    });
  });
});

test('global tier: どちらも無いとき従来どおり default', async () => {
  await withTempDir(async (repoDir) => {
    await withTempDir(async (globalDir) => {
      const loader = new ConfigLoader({ globalConfigDir: globalDir });
      const result = await loader.load(repoDir);
      assert.equal(result.source, 'default');
      assert.equal(result.path, null);
    });
  });
});

test('global tier: globalConfigDir=null（無効化）でもクラッシュせず repo-local を解決', async () => {
  await withTempDir(async (repoDir) => {
    await fs.writeFile(
      path.join(repoDir, '.river-review.json'),
      JSON.stringify({ review: { language: 'en' } }),
      'utf8'
    );
    // null disables the global tier (e.g. os.homedir() unavailable).
    const loader = new ConfigLoader({ globalConfigDir: null });
    const result = await loader.load(repoDir);
    assert.equal(result.source, 'file');
    assert.equal(result.config.review.language, 'en');
  });
});

test('global tier: RIVER_REVIEW_DISABLE_GLOBAL_CONFIG opt-out は truthy 綴りを許容', () => {
  const prev = process.env.RIVER_REVIEW_DISABLE_GLOBAL_CONFIG;
  try {
    // Accepted truthy spellings (case-insensitive, trimmed) → tier disabled.
    for (const v of ['1', 'true', 'TRUE', ' true ', '  1 ']) {
      process.env.RIVER_REVIEW_DISABLE_GLOBAL_CONFIG = v;
      assert.equal(defaultGlobalConfigDir(), null, `opt-out should apply for ${JSON.stringify(v)}`);
    }
    // Non-truthy values do NOT disable the tier.
    for (const v of ['0', 'false', 'no', '']) {
      process.env.RIVER_REVIEW_DISABLE_GLOBAL_CONFIG = v;
      const resolved = defaultGlobalConfigDir();
      assert.ok(
        resolved === null || resolved.endsWith('.river-review'),
        `non-opt-out value ${JSON.stringify(v)} must not force-disable`
      );
    }
    delete process.env.RIVER_REVIEW_DISABLE_GLOBAL_CONFIG;
    const resolved = defaultGlobalConfigDir();
    assert.ok(resolved === null || resolved.endsWith('.river-review'));
  } finally {
    if (prev === undefined) delete process.env.RIVER_REVIEW_DISABLE_GLOBAL_CONFIG;
    else process.env.RIVER_REVIEW_DISABLE_GLOBAL_CONFIG = prev;
  }
});
