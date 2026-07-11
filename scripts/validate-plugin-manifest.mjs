import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { isDirectRun } from './lib/is-direct-run.mjs';

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

async function fileExists(relPath) {
  try {
    const stat = await fs.stat(path.join(ROOT, relPath));
    return stat.isFile();
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
 * List top-level `*.md` files (not recursing into subdirectories) under a
 * repo-relative directory. Returns basenames (e.g. "pr.md"). Missing dir → [].
 */
async function listMarkdownFiles(dir) {
  try {
    const entries = await fs.readdir(path.join(ROOT, dir), { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Distribution-bundle field allowlist for .codex-plugin/plugin.json (#1250).
 *
 * The external `awesome-codex-plugins` fork carries a bundle copy of this
 * manifest that cannot be reached from this repo, so parity with the fork is
 * enforced indirectly: every field the bundle may carry must be declared here.
 * A field present in the manifest but absent from this allowlist fails
 * `npm run plugin:validate`, forcing the mirror rule in CLAUDE.md
 * ("Plugin bundle mirror") to be applied consciously instead of drifting
 * silently.
 */
export const CODEX_BUNDLE_ALLOWED_FIELDS = [
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'skills',
  'interface',
];

/** Fields awesome-codex-plugins listing requires in the bundle manifest. */
export const CODEX_BUNDLE_REQUIRED_FIELDS = [
  'name',
  'version',
  'description',
  'repository',
  'license',
];

export const CODEX_INTERFACE_ALLOWED_FIELDS = [
  'displayName',
  'shortDescription',
  'longDescription',
  'developerName',
  'category',
  'capabilities',
  'websiteURL',
  'composerIcon',
];

/**
 * Check that the .codex-plugin manifest (the in-repo mirror of the
 * distribution bundle) only carries allowlisted fields and carries every
 * field the external listing requires.
 *
 * Pure function; returns array of error strings (empty = pass).
 */
export function checkBundleFieldAllowlist(codexManifest) {
  const errors = [];

  for (const field of Object.keys(codexManifest)) {
    if (!CODEX_BUNDLE_ALLOWED_FIELDS.includes(field)) {
      errors.push(
        `.codex-plugin/plugin.json: field "${field}" is not in the bundle allowlist — ` +
          `add it to CODEX_BUNDLE_ALLOWED_FIELDS in scripts/validate-plugin-manifest.mjs ` +
          `and mirror it to the distribution bundle in the same PR (#1250)`
      );
    }
  }

  for (const field of CODEX_BUNDLE_REQUIRED_FIELDS) {
    if (
      codexManifest[field] === undefined ||
      codexManifest[field] === null ||
      codexManifest[field] === ''
    ) {
      errors.push(
        `.codex-plugin/plugin.json: required bundle field "${field}" is missing or empty ` +
          `(required by the awesome-codex-plugins listing)`
      );
    }
  }

  const iface = codexManifest.interface;
  if (iface && typeof iface === 'object') {
    for (const field of Object.keys(iface)) {
      if (!CODEX_INTERFACE_ALLOWED_FIELDS.includes(field)) {
        errors.push(
          `.codex-plugin/plugin.json: interface field "${field}" is not in the bundle allowlist — ` +
            `add it to CODEX_INTERFACE_ALLOWED_FIELDS in scripts/validate-plugin-manifest.mjs ` +
            `and mirror it to the distribution bundle in the same PR (#1250)`
        );
      }
    }
  }

  return errors;
}

/**
 * Check parity of fields shared between the two canonical manifests that are
 * NOT owned by `npm run plugin:sync` (which only syncs keywords/homepage/
 * author/license from package.json). These pairs previously drifted silently
 * (#1250: composerIcon updated in the bundle only).
 *
 * Not compared: description/version (intentionally differ or release-please
 * owned), keywords/homepage/author/license (plugin:sync owns them).
 *
 * Pure function; returns array of error strings (empty = pass).
 */
export function checkCrossManifestParity(ccManifest, codexManifest) {
  const errors = [];
  const iface =
    codexManifest.interface && typeof codexManifest.interface === 'object'
      ? codexManifest.interface
      : {};

  const pairs = [
    ['repository', ccManifest.repository, 'repository', codexManifest.repository],
    ['skills', ccManifest.skills, 'skills', codexManifest.skills],
    ['displayName', ccManifest.displayName, 'interface.displayName', iface.displayName],
    ['composerIcon', ccManifest.composerIcon, 'interface.composerIcon', iface.composerIcon],
    ['homepage', ccManifest.homepage, 'interface.websiteURL', iface.websiteURL],
    ['author.name', ccManifest.author?.name, 'interface.developerName', iface.developerName],
  ];

  for (const [ccField, ccVal, codexField, codexVal] of pairs) {
    if (JSON.stringify(ccVal) !== JSON.stringify(codexVal)) {
      errors.push(
        `manifest parity: .claude-plugin "${ccField}" (${JSON.stringify(ccVal)}) !== ` +
          `.codex-plugin "${codexField}" (${JSON.stringify(codexVal)})`
      );
    }
  }

  return errors;
}

/**
 * Reverse-drift check: every distributed command/agent file on disk must be
 * registered in the .claude-plugin manifest. `validatePluginManifest` only
 * checks the forward direction (manifest refs exist), so a newly added
 * `commands/<name>.md` or `agents/<name>.md` that the author forgot to list is
 * silently unshipped. This closes that gap (plugin asset registration
 * checklist: docs/development/plugin-asset-registration-checklist.md).
 *
 * `commandFiles` / `agentFiles` are injected basename lists (e.g. "pr.md") to
 * keep this pure and testable; the caller supplies the real directory listing.
 * `README.md` is never a distributed asset and is excluded.
 *
 * Pure function; returns array of error strings (empty = pass).
 */
export function checkAssetRegistration(ccManifest, { commandFiles = [], agentFiles = [] } = {}) {
  const errors = [];

  // Defensive: ccManifest is normally a $schema-validated manifest object, but
  // this is an exported entry point that may receive arbitrary input. Treat a
  // non-array `commands` / non-string-or-array `agents`, and any non-string
  // array element, as "nothing registered" rather than throwing on .map.
  const manifest = ccManifest && typeof ccManifest === 'object' ? ccManifest : {};
  const toRefSet = (value) => {
    const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    return new Set(list.filter((ref) => typeof ref === 'string').map(normalizeRef));
  };

  const registeredCommands = toRefSet(manifest.commands);
  for (const file of commandFiles) {
    if (file === 'README.md') continue;
    if (!registeredCommands.has(`commands/${file}`)) {
      errors.push(
        `.claude-plugin/plugin.json: commands/${file} exists but is not registered in "commands[]" — ` +
          `add "./commands/${file}" (see docs/development/plugin-asset-registration-checklist.md)`
      );
    }
  }

  const registeredAgents = toRefSet(manifest.agents);
  for (const file of agentFiles) {
    if (file === 'README.md') continue;
    if (!registeredAgents.has(`agents/${file}`)) {
      errors.push(
        `.claude-plugin/plugin.json: agents/${file} exists but is not referenced by "agents" — ` +
          `add "./agents/${file}" (see docs/development/plugin-asset-registration-checklist.md)`
      );
    }
  }

  return errors;
}

/**
 * Extract the distributed-command names listed in CLAUDE.md's
 * `Details: distributed commands (...)` sentence. Returns basenames without the
 * leading slash (e.g. "check", "review-team"). Only the tokens inside the first
 * parenthesized group are read, so the trailing repo-dev command list is
 * ignored. Pure and exported for unit testing.
 *
 * @param {string} claudeMd
 * @returns {string[]}
 */
export function parseClaudeMdDistributedCommands(claudeMd) {
  const line = String(claudeMd ?? '')
    .split('\n')
    .find((l) => l.includes('Details: distributed commands'));
  if (!line) return [];
  const open = line.indexOf('(');
  const close = line.indexOf(')', open);
  if (open < 0 || close < 0) return [];
  const group = line.slice(open + 1, close);
  return [...group.matchAll(/`\/([a-z0-9-]+)`/g)].map((m) => m[1]);
}

/**
 * Parity check between the distributed commands enumerated in CLAUDE.md's prose
 * ("Details: distributed commands (...)") and the commands[] registered in
 * .claude-plugin/plugin.json. The two sets must be identical; a command present
 * in one but not the other means the manual sync (#1451) drifted. Mechanizes
 * the CLAUDE.md ↔ plugin.json command-table sync (#1463 carry-over).
 *
 * Pure function; returns array of error strings (empty = pass).
 *
 * @param {string} claudeMd
 * @param {object} ccManifest
 * @returns {string[]}
 */
export function checkClaudeMdCommandParity(claudeMd, ccManifest) {
  const errors = [];
  const claudeCmds = new Set(parseClaudeMdDistributedCommands(claudeMd));
  if (claudeCmds.size === 0) {
    errors.push(
      'CLAUDE.md: could not find the "Details: distributed commands (...)" list to verify ' +
        'against .claude-plugin/plugin.json commands[]'
    );
    return errors;
  }

  const manifest = ccManifest && typeof ccManifest === 'object' ? ccManifest : {};
  const commandList = Array.isArray(manifest.commands) ? manifest.commands : [];
  const manifestCmds = new Set(
    commandList
      .filter((ref) => typeof ref === 'string')
      .map((ref) =>
        normalizeRef(ref)
          .replace(/^commands\//, '')
          .replace(/\.md$/, '')
      )
  );

  for (const cmd of claudeCmds) {
    if (!manifestCmds.has(cmd)) {
      errors.push(
        `CLAUDE.md lists distributed command "/${cmd}" but .claude-plugin/plugin.json ` +
          'commands[] does not register it (#1451 manual-sync drift)'
      );
    }
  }
  for (const cmd of manifestCmds) {
    if (!claudeCmds.has(cmd)) {
      errors.push(
        `.claude-plugin/plugin.json registers command "${cmd}" but CLAUDE.md's ` +
          '"Details: distributed commands (...)" list omits it (#1451 manual-sync drift)'
      );
    }
  }
  return errors;
}

/**
 * Validate the Claude Code + Codex plugin manifests and the marketplace
 * manifest against the repository:
 *  - every component path referenced by .claude-plugin/plugin.json exists
 *  - every on-disk distributed command/agent file is registered in the
 *    manifest (reverse drift; checkAssetRegistration)
 *  - .claude-plugin and .codex-plugin manifest versions match package.json
 *  - marketplace plugins[].name matches the plugin manifest name
 *  - the Codex manifest's skills path exists
 *  - the Codex manifest carries only allowlisted bundle fields and all
 *    listing-required fields (checkBundleFieldAllowlist)
 *  - shared fields not owned by plugin:sync match across both canonical
 *    manifests (checkCrossManifestParity)
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
    if (!(await fileExists(assetPath))) {
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

  // --- Reverse drift: on-disk command/agent files must be registered ---
  const commandFiles = await listMarkdownFiles('commands');
  const agentFiles = await listMarkdownFiles('agents');
  errors.push(...checkAssetRegistration(ccManifest, { commandFiles, agentFiles }));

  // --- CLAUDE.md prose command list ↔ plugin.json commands[] parity (#1451/#1463) ---
  try {
    const claudeMd = await fs.readFile(path.join(ROOT, 'CLAUDE.md'), 'utf8');
    errors.push(...checkClaudeMdCommandParity(claudeMd, ccManifest));
  } catch (err) {
    errors.push(`CLAUDE.md: not readable for distributed-command parity check (${err.message})`);
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
        if (!(await fileExists(assetPath))) {
          errors.push(
            `.codex-plugin/plugin.json: interface.composerIcon asset does not exist: ${iface.composerIcon}`
          );
        }
      }
    }

    // --- Bundle field allowlist + canonical cross-manifest parity (#1250) ---
    errors.push(...checkBundleFieldAllowlist(codexManifest));
    errors.push(...checkCrossManifestParity(ccManifest, codexManifest));

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
if (isDirectRun(import.meta.url)) {
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
