import fs from 'node:fs/promises';
import path from 'node:path';
import { riverReviewerConfigSchema } from './schema.mjs';
import { defaultConfig } from './default.mjs';

export class ConfigMergeError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ConfigMergeError';
    if (options.cause) this.cause = options.cause;
  }
}

function mergeValue(base, override) {
  if (Array.isArray(override)) return [...override];
  if (override && typeof override === 'object') {
    const baseIsPlainObject = base && typeof base === 'object' && !Array.isArray(base);
    return mergeConfig(baseIsPlainObject ? base : {}, override);
  }
  return override ?? base;
}

export function mergeConfig(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    const baseValue = base?.[key];
    result[key] = mergeValue(baseValue, value);
  }
  return result;
}

export class ConfigLoaderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ConfigLoaderError';
    if (options.cause) this.cause = options.cause;
    if (options.path) this.path = options.path;
  }
}

export class ConfigLoader {
  constructor({ baseConfig = defaultConfig, fileName = '.river-reviewer.json', fsImpl = fs } = {}) {
    this.baseConfig = baseConfig;
    this.fileName = fileName;
    this.fs = fsImpl;
  }

  async load(repoRoot = process.cwd()) {
    const configPath = path.join(repoRoot, this.fileName);
    let parsedInput = {};

    try {
      const raw = await this.fs.readFile(configPath, 'utf8');
      const json = JSON.parse(raw);
      const validated = riverReviewerConfigSchema.safeParse(json);
      if (!validated.success) {
        const detail = validated.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join('; ');
        throw new ConfigLoaderError(`設定ファイルの形式が正しくありません: ${detail}`, { path: configPath });
      }
      parsedInput = validated.data;
    } catch (err) {
      if (err?.code === 'ENOENT') {
        return { config: this.baseConfig, path: null, source: 'default' };
      }
      if (err instanceof ConfigLoaderError) throw err;
      if (err instanceof SyntaxError) {
        throw new ConfigLoaderError('設定ファイルのJSONパースに失敗しました', { cause: err, path: configPath });
      }
      throw new ConfigLoaderError('設定ファイルの読み込みに失敗しました', { cause: err, path: configPath });
    }

    try {
      const merged = mergeConfig(this.baseConfig, parsedInput);
      return { config: merged, path: configPath, source: 'file' };
    } catch (err) {
      // Defensive: keep a dedicated error type for unexpected merge-time failures.
      throw new ConfigMergeError('設定のマージに失敗しました', { cause: err });
    }
  }
}
