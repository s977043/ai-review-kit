import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');

async function readJson(filePath) {
  const raw = await fs.readFile(path.join(ROOT, filePath), 'utf8');
  return JSON.parse(raw);
}

async function pathExists(relPath) {
  try {
    await fs.access(path.join(ROOT, relPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a plugin-manifest path reference (e.g. "./.claude/commands/pr.md")
 * to a repo-relative path.
 */
function normalizeRef(ref) {
  return ref.replace(/^\.\//, '');
}

/**
 * Validate the Claude Code + Codex plugin manifests and the marketplace
 * manifest against the repository:
 *  - every component path referenced by .claude-plugin/plugin.json exists
 *  - .claude-plugin and .codex-plugin manifest versions match package.json
 *  - marketplace plugins[].name matches the plugin manifest name
 *  - the Codex manifest's skills path exists
 *
 * Returns array of error strings (empty = pass).
 */
export async function validatePluginManifest() {
  const errors = [];

  const pkg = await readJson('package.json');
  const ccManifest = await readJson('.claude-plugin/plugin.json');
  const marketplace = await readJson('.claude-plugin/marketplace.json');

  // --- Claude Code manifest: version sync ---
  if (ccManifest.version !== pkg.version) {
    errors.push(
      `.claude-plugin/plugin.json: version "${ccManifest.version}" !== package.json "${pkg.version}"`
    );
  }

  // --- Claude Code manifest: component paths exist ---
  const refs = [];
  for (const cmd of ccManifest.commands || []) refs.push(cmd);
  if (typeof ccManifest.agents === 'string') refs.push(ccManifest.agents);
  else for (const a of ccManifest.agents || []) refs.push(a);
  if (typeof ccManifest.skills === 'string') refs.push(ccManifest.skills);
  if (typeof ccManifest.hooks === 'string') refs.push(ccManifest.hooks);

  for (const ref of refs) {
    const rel = normalizeRef(ref);
    if (!(await pathExists(rel))) {
      errors.push(`.claude-plugin/plugin.json: referenced path does not exist: ${ref}`);
    }
  }

  // --- Claude Code manifest: composerIcon asset exists ---
  // composerIcon is resolved relative to the manifest's directory (.claude-plugin/)
  if (typeof ccManifest.composerIcon === 'string') {
    const assetPath = path.join('.claude-plugin', normalizeRef(ccManifest.composerIcon));
    if (!(await pathExists(assetPath))) {
      errors.push(
        `.claude-plugin/plugin.json: composerIcon asset does not exist: ${ccManifest.composerIcon}`
      );
    }
  }

  // --- Hooks: parse hooks.json and verify each command's script target exists ---
  if (typeof ccManifest.hooks === 'string') {
    const hooksRel = normalizeRef(ccManifest.hooks);
    if (await pathExists(hooksRel)) {
      let hooksDef;
      try {
        hooksDef = await readJson(hooksRel);
      } catch {
        errors.push(`${ccManifest.hooks}: not valid JSON`);
      }
      if (hooksDef && (!hooksDef.hooks || typeof hooksDef.hooks !== 'object')) {
        errors.push(`${ccManifest.hooks}: "hooks" field is missing or not an object`);
      }
      if (hooksDef && hooksDef.hooks && typeof hooksDef.hooks === 'object') {
        const commands = [];
        for (const matchers of Object.values(hooksDef.hooks)) {
          if (!Array.isArray(matchers)) continue;
          for (const matcher of matchers) {
            if (!matcher || !Array.isArray(matcher.hooks)) continue;
            for (const hook of matcher.hooks) {
              if (hook && hook.type === 'command' && typeof hook.command === 'string') {
                commands.push(hook.command);
              }
            }
          }
        }
        // Extract ${CLAUDE_PLUGIN_ROOT}/<path> targets and verify they exist.
        for (const command of commands) {
          const matches = command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"']+)/g) || [];
          for (const m of matches) {
            const scriptRel = m.replace(/\$\{CLAUDE_PLUGIN_ROOT\}\//, '');
            if (!(await pathExists(scriptRel))) {
              errors.push(`${ccManifest.hooks}: hook command target does not exist: ${scriptRel}`);
            }
          }
        }
      }
    }
  }

  // --- Marketplace: plugins[].name matches manifest name ---
  const entry = (marketplace.plugins || []).find((p) => p.name === ccManifest.name);
  if (!entry) {
    errors.push(
      `.claude-plugin/marketplace.json: no plugins[] entry with name "${ccManifest.name}"`
    );
  }

  // --- Codex manifest (required: official distribution ships Codex too) ---
  if (!(await pathExists('.codex-plugin/plugin.json'))) {
    errors.push('.codex-plugin/plugin.json: missing (required for Codex plugin distribution)');
  } else {
    const codexManifest = await readJson('.codex-plugin/plugin.json');
    if (codexManifest.version !== pkg.version) {
      errors.push(
        `.codex-plugin/plugin.json: version "${codexManifest.version}" !== package.json "${pkg.version}"`
      );
    }
    if (codexManifest.name !== ccManifest.name) {
      errors.push(
        `.codex-plugin/plugin.json: name "${codexManifest.name}" !== .claude-plugin name "${ccManifest.name}"`
      );
    }
    if (typeof codexManifest.skills !== 'string') {
      errors.push('.codex-plugin/plugin.json: "skills" path is missing or not a string');
    } else {
      const rel = normalizeRef(codexManifest.skills);
      if (!(await pathExists(rel))) {
        errors.push(
          `.codex-plugin/plugin.json: skills path does not exist: ${codexManifest.skills}`
        );
      }
    }
    // The Codex plugin UI requires an interface block with these fields.
    const iface = codexManifest.interface;
    if (!iface || typeof iface !== 'object') {
      errors.push('.codex-plugin/plugin.json: "interface" block is missing');
    } else {
      const requiredInterfaceFields = [
        'displayName',
        'shortDescription',
        'longDescription',
        'category',
        'capabilities',
      ];
      for (const field of requiredInterfaceFields) {
        if (iface[field] === undefined || iface[field] === null || iface[field] === '') {
          errors.push(`.codex-plugin/plugin.json: interface.${field} is missing or empty`);
        }
      }
      if (iface.capabilities !== undefined && !Array.isArray(iface.capabilities)) {
        errors.push('.codex-plugin/plugin.json: interface.capabilities must be an array');
      }
      // --- Codex manifest: composerIcon asset exists ---
      // composerIcon is resolved relative to the manifest's directory (.codex-plugin/)
      if (typeof iface.composerIcon === 'string') {
        const assetPath = path.join('.codex-plugin', normalizeRef(iface.composerIcon));
        if (!(await pathExists(assetPath))) {
          errors.push(
            `.codex-plugin/plugin.json: interface.composerIcon asset does not exist: ${iface.composerIcon}`
          );
        }
      }
    }

    // --- Cross-plugin field parity (synced fields must match package.json) ---
    // repository is excluded: package.json uses {type, url} object; plugins use plain string URL.
    const SYNCED_FIELDS = ['keywords', 'homepage', 'author', 'license'];
    for (const field of SYNCED_FIELDS) {
      if (pkg[field] === undefined) continue;
      const ccVal = JSON.stringify(ccManifest[field]);
      const codexVal = JSON.stringify(codexManifest[field]);
      const pkgVal = JSON.stringify(pkg[field]);
      if (ccVal !== pkgVal) {
        errors.push(
          `.claude-plugin/plugin.json: "${field}" drifted from package.json — run \`npm run plugin:sync\``
        );
      }
      if (codexVal !== pkgVal) {
        errors.push(
          `.codex-plugin/plugin.json: "${field}" drifted from package.json — run \`npm run plugin:sync\``
        );
      }
    }
  }

  return errors;
}

// CLI entry point
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('validate-plugin-manifest.mjs') ||
    process.argv[1].endsWith('validate-plugin-manifest'));

if (isDirectRun) {
  validatePluginManifest()
    .then((errors) => {
      if (errors.length === 0) {
        console.log('Plugin manifest: OK');
        return 0;
      }
      console.error(`Plugin manifest: ${errors.length} error(s) found`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      return 1;
    })
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((err) => {
      console.error(`Plugin manifest check failed: ${err.message}`);
      process.exitCode = 1;
    });
}
