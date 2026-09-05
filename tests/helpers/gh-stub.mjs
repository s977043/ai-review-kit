// A `gh` stand-in for tests of scripts/pr-unstall.sh and scripts/merge-chain.sh.
//
// The stub answers each `gh` invocation from a routing table: the first route
// whose regex matches the joined argv (with any `--jq <filter>` removed) wins,
// its fixture file is printed, and the `--jq` filter, if any, is applied with
// the real `jq`. Every call is appended to `<dir>/calls.log`, so a test can
// assert that a dry-run never reached a write endpoint.
//
// Routes are `{ match: RegExp | string, file?: string, body?: string, exit?: number }`.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTempDir } from './temp-dir.mjs';
import { spawnSyncGuarded } from './spawn-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'scripts-gh');

export function fixture(name) {
  return join(FIXTURE_DIR, name);
}

const STUB_SOURCE = `#!/usr/bin/env bash
set -u
dir="\${GH_STUB:?}"
printf '%s\\n' "$*" >> "\${dir}/calls.log"
filter=''
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --jq) filter="$2"; shift ;;
    *) args+=("$1") ;;
  esac
  shift
done
joined="\${args[*]}"
n=0
while IFS= read -r route; do
  n=$((n + 1))
  regex="\${route%%	*}"
  rest="\${route#*	}"
  file="\${rest%%	*}"
  code="\${rest#*	}"
  if [[ "\${joined}" =~ \${regex} ]]; then
    if [ -n "\${filter}" ]; then
      jq -r "\${filter}" < "\${file}"
    else
      cat "\${file}"
    fi
    exit "\${code}"
  fi
done < "\${dir}/routes"
echo "gh-stub: no route for: \${joined}" >&2
exit 99
`;

/**
 * Create a stub directory with a `gh` executable and a routing table.
 * @param {Array<{match: RegExp|string, file?: string, body?: string, exit?: number}>} routes
 * @returns {{ dir: string, calls: () => string[] }}
 */
export function createGhStub(routes) {
  const dir = createTempDir({ prefix: 'gh-stub-' });
  const bodies = join(dir, 'bodies');
  mkdirSync(bodies);
  const lines = routes.map((route, i) => {
    const regex = route.match instanceof RegExp ? route.match.source : route.match;
    let file = route.file;
    if (route.body !== undefined) {
      file = join(bodies, `route-${i}`);
      writeFileSync(file, route.body);
    }
    if (!file) throw new Error(`route ${i} needs file or body`);
    return `${regex}\t${file}\t${route.exit ?? 0}`;
  });
  writeFileSync(join(dir, 'routes'), `${lines.join('\n')}\n`);
  writeFileSync(join(dir, 'calls.log'), '');
  writeFileSync(join(dir, 'gh'), STUB_SOURCE);
  chmodSync(join(dir, 'gh'), 0o755);
  return {
    dir,
    calls: () =>
      readFileSync(join(dir, 'calls.log'), 'utf8')
        .split('\n')
        .filter((line) => line !== ''),
  };
}

/**
 * Run a repo script through bash with the stub `gh` first on PATH.
 * @param {string} script path relative to the repo root, e.g. 'scripts/pr-unstall.sh'
 * @param {string[]} args
 * @param {{ dir: string }} stub
 * @param {Record<string,string>} [env]
 */
export function runScriptWithStub(script, args, stub, env = {}) {
  const result = spawnSyncGuarded('bash', [join(REPO_ROOT, script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stub.dir}:${process.env.PATH}`,
      GH_STUB: stub.dir,
      REPO: 'owner/repo',
      INTERVAL_SECONDS: '0',
      TIMEOUT_SECONDS: '5',
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Source a script and call one of its judging functions with string arguments,
 * without any `gh` on the path.
 */
export function callFunction(script, fn, args) {
  const quoted = args.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ');
  const result = spawnSyncGuarded(
    'bash',
    ['-c', `source '${join(REPO_ROOT, script)}' && ${fn} ${quoted}`],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin' },
    }
  );
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
