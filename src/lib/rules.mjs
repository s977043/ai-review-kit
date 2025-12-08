import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_RULES_PATH = path.join('.river', 'rules.md');

export class ProjectRulesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectRulesError';
  }
}

/**
 * Load project-specific review rules from .river/rules.md (or a custom path).
 * Missing or empty files are treated as "no rules" without error.
 */
export async function loadProjectRules(repoRoot, options = {}) {
  const rulesPath = options.rulesPath
    ? path.resolve(repoRoot, options.rulesPath)
    : path.resolve(repoRoot, DEFAULT_RULES_PATH);

  try {
    const raw = await fs.readFile(rulesPath, 'utf8');
    const trimmed = raw.trim();
    return {
      rulesText: trimmed || null,
      path: rulesPath,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { rulesText: null, path: rulesPath };
    }
    throw new ProjectRulesError(`Failed to read project rules at ${rulesPath}: ${error.message}`);
  }
}
