#!/usr/bin/env node
// 語彙定数の直書きリテラルガード（CLAUDE.md「Import the SSoT, never re-derive it」の機械化）。
//
// 背景: 語彙定数モジュール（例 src/lib/finding-critic.mjs の ASK_RELEVANCE）が
// export している値と同じ文字列リテラルを、別モジュールが定数を経由せず直書きする
// 事故が繰り返し起きている（#1650 / #1656 / #2021）。散文のガードでは 3 回止まらなかった
// ため、決定論の検出へ落とす。
//
// 判定（誤検出を抑えるため、対象を「結合済みのモジュール」に絞る）:
//   1. src/**/*.mjs から「語彙定数モジュール」を収集する。
//      語彙定数 = `export const SCREAMING_SNAKE = Object.freeze({ ... })`（または
//      `= { ... }`）で、値がすべて文字列リテラルのもの。
//   2. 各モジュールの相対 import を解決し、語彙定数モジュールを import している
//      ファイルだけを検査対象にする（無関係なモジュールの一般語との偶然一致を避ける）。
//   3. 検査対象ファイル内に、その import 元が export する語彙値と完全一致する
//      文字列リテラルが直書きされていたら違反として報告する。
//
// 誤検出（false-positive）対策:
//   - 定数モジュール自身の定義行は対象外（自分自身を import しないため構造的に除外）。
//   - tests/** は走査対象外（期待値としてリテラルを書くのが正しい）。
//   - コメント行は無視する。
//   - GENERIC_VALUES に載る一般語（'error' 等）は、偶然一致の温床なので除外する。
//   - 行末 `vocab-literal-ignore` コメントで個別抑制できる。
//   - ALLOWED（file → 値）で恒久的な例外を宣言できる。
// 誤検出の回帰防止は tests/check-vocabulary-literals.test.mjs の canary が担う
// （.claude/rules/review-core.md の責務分界 #1070 に従う）。

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isDirectRun } from './lib/is-direct-run.mjs';

const ROOT = process.cwd();

// 走査 scope。語彙定数の定義側・利用側がともに src/** に閉じているため src/** に限る
// （tests/** は期待値としてリテラルを書くのが正しく、対象にしない）。
const SCAN_DIRS = ['src'];
const EXTS = new Set(['.mjs', '.js']);
const EXCLUDE = ['node_modules', `.git${sep}`, `.claude${sep}worktrees`, `${sep}dist${sep}`];

// 一般語は語彙値と偶然一致しやすいので、直書き検査から外す。
// ここに載せた語は「定数経由で書くべき」判定を機械では下せない（自然言語・
// 別ドメインの値としても現れる）ものに限る。
const GENERIC_VALUES = new Set([
  'all',
  'auto',
  'default',
  'error',
  'high',
  'info',
  'low',
  'medium',
  'none',
  'off',
  'on',
  'response',
  'skip',
  'unknown',
  'warn',
  'warning',
]);

// 恒久的な例外。`<相対 path>` → 許容する値の Set。
const ALLOWED = new Map();

// 行末抑制コメント
const IGNORE_MARKER = 'vocab-literal-ignore';

// `export const NAME = Object.freeze({ ... });` / `export const NAME = { ... };`
const VOCAB_DECL_RE = /^export const ([A-Z][A-Z0-9_]*)\s*=\s*(Object\.freeze\(\s*)?\{([^{}]*)\}/gm;
// `KEY: 'value',` の並び（値が文字列リテラルのものだけ）
const ENTRY_RE = /^\s*[A-Za-z_$][\w$]*\s*:\s*(['"])((?:(?!\1).)*)\1\s*,?\s*$/;

const IMPORT_RE = /^import\s[^'"]*?from\s*['"]([^'"]+)['"]/gm;

function isExcluded(relPath) {
  return EXCLUDE.some((e) => relPath.includes(e));
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i);
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full);
    if (entry.isDirectory()) {
      if (isExcluded(rel + sep)) continue;
      yield* walk(full);
    } else if (entry.isFile() && EXTS.has(extOf(entry.name))) {
      if (isExcluded(rel)) continue;
      yield full;
    }
  }
}

export function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = join(ROOT, d);
    if (existsSync(abs)) files.push(...walk(abs));
  }
  return files.sort();
}

/**
 * 1 ファイルから語彙定数（値がすべて文字列リテラルの SCREAMING_SNAKE な
 * export const オブジェクト）を抽出する。
 *
 * @param {string} text
 * @returns {Map<string, string>} 値 → 参照式（`NAME.KEY`）
 */
export function extractVocabulary(text) {
  const vocab = new Map();
  for (const m of text.matchAll(VOCAB_DECL_RE)) {
    const name = m[1];
    const body = m[3];
    const lines = body.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('//'));
    if (lines.length === 0) continue;
    const entries = [];
    let ok = true;
    for (const line of lines) {
      const em = ENTRY_RE.exec(line);
      if (!em) {
        ok = false;
        break;
      }
      entries.push([em[2], `${name}.${line.trim().split(':')[0].trim()}`]);
    }
    if (!ok) continue;
    for (const [value, ref] of entries) {
      if (!vocab.has(value)) vocab.set(value, ref);
    }
  }
  return vocab;
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** 相対 import 指定子を ROOT 相対 path へ解決する（拡張子必須の ESM 前提）。 */
export function resolveRelativeImport(relFile, spec) {
  if (!spec.startsWith('.')) return null;
  const abs = resolve(dirname(join(ROOT, relFile)), spec);
  return relative(ROOT, abs);
}

/**
 * 1 ファイルを検査する。
 *
 * @param {string} rel 検査対象の ROOT 相対 path
 * @param {string} text 検査対象の内容
 * @param {Map<string, Map<string, string>>} vocabByFile 語彙モジュール path → (値 → 参照式)
 * @returns {Array<{file: string, line: number, value: string, ref: string, source: string}>}
 */
export function analyzeFile(rel, text, vocabByFile) {
  const imported = new Map(); // 値 → { ref, source }
  for (const m of text.matchAll(IMPORT_RE)) {
    const target = resolveRelativeImport(rel, m[1]);
    if (target == null) continue;
    const vocab = vocabByFile.get(target);
    if (!vocab) continue;
    for (const [value, ref] of vocab) {
      if (GENERIC_VALUES.has(value)) continue;
      if (!imported.has(value)) imported.set(value, { ref, source: target });
    }
  }
  if (imported.size === 0) return [];

  const allowed = ALLOWED.get(rel);
  const violations = [];
  text.split('\n').forEach((line, idx) => {
    if (isCommentLine(line)) return;
    if (line.includes(IGNORE_MARKER)) return;
    for (const [value, { ref, source }] of imported) {
      if (allowed?.has(value)) continue;
      const re = new RegExp(`(['"\`])${escapeRe(value)}\\1`);
      if (re.test(line)) {
        violations.push({ file: rel, line: idx + 1, value, ref, source });
      }
    }
  });
  return violations;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function run() {
  const files = collectFiles();
  const texts = new Map();
  const vocabByFile = new Map();
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = relative(ROOT, file);
    texts.set(rel, text);
    const vocab = extractVocabulary(text);
    if (vocab.size > 0) vocabByFile.set(rel, vocab);
  }

  const violations = [];
  for (const [rel, text] of texts) {
    violations.push(...analyzeFile(rel, text, vocabByFile));
  }
  return violations;
}

function main() {
  const violations = run();
  if (violations.length > 0) {
    console.error(`❌ 語彙定数の直書きリテラルを ${violations.length} 件検出:`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  '${v.value}' → ${v.ref}（${v.source}）`);
    }
    console.error(
      '\nSSoT の定数を import して参照してください（CLAUDE.md「Import the SSoT, never re-derive it」）。'
    );
    console.error(
      `意図的な直書きは行末 // ${IGNORE_MARKER}、恒久例外は scripts/check-vocabulary-literals.mjs の ALLOWED に追記してください。`
    );
    process.exit(1);
  }
  console.log('✅ 語彙定数の直書きリテラルなし（src/** の import 結合モジュール）');
}

if (isDirectRun(import.meta.url)) {
  main();
}
