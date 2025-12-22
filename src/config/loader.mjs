import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
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
    super(message, options);
    this.name = 'ConfigLoaderError';
    if (options.path) this.path = options.path;
  }
}

export class ConfigLoader {
  constructor({
    baseConfig = defaultConfig,
    fileNames = ['.river-reviewer.json', '.river-reviewer.yaml', '.river-reviewer.yml'],
    fsImpl = fs,
  } = {}) {
    this.baseConfig = baseConfig;
    this.fileNames = Array.isArray(fileNames) ? [...fileNames] : [fileNames];
    this.fs = fsImpl;
  }

  async findConfigPath(repoRoot) {
    for (const candidate of this.fileNames) {
      const fullPath = path.join(repoRoot, candidate);
      try {
        await this.fs.access(fullPath);
        return fullPath;
      } catch (err) {
        if (err?.code !== 'ENOENT') {
          throw new ConfigLoaderError('設定ファイルの存在確認に失敗しました', { cause: err, path: fullPath });
        }
      }
    }
    return null;
  }

  parseConfig(raw, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let parsed;
    if (ext === '.yaml' || ext === '.yml') {
      parsed = yaml.load(raw);
    } else {
      parsed = JSON.parse(raw);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ConfigLoaderError('設定ファイルのトップレベルはオブジェクトである必要があります', {
        path: filePath,
      });
    }
    return parsed;
  }

  async load(repoRoot = process.cwd()) {
    const configPath = await this.findConfigPath(repoRoot);
    if (!configPath) {
      return { config: this.baseConfig, path: null, source: 'default' };
    }

    let parsedInput = {};

    try {
      const raw = await this.fs.readFile(configPath, 'utf8');
      const parsed = this.parseConfig(raw, configPath);
      const validated = riverReviewerConfigSchema.safeParse(parsed);
      if (!validated.success) {
        const detail = validated.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join('; ');
        throw new ConfigLoaderError(`設定ファイルの形式が正しくありません: ${detail}`, { path: configPath });
      }
      parsedInput = validated.data;
    } catch (err) {
      if (err instanceof ConfigLoaderError) throw err;
      if (err instanceof SyntaxError || err?.name === 'YAMLException') {
        throw new ConfigLoaderError('設定ファイルのパースに失敗しました', { cause: err, path: configPath });
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
