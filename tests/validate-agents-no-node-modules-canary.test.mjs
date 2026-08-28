// #1982: `scripts/validate-agents.mjs` は draft-07 meta-schema を
// **モジュール解決経由**で取得しなければならない。
//
// その前提が壊れる条件は、通常の checkout では観測できない。
//
//   - `git worktree` で作った作業ツリーには `node_modules/` が無い。
//     Node のモジュール解決は親ディレクトリを遡るので `import Ajv from 'ajv'` は
//     通る一方、`path.join(repoRoot, 'node_modules', ...)` の絶対パスを
//     `fs.readFile` する形は遡らず ENOENT になる。
//   - main checkout には `node_modules/` があるため CI は緑のまま通る。
//     壊れるのは worktree で作業する開発者・エージェントの側だけになる。
//
// 実際に 2026-08-26 のセッションで委託ワーカー 3 人が独立に踏み、うち 1 回は
// 同じ「2 件失敗」という見た目に #1415 の IPC flake が混ざって別原因が埋もれた。
//
// この canary は `node_modules` を持たないパッケージルートを実際に作り、その中で
// `scripts/validate-agents.mjs` を **サブプロセスとして実行**して meta-schema 登録が
// 成功することを振る舞いとして検査する。実装と同じ関数を in-process で呼ぶ形にすると
// 呼び出し側の `repoRoot` が本物の checkout を指してしまい、自己整合で緑になる。
//
// 先例: `tests/action-esm-require-canary.test.mjs`（「GitHub Actions のランナーには
// node_modules が無い」という同型の前提を canary で固定している）。

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * `scripts/validate-agents.mjs` の到達グラフが必要とする npm パッケージ。
 * すべて同じ `node_modules` ルート配下に居ることを sandbox 構築前に確かめる
 * （別ツリーに散っていると sandbox が実行できず、失敗の意味が変わるため）。
 */
const REQUIRED_PACKAGES = ['ajv', 'ajv-formats', 'js-yaml', '@opentelemetry/api'];

/** sandbox へコピーする、スクリプトが読むディレクトリ。 */
const COPIED_DIRS = ['scripts', 'src', 'agents'];

// `.../node_modules/<pkg>/...` の解決結果から `node_modules` ルートを取り出す。
// `<pkg>/package.json` ではなくパッケージ本体を解決するのは、`exports` マップが
// `./package.json` を公開していないパッケージがあるため（実測: `@opentelemetry/api`）。
function nodeModulesRootOf(specifier) {
  const resolved = require.resolve(specifier);
  const marker = `${path.sep}node_modules${path.sep}`;
  const at = resolved.lastIndexOf(marker);
  assert.notEqual(at, -1, `${specifier} did not resolve inside a node_modules tree: ${resolved}`);
  return resolved.slice(0, at + marker.length - 1);
}

let sandboxRoot = null;
/** sandbox 内のパッケージルート。ここに `node_modules` は置かない。 */
let sandboxPkg = null;

before(() => {
  const roots = new Set(REQUIRED_PACKAGES.map(nodeModulesRootOf));
  assert.equal(
    roots.size,
    1,
    `expected one node_modules root for ${REQUIRED_PACKAGES.join(', ')}, got ${[...roots].join(', ')}`
  );
  const nodeModulesRoot = [...roots][0];

  // macOS の tmpdir は symlink（/var → /private/var）。Node はスクリプトパスを
  // realpath 化して import.meta.url に載せるため、先に実体へ寄せておかないと
  // sandbox 内の repoRoot 計算が sandbox の外を指しうる。
  sandboxRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'river-1982-')));
  sandboxPkg = path.join(sandboxRoot, 'pkg');
  fs.mkdirSync(sandboxPkg);

  // `node_modules` は **パッケージルートの親**に置く。これが worktree の状況の
  // 再現にあたる: bare specifier は親を遡って解決できるが、
  // `<repoRoot>/node_modules/...` の絶対パスは存在しない。
  fs.symlinkSync(nodeModulesRoot, path.join(sandboxRoot, 'node_modules'), 'dir');

  for (const dir of COPIED_DIRS) {
    fs.cpSync(path.join(repoRoot, dir), path.join(sandboxPkg, dir), { recursive: true });
  }
});

after(() => {
  if (sandboxRoot !== null) {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

describe('#1982 canary: validate-agents.mjs works in a tree without node_modules', () => {
  it('the sandbox really reproduces the condition (no node_modules at the package root)', () => {
    // この前提が崩れると以下の 2 件は何も守らない。先に固定する。
    assert.equal(
      fs.existsSync(path.join(sandboxPkg, 'node_modules')),
      false,
      'the sandbox package root must not have its own node_modules'
    );
    assert.equal(
      fs.existsSync(path.join(sandboxRoot, 'node_modules', 'ajv', 'package.json')),
      true,
      'the parent node_modules symlink must expose ajv, otherwise the run fails for the wrong reason'
    );
  });

  it('the script exits 0 and registers the https draft-07 meta-schema', () => {
    const run = spawnSync(
      process.execPath,
      [path.join(sandboxPkg, 'scripts', 'validate-agents.mjs')],
      { cwd: sandboxRoot, encoding: 'utf8' }
    );

    const rendered = `--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`;

    // meta-schema を取れないと Ajv は
    // `no schema with key or ref "https://json-schema.org/draft-07/schema#"` で落ちる。
    // 取得を絶対パスの fs.readFile へ戻すと、この assert が落ちる。
    assert.equal(
      run.status,
      0,
      `validate-agents.mjs must succeed without a node_modules at its repo root.\n${rendered}`
    );

    // 検証が 1 件も走らずに exit 0 だと、上の assert は空振りする。
    assert.match(run.stdout, /✅ agents\/examples\//, rendered);
  });

  it('the run reports no meta-schema fallback warning', () => {
    const run = spawnSync(
      process.execPath,
      [path.join(sandboxPkg, 'scripts', 'validate-agents.mjs')],
      { cwd: sandboxRoot, encoding: 'utf8' }
    );

    // 取得失敗を warn へ落として続行する形（#1982 で退けた案 B の同型）に戻ると、
    // 本当の原因が隠れて別のエラーだけが残る。warn の不在を明示的に固定する。
    assert.doesNotMatch(run.stderr, /draft-07 meta-schema/, `--- stderr ---\n${run.stderr}`);
  });
});
