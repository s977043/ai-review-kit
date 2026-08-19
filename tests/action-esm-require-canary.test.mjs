// #1929: `runners/github-action/post-inline-comments.cjs` calls
// `require('../../src/lib/finding-factory.mjs')` so the self-reported `Scope:`
// grammar is imported from its SSoT instead of mirrored into CommonJS.
//
// その require が壊れる条件は、CI では観測できない。
//
//   - GitHub Actions のランナーは配布 tarball を展開しただけの木で動く。
//     `node_modules` は無い。したがって `finding-factory.mjs` の推移的 import に
//     npm パッケージが 1 つ入った瞬間、利用者環境だけで `ERR_MODULE_NOT_FOUND`
//     になる。CI には `node_modules` があるので緑のまま通る。
//   - `require(ESM)` は top-level await を含むモジュールを読めない
//     （`ERR_REQUIRE_ASYNC_MODULE`）。これは ESM 側からの import では起きない。
//
// この 2 条件を機械で固定する canary。落ちたときの選択肢は「その依存を
// finding-factory の到達グラフから外す」か「案 A（CJS 側へ語彙を切り出す）へ
// 退避する」のどちらかで、`post-inline-comments.cjs` を放置してはいけない。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { packageBaseOf } from '../scripts/check-code-hygiene.mjs';

const require = createRequire(import.meta.url);

/** require() されるモジュール = canary の対象グラフの根。 */
const ENTRY = fileURLToPath(new URL('../src/lib/finding-factory.mjs', import.meta.url));

/** CJS 側の呼び出し元。require 指定子をここから読み取る。 */
const CJS_CALLER = fileURLToPath(
  new URL('../runners/github-action/post-inline-comments.cjs', import.meta.url)
);

// `import ... from '...'` / `export ... from '...'` / `import '...'` /
// `await import('...')` を拾う。相対 specifier のみ再帰の対象にし、bare
// specifier は npm 依存として報告する。
const STATIC_FROM_RE = /(?:^|\n)\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(source) {
  const found = [];
  for (const re of [STATIC_FROM_RE, SIDE_EFFECT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) found.push(m[1]);
  }
  return found;
}

/**
 * ENTRY から相対 import だけを辿り、到達したファイルと bare specifier を返す。
 * @returns {{ files: string[], bare: Array<{ from: string, spec: string }> }}
 */
function walkGraph(entry) {
  const seen = new Set();
  const bare = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const spec of specifiersOf(source)) {
      if (spec.startsWith('.')) {
        queue.push(resolve(dirname(file), spec));
        continue;
      }
      const pkg = packageBaseOf(spec);
      if (pkg !== null) bare.push({ from: file, spec });
    }
  }
  return { files: [...seen], bare };
}

describe('#1929 canary: the Action runner can require() the ESM SSoT without node_modules', () => {
  it('post-inline-comments.cjs requires finding-factory.mjs by relative path', () => {
    const source = readFileSync(CJS_CALLER, 'utf8');
    assert.match(source, /require\('\.\.\/\.\.\/src\/lib\/finding-factory\.mjs'\)/);
  });

  it('the require target graph reaches more than the entry file itself', () => {
    // グラフ探索が黙って 1 ファイルで止まっていたら、以下の assert は
    // 何も守っていない。到達数の下限を先に固定する。
    const { files } = walkGraph(ENTRY);
    assert.ok(
      files.length >= 2,
      `expected the import walk to reach the transitive graph, got ${files.length} file(s)`
    );
  });

  it('no npm package is reachable from finding-factory.mjs', () => {
    const { bare } = walkGraph(ENTRY);
    const rendered = bare.map((b) => `${b.from} -> ${b.spec}`).join('\n');
    assert.deepEqual(
      bare,
      [],
      `An npm dependency became reachable from src/lib/finding-factory.mjs.\n` +
        `GitHub Actions ランナーには node_modules が無いため、` +
        `runners/github-action/post-inline-comments.cjs の require が利用者環境でだけ落ちる。\n${rendered}`
    );
  });

  it('the graph loads through require() — i.e. it carries no top-level await', () => {
    // `require(ESM)` は top-level await を含むグラフで ERR_REQUIRE_ASYNC_MODULE
    // を投げる。実際に require して確かめる（構文の正規表現判定より確実）。
    const mod = require(ENTRY);
    assert.equal(typeof mod.stripSelfReportedScope, 'function');
  });
});
