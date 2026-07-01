import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  parseFrontMatter,
  loadSchema,
  createSkillValidator,
  defaultPaths,
} from '../../runners/core/skill-loader.mjs';
import { loadSkillsCached as loadSkills } from '../../runners/core/skill-cache.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const AGENT_SKILL_FILENAME = 'SKILL.md';
const DEFAULT_SEARCH_DIRS = ['.agents/skills', '.github/skills', '.claude/skills'];
const ASSET_DIRS = ['references', 'scripts', 'prompt'];
const KNOWN_RR_FIELDS = new Set([
  'id',
  'name',
  'description',
  'category',
  'phase',
  'applyTo',
  'files',
  'path_patterns',
  'trigger',
  'tags',
  'severity',
  'inputContext',
  'outputKind',
  'modelHint',
  'dependencies',
  'priority',
  'version',
  'prompt',
  'eval',
  'fixturesDir',
  'goldenDir',
  'instruction',
  'metadata',
]);

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function sanitizeSkillId(id) {
  if (typeof id !== 'string' || !id) return 'unnamed-skill';
  if (SAFE_ID_RE.test(id)) return id;
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, '').replace(/^[._-]+/, '');
  return cleaned || 'unnamed-skill';
}

export class AgentSkillBridgeError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = 'AgentSkillBridgeError';
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function dirExists(dirPath, { followSymlinks = true } = {}) {
  try {
    const stat = followSymlinks ? await fs.stat(dirPath) : await fs.lstat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

const MAX_SCAN_DEPTH = 10;

async function listSkillPackages(dirPath, depth = 0) {
  if (depth > MAX_SCAN_DEPTH) return [];
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const groups = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) return [];
      const entryPath = path.join(dirPath, entry.name);
      const skillPath = path.join(entryPath, AGENT_SKILL_FILENAME);
      try {
        const stat = await fs.stat(skillPath);
        if (stat.isFile()) return [skillPath];
      } catch {
        /* not a skill package – check nested */
      }
      return listSkillPackages(entryPath, depth + 1);
    })
  );
  return groups.flat().sort();
}

export async function discoverAgentSkillPaths(projectRoot, fromPath) {
  if (fromPath) {
    const resolved = path.resolve(fromPath);
    if (!(await dirExists(resolved))) return [];
    // fromPath might itself contain SKILL.md packages
    return listSkillPackages(resolved);
  }

  const paths = [];
  for (const rel of DEFAULT_SEARCH_DIRS) {
    const dir = path.join(projectRoot, rel);
    if (await dirExists(dir)) {
      const found = await listSkillPackages(dir);
      paths.push(...found);
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Import – parse & convert
// ---------------------------------------------------------------------------

async function listAssets(dirPath) {
  const assets = {};
  for (const name of ASSET_DIRS) {
    const assetPath = path.join(dirPath, name);
    if (await dirExists(assetPath)) {
      assets[name] = assetPath;
    }
  }
  return assets;
}

export async function parseAgentSkill(skillMdPath) {
  const raw = await fs.readFile(skillMdPath, 'utf8');
  const { metadata, body } = parseFrontMatter(raw, { filePath: skillMdPath });
  const dirPath = path.dirname(skillMdPath);
  const assets = await listAssets(dirPath);
  return { metadata, body, dirPath, assets };
}

export function generateAgentSkillId(dirName, existingIds) {
  const base = `as-${sanitizeSkillId(dirName)}`;
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function extractExtraMetadata(metadata) {
  const extra = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!KNOWN_RR_FIELDS.has(key)) {
      extra[key] = value;
    }
  }
  return Object.keys(extra).length ? extra : undefined;
}

export function convertAgentSkillToRR(parsed, existingIds = new Set(), projectRoot) {
  const { metadata: rawMeta, body, dirPath } = parsed;
  const dirName = path.basename(dirPath);

  const meta = { ...rawMeta };

  // ID generation / sanitization
  if (!meta.id) {
    meta.id = generateAgentSkillId(dirName, existingIds);
  } else {
    meta.id = sanitizeSkillId(meta.id);
  }

  // Category default
  if (!meta.category) {
    meta.category = 'core';
  }

  // Phase default (derived from category)
  if (!meta.phase) {
    if (meta.category === 'core') {
      meta.phase = ['upstream', 'midstream', 'downstream'];
    } else {
      meta.phase = meta.category;
    }
  }

  // applyTo default
  if (!meta.applyTo && !meta.files && !meta.path_patterns && !meta.trigger) {
    meta.applyTo = ['**/*'];
  }

  // Collect extra metadata (non-RR fields) and inject source/originPath
  const extra = extractExtraMetadata(meta);
  meta.metadata = {
    ...(meta.metadata ?? {}),
    ...(extra ?? {}),
    source: 'agent',
    originPath: projectRoot ? path.relative(projectRoot, dirPath) : dirPath,
  };

  // Remove extra fields from top level (they're now in metadata)
  if (extra) {
    for (const key of Object.keys(extra)) {
      delete meta[key];
    }
  }

  return {
    metadata: meta,
    body,
    path: path.join(dirPath, AGENT_SKILL_FILENAME),
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

async function loadLooseSchema() {
  const schemaPath = path.join(repoRoot, 'schemas', 'agent-skill-loose.schema.json');
  return loadSchema(schemaPath);
}

function createLooseValidator(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

function validateMeta(metadata, validate) {
  const copy = JSON.parse(JSON.stringify(metadata));
  const ok = validate(copy);
  if (!ok) {
    const details = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    return { ok: false, error: details, ajvErrors: validate.errors };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Import (batch)
// ---------------------------------------------------------------------------

export async function importAgentSkills(projectRoot, options = {}) {
  const { fromPath, strict = true, dryRun = false, outputDir } = options;
  const skillPaths = await discoverAgentSkillPaths(projectRoot, fromPath);

  const imported = [];
  const errors = [];
  const warnings = [];

  if (!skillPaths.length) {
    warnings.push('No Agent Skills (SKILL.md) found.');
    return { imported, errors, warnings };
  }

  // Load validators
  const strictSchema = await loadSchema(defaultPaths.schemaPath);
  const strictValidator = createSkillValidator(strictSchema);
  const looseSchema = await loadLooseSchema();
  const looseValidator = createLooseValidator(looseSchema);

  const existingIds = new Set();

  for (const skillPath of skillPaths) {
    try {
      const parsed = await parseAgentSkill(skillPath);

      // Pre-validation (loose): check minimal fields before conversion
      const preCheck = validateMeta(parsed.metadata, looseValidator);
      if (!preCheck.ok) {
        errors.push({ path: skillPath, message: `Loose validation failed: ${preCheck.error}` });
        continue;
      }

      const converted = convertAgentSkillToRR(parsed, existingIds, projectRoot);

      // Detect duplicate explicit ids within the same import batch
      if (existingIds.has(converted.metadata.id)) {
        errors.push({
          path: skillPath,
          message: `Duplicate skill id "${converted.metadata.id}" – already imported in this batch`,
        });
        continue;
      }
      existingIds.add(converted.metadata.id);

      if (strict) {
        // Strict: validate the fully converted metadata against RR schema
        const result = validateMeta(converted.metadata, strictValidator);
        if (!result.ok) {
          errors.push({ path: skillPath, message: `Strict validation failed: ${result.error}` });
          continue;
        }
      } else {
        // Loose: warn about fields that were auto-filled
        const autoFilled = [];
        if (!parsed.metadata.id) autoFilled.push('id');
        if (!parsed.metadata.category) autoFilled.push('category');
        if (!parsed.metadata.phase) autoFilled.push('phase');
        if (!parsed.metadata.applyTo && !parsed.metadata.files && !parsed.metadata.path_patterns) {
          autoFilled.push('applyTo');
        }
        if (autoFilled.length) {
          warnings.push(
            `${path.relative(projectRoot, skillPath)}: auto-filled [${autoFilled.join(', ')}]`
          );
        }
      }

      if (!dryRun) {
        const dest = outputDir ?? path.join(projectRoot, 'skills', 'agent-skills');
        await writeImportedSkill(converted, dest);
      }

      imported.push(converted);
    } catch (err) {
      errors.push({
        path: skillPath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { imported, errors, warnings };
}

function assertSafePath(base, child, label) {
  const resolved = path.resolve(base, child);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    throw new AgentSkillBridgeError(`${label} "${child}" would escape output directory`);
  }
  return resolved;
}

async function writeImportedSkill(skill, destDir) {
  const dirName = sanitizeSkillId(skill.metadata.id);
  const skillDir = assertSafePath(destDir, dirName, 'Skill id');
  await fs.mkdir(skillDir, { recursive: true });

  // Write as RR-compatible SKILL.md (with full RR metadata in frontmatter)
  const frontmatter = { ...skill.metadata };
  const content = `---\n${yaml.dump(frontmatter, { lineWidth: 120, quotingType: "'", noCompatMode: true }).trimEnd()}\n---\n\n${skill.body}\n`;
  await fs.writeFile(path.join(skillDir, AGENT_SKILL_FILENAME), content, 'utf8');
}

// ---------------------------------------------------------------------------
// Export (RR → Agent Skills)
// ---------------------------------------------------------------------------

const RR_SPECIFIC_FIELDS = new Set([
  'id',
  'category',
  'phase',
  'applyTo',
  'files',
  'path_patterns',
  'severity',
  'inputContext',
  'outputKind',
  'modelHint',
  'dependencies',
  'priority',
  'trigger',
  'prompt',
  'eval',
  'fixturesDir',
  'goldenDir',
]);

export function serializeToSkillMd(skill) {
  const meta = skill.metadata;
  const fm = {};

  // Always include name and description
  fm.name = meta.name;
  fm.description = meta.description;

  // Preserve tags at top level if present
  if (meta.tags?.length) {
    fm.tags = meta.tags;
  }

  // Preserve version if present
  if (meta.version) {
    fm.version = meta.version;
  }

  // Nest RR-specific fields under metadata.rr
  const rrMeta = {};
  for (const field of RR_SPECIFIC_FIELDS) {
    if (meta[field] !== undefined) {
      rrMeta[field] = meta[field];
    }
  }
  if (Object.keys(rrMeta).length) {
    fm.metadata = { ...(fm.metadata ?? {}), rr: rrMeta };
  }

  const yamlStr = yaml.dump(fm, { lineWidth: 120, quotingType: "'", noCompatMode: true }).trimEnd();
  const body = skill.body || '';
  return `---\n${yamlStr}\n---\n\n${body}\n`;
}

export async function exportSkillToAgentFormat(skill, outputDir, options = {}) {
  const { includeAssets = false } = options;
  const rawDirName = skill.metadata.id || skill.metadata.name;
  if (!rawDirName) {
    throw new AgentSkillBridgeError('Skill has no id or name for directory creation');
  }
  const dirName = sanitizeSkillId(rawDirName);
  const skillDir = assertSafePath(outputDir, dirName, 'Skill id');
  await fs.mkdir(skillDir, { recursive: true });

  const content = serializeToSkillMd(skill);
  const skillMdPath = path.join(skillDir, AGENT_SKILL_FILENAME);
  await fs.writeFile(skillMdPath, content, 'utf8');

  if (includeAssets && skill.path) {
    const sourceDir = path.dirname(skill.path);
    for (const assetDir of ASSET_DIRS) {
      const src = path.join(sourceDir, assetDir);
      if (await dirExists(src, { followSymlinks: false })) {
        const dest = assertSafePath(skillDir, assetDir, 'Asset directory');
        await fs.cp(src, dest, { recursive: true, dereference: false });
      }
    }
  }

  return { path: skillMdPath };
}

export async function exportAllSkills(projectRoot, options = {}) {
  const { outputDir, includeAssets = false } = options;
  const dest = outputDir ?? path.join(projectRoot, '.agents', 'skills');
  const skills = await loadSkills({
    skillsDir: path.join(projectRoot, 'skills'),
    excludedTags: [],
  });

  const exported = [];
  const errors = [];

  for (const skill of skills) {
    try {
      const result = await exportSkillToAgentFormat(skill, dest, { includeAssets });
      exported.push(result.path);
    } catch (err) {
      errors.push({
        id: skill.metadata?.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { exported, errors };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listAllSkills(projectRoot, options = {}) {
  const { source = 'all' } = options;
  const skills = [];
  const seenIds = new Set();

  if (source === 'rr' || source === 'all') {
    const rrSkills = await loadSkills({
      skillsDir: path.join(projectRoot, 'skills'),
      excludedTags: [],
    });
    for (const s of rrSkills) {
      seenIds.add(s.metadata.id);
      skills.push({
        id: s.metadata.id,
        name: s.metadata.name,
        source: 'rr',
        path: path.relative(projectRoot, s.path),
      });
    }
  }

  if (source === 'agent' || source === 'all') {
    const agentPaths = await discoverAgentSkillPaths(projectRoot);
    for (const skillPath of agentPaths) {
      try {
        const parsed = await parseAgentSkill(skillPath);
        const dirName = path.basename(path.dirname(skillPath));
        const id = sanitizeSkillId(parsed.metadata.id || `as-${dirName}`);
        // Skip duplicates already loaded as RR skills (imported skills)
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        skills.push({
          id,
          name: parsed.metadata.name || dirName,
          source: 'agent',
          path: path.relative(projectRoot, skillPath),
        });
      } catch (err) {
        process.stderr.write(
          `⚠️  Skipping unparseable agent skill: ${path.relative(projectRoot, skillPath)}: ${err.message ?? err}\n`
        );
      }
    }
  }

  return { skills };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

export async function runSkillsSubcommand(parsed) {
  const projectRoot = path.resolve(parsed.target || '.');
  const sub = parsed.skillsSubcommand;

  if (sub === 'import') {
    const result = await importAgentSkills(projectRoot, {
      fromPath: parsed.fromPath,
      strict: parsed.validationMode !== 'loose',
      dryRun: parsed.dryRun,
      outputDir: parsed.toPath,
    });

    if (result.warnings.length) {
      for (const w of result.warnings) console.warn(`⚠️  ${w}`);
    }
    if (result.errors.length) {
      for (const e of result.errors) console.error(`❌ ${e.path}: ${e.message}`);
    }
    console.log(
      `Import complete: ${result.imported.length} imported, ${result.errors.length} failed, ${result.warnings.length} warnings.`
    );
    return result.errors.length ? 1 : 0;
  }

  if (sub === 'export') {
    const result = await exportAllSkills(projectRoot, {
      outputDir: parsed.toPath,
      includeAssets: parsed.includeAssets,
    });

    if (result.errors.length) {
      for (const e of result.errors) console.error(`❌ ${e.id}: ${e.message}`);
    }
    console.log(
      `Export complete: ${result.exported.length} exported, ${result.errors.length} failed.`
    );
    return result.errors.length ? 1 : 0;
  }

  if (sub === 'list') {
    const result = await listAllSkills(projectRoot, { source: parsed.listSource || 'all' });

    if (!result.skills.length) {
      console.log('No skills found.');
      return 0;
    }

    // Table header
    const idW = Math.max(4, ...result.skills.map((s) => s.id.length));
    const nameW = Math.max(4, ...result.skills.map((s) => s.name.length));
    const srcW = 6;

    console.log(`${'ID'.padEnd(idW)}  ${'NAME'.padEnd(nameW)}  ${'SOURCE'.padEnd(srcW)}  PATH`);
    console.log(`${'-'.repeat(idW)}  ${'-'.repeat(nameW)}  ${'-'.repeat(srcW)}  ----`);
    for (const s of result.skills) {
      console.log(
        `${s.id.padEnd(idW)}  ${s.name.padEnd(nameW)}  ${s.source.padEnd(srcW)}  ${s.path}`
      );
    }
    console.log(`\nTotal: ${result.skills.length} skills`);
    return 0;
  }

  console.error(`Unknown skills subcommand: ${sub}`);
  return 1;
}
