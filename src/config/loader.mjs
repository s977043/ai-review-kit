import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { ConfigSchema, riverReviewerConfigSchema } from './schema.mjs';
import { defaultConfig, defaultSkillConfig } from './default.mjs';

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

/**
 * Render a ZodError as `path: message; path: message`.
 *
 * The issue list lives on `error.issues`. The former `error.errors` alias was
 * removed in zod 4, so reading it yielded `undefined` and the `.map()` threw a
 * TypeError — which the surrounding catch converted into the generic
 * 「設定ファイルの読み込みに失敗しました」, hiding the very validation detail this
 * message exists to show (#1689 review W1b).
 *
 * @param {import('zod').ZodError} error
 * @returns {string}
 */
function formatZodIssues(error) {
  const issues = error?.issues ?? [];
  if (!Array.isArray(issues) || issues.length === 0) return String(error?.message ?? 'unknown');
  return issues.map((issue) => `${(issue.path ?? []).join('.')}: ${issue.message}`).join('; ');
}

export class ConfigLoaderError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ConfigLoaderError';
    if (options.path) this.path = options.path;
  }
}

/**
 * Resolve the default global config directory (~/.river-review). Returns null
 * (disabling the global tier) when:
 * - `RIVER_REVIEW_DISABLE_GLOBAL_CONFIG=1` is set — an explicit opt-out for CI
 *   and shared hosts where a stray `~/.river-review/config.*` (or a writable
 *   home) must not silently alter review behavior (trust-boundary guard), or
 * - the home directory cannot be determined (e.g. minimal containers where
 *   os.homedir() throws or yields an empty string).
 */
export function defaultGlobalConfigDir() {
  // Trust-boundary opt-out: accept common truthy spellings (1 / true, any case,
  // surrounding whitespace) so the guard fails safe toward disabling.
  const optOut = String(process.env.RIVER_REVIEW_DISABLE_GLOBAL_CONFIG ?? '')
    .trim()
    .toLowerCase();
  if (optOut === '1' || optOut === 'true') return null;
  try {
    const home = os.homedir();
    return home ? path.join(home, '.river-review') : null;
  } catch {
    return null;
  }
}

export class ConfigLoader {
  constructor({
    baseConfig = defaultConfig,
    fileNames = ['.river-review.json', '.river-review.yaml', '.river-review.yml'],
    // Global user tier (#1045 A2): merged UNDER the repository-local config so a
    // repo-local file always wins; the global file supplies a user-wide base.
    // Injectable so tests can point it at a temp dir. os.homedir() can throw or
    // return falsy in minimal containers — fall back to null (tier disabled).
    globalConfigDir = defaultGlobalConfigDir(),
    globalFileNames = ['config.json', 'config.yaml', 'config.yml'],
    fsImpl = fs,
  } = {}) {
    this.baseConfig = baseConfig;
    this.fileNames = Array.isArray(fileNames) ? [...fileNames] : [fileNames];
    this.globalConfigDir = globalConfigDir;
    this.globalFileNames = Array.isArray(globalFileNames)
      ? [...globalFileNames]
      : [globalFileNames];
    this.fs = fsImpl;
  }

  async findConfigPath(repoRoot, fileNames = this.fileNames) {
    // Guard: a null/undefined root (e.g. a disabled global tier) has no config.
    if (!repoRoot) return null;
    for (const candidate of fileNames) {
      const fullPath = path.join(repoRoot, candidate);
      try {
        await this.fs.access(fullPath);
        return fullPath;
      } catch (err) {
        if (err?.code !== 'ENOENT') {
          throw new ConfigLoaderError('設定ファイルの存在確認に失敗しました', {
            cause: err,
            path: fullPath,
          });
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

  /**
   * Read, parse, and validate a single config file. Returns the validated
   * input object (and whether it used the new "skill" schema). Throws
   * ConfigLoaderError on read / parse / validation failure.
   *
   * @param {string} configPath
   * @returns {Promise<{ parsedInput: object, isNewSchema: boolean }>}
   */
  async readConfigFile(configPath) {
    try {
      const raw = await this.fs.readFile(configPath, 'utf8');
      const parsed = this.parseConfig(raw, configPath);

      // Determine schema based on content
      const isNewSchema = 'skills' in parsed || 'version' in parsed;

      if (isNewSchema) {
        const validated = ConfigSchema.safeParse(parsed);
        if (!validated.success) {
          throw new ConfigLoaderError(
            `設定ファイルの形式が正しくありません (Skill Schema): ${formatZodIssues(validated.error)}`,
            { path: configPath }
          );
        }
        const parsedInput = validated.data;

        const knownKeys = new Set(['version', 'model', 'review', 'exclude', 'skills']);
        const unknownKeys = Object.keys(parsedInput).filter((key) => !knownKeys.has(key));
        if (unknownKeys.length) {
          const message = `Unknown config keys ignored: ${unknownKeys.join(', ')}`;
          if (process.env.RIVER_CONFIG_STRICT === '1') {
            throw new ConfigLoaderError(message, { path: configPath });
          }
          // eslint-disable-next-line no-console
          console.warn(message);
        }
        return { parsedInput, isNewSchema: true };
      }

      // Fallback to old schema
      const validated = riverReviewerConfigSchema.safeParse(parsed);
      if (!validated.success) {
        throw new ConfigLoaderError(
          `設定ファイルの形式が正しくありません (Legacy Schema): ${formatZodIssues(validated.error)}`,
          { path: configPath }
        );
      }
      return { parsedInput: validated.data, isNewSchema: false };
    } catch (err) {
      if (err instanceof ConfigLoaderError) throw err;
      if (err instanceof SyntaxError || err?.name === 'YAMLException') {
        throw new ConfigLoaderError('設定ファイルのパースに失敗しました', {
          cause: err,
          path: configPath,
        });
      }
      throw new ConfigLoaderError('設定ファイルの読み込みに失敗しました', {
        cause: err,
        path: configPath,
      });
    }
  }

  async load(repoRoot = process.cwd()) {
    const repoPath = await this.findConfigPath(repoRoot, this.fileNames);
    const globalPath = await this.findConfigPath(this.globalConfigDir, this.globalFileNames);

    // Resolution order (top wins): repository-local > global user > built-in.
    const globalFile = globalPath ? await this.readConfigFile(globalPath) : null;
    const repoFile = repoPath ? await this.readConfigFile(repoPath) : null;

    if (!globalFile && !repoFile) {
      return { config: this.baseConfig, path: null, source: 'default' };
    }

    try {
      const usesNewSchema = (globalFile?.isNewSchema ?? false) || (repoFile?.isNewSchema ?? false);
      const baseToUse = usesNewSchema ? defaultSkillConfig : this.baseConfig;

      // Layer global UNDER repo-local so a repo-local file always wins.
      let merged = baseToUse;
      if (globalFile) merged = mergeConfig(merged, globalFile.parsedInput);
      if (repoFile) merged = mergeConfig(merged, repoFile.parsedInput);

      // `path` / `source` reflect the highest-precedence file that contributed.
      return {
        config: merged,
        path: repoPath ?? globalPath,
        source: repoFile ? 'file' : 'global',
      };
    } catch (err) {
      throw new ConfigMergeError('設定のマージに失敗しました', { cause: err });
    }
  }
}

// Export loadConfig helper for SkillDispatcher (always uses default loader for now)
export async function loadConfig(repoRoot) {
  const loader = new ConfigLoader(); // Uses legacy default, but load() will switch base if new schema detected
  const { config } = await loader.load(repoRoot);
  return config;
}
