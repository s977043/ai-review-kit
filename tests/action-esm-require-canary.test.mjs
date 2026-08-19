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

  // 上の 3 件は「グラフが require 可能か」を守るが、「**ランタイムが
  // `require(ESM)` を許すか**」は守らない。`actions/github-script` の実行
  // ランタイムは版で変わる（実測: v7 = `using: node20` / v8 = `using: node24`。
  // `gh api 'repos/actions/github-script/contents/action.yml?ref=vN'`）。
  // `require(ESM)` が安定したのは Node 22.12 以降なので、**@v7 へ下げる変更が
  // 入ると canary は緑のまま利用者環境だけが壊れる**。
  //
  // コメントによる同期義務では足りないと判断して機械化した。理由は 2 つ。
  //   1. 失敗が観測不能。canary も CI も緑で、壊れるのは利用者のランナーだけ。
  //      本 PR が塞いでいるリスクとまったく同じ性質である。
  //   2. このリポジトリでコメントの同期義務は実際に破れている。#1921 の
  //      `dependencyStubs` は「Keep this list in sync with …」と書かれていたのに
  //      `anyOf` の `^custom:.+` 枝を落とし、出荷済みスキル 1 本が計画から消えた。
  const ACTION_YML = fileURLToPath(new URL('../runners/github-action/action.yml', import.meta.url));
  const MIN_GITHUB_SCRIPT_MAJOR = 8;
  const GITHUB_SCRIPT_USES_RE = /uses:\s*actions\/github-script@(\S+)/g;

  it(`every actions/github-script reference is >= v${MIN_GITHUB_SCRIPT_MAJOR} (node24)`, () => {
    const source = readFileSync(ACTION_YML, 'utf8');
    GITHUB_SCRIPT_USES_RE.lastIndex = 0;
    const refs = [...source.matchAll(GITHUB_SCRIPT_USES_RE)].map((m) => m[1]);

    // 参照が 0 件だと以下のループが空回りして何も守らない。先に下限を固定する。
    assert.ok(
      refs.length >= 1,
      'no actions/github-script reference found in runners/github-action/action.yml — ' +
        'this canary would silently pass. Update it alongside the workflow change.'
    );

    // 参照は複数ある（現状 2 件）。1 つでも条件を満たさなければ落とす — 生の
    // message を出す step がどちらに乗るかは将来変わりうるため。
    const why =
      `runners/github-action/post-inline-comments.cjs は ` +
      `require('../../src/lib/finding-factory.mjs') で ESM の SSoT を直接呼ぶ。` +
      `require(ESM) が使えるのは Node 22.12 以降で、actions/github-script は ` +
      `v7 = node20 / v8 = node24。v${MIN_GITHUB_SCRIPT_MAJOR} 未満へ下げるなら、` +
      `先に post-inline-comments.cjs の require を CJS 側の実装へ差し戻すこと。`;

    for (const ref of refs) {
      // タグ形式（`v8` / `v8.1.2`）のみを許す。SHA pin やブランチ名は、その
      // ref がどのランタイムに解決されるかをこのテストから判定できないため
      // skip ではなく fail にする。skip にすると canary が黙って空になり、
      // 上で機械化した理由（観測不能な失敗）をそのまま作り直すことになる。
      const major = /^v(\d+)(?:\.\d+)*$/.exec(ref)?.[1];
      assert.ok(
        major !== undefined,
        `actions/github-script@${ref} is not a version tag, so its runtime cannot be ` +
          `checked here. If the pin is intentional, record which runtime it resolves to ` +
          `and update this canary. ${why}`
      );
      assert.ok(
        Number(major) >= MIN_GITHUB_SCRIPT_MAJOR,
        `actions/github-script@${ref} runs on a Node older than 22.12. ${why}`
      );
    }
  });
});
