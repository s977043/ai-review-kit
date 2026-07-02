#!/usr/bin/env node
// bot レビュー頻出指摘の機械化ガード。
// Copilot / gemini が PR レビューで繰り返し指摘してきた 3 class を lint で決定論的に検出する:
//
//   1. duplicate-import: 同一モジュール指定子からの重複 import（#1343 で 4 件指摘）
//   2. tmp-literal: tests/** での '/tmp' ハードコード文字列
//      （Windows 非対応 + テスト間干渉の flake 源。#1346 で両 bot が同一指摘）
//      → mkdtempSync(path.join(os.tmpdir(), 'prefix-')) を使う
//   3. mkdtemp-cleanup: tests/** で mkdtemp / mkdtempSync を使うのに、
//      cleanup（rm / rmSync / after / finally）が同一ファイルに 1 つも無い
//      （#1335 ×2、#1375 で再発）
//
// 誤検出（false-positive）は tests/check-code-hygiene.test.mjs の canary で回帰防止する
// （.claude/rules/review-core.md の責務分界 #1070 に従う）。
// 意図的な '/tmp' リテラルは行末に `code-hygiene-ignore` コメントで抑制できる。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

const SCAN_DIRS = ['src', 'scripts', 'tests', 'tools', 'runners'];
const EXTS = new Set(['.mjs', '.js', '.cjs']);
// 除外 path（生成物 / 依存 / 意図的 fixture / worktree）
const EXCLUDE = [
  'node_modules',
  `.git${sep}`,
  `.claude${sep}worktrees`,
  `${sep}dist${sep}`,
  `${sep}build${sep}`,
  `${sep}fixtures${sep}`,
  `${sep}__fixtures__${sep}`,
];

// import 文（from 付きのみ。side-effect import は対象外）。
// 複数行 import（named import の改行）も [^'"] が改行を跨ぐため一致する。
const IMPORT_RE = /^import\s[^'"]*?from\s*['"]([^'"]+)['"]/gm;

// クォート直後に /tmp が続くリテラル（'/tmp' そのもの、'/tmp/...' の両方）
const TMP_LITERAL_RE = /['"`]\/tmp(?=[/'"`])/;

const MKDTEMP_RE = /\bmkdtemp(?:Sync)?\s*\(/;
const CLEANUP_RE = /\brmSync\s*\(|\brm\s*\(|\bafter\s*\(|\.after\s*\(|\bfinally\b/;

// 判定は ROOT からの相対 path で行う（絶対 path だと、repo 自体が
// .claude/worktrees/ 配下にある worktree で全ファイルが除外されてしまう）
function isExcluded(p) {
  return EXCLUDE.some((e) => relative(ROOT, p).includes(e));
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i);
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (isExcluded(full + (extOf(name) ? '' : sep))) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (EXTS.has(extOf(name))) {
      yield full;
    }
  }
}

function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = join(ROOT, d);
    try {
      if (statSync(abs).isDirectory()) files.push(...walk(abs));
    } catch {
      /* dir absent: skip */
    }
  }
  return files;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

const duplicateImports = [];
const tmpLiterals = [];
const mkdtempNoCleanup = [];

for (const file of collectFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const rel = relative(ROOT, file);
  const isTestFile = rel.startsWith(`tests${sep}`);

  // Check 1: duplicate imports（全 scan 対象）
  const seen = new Map();
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1];
    const line = lineOf(text, m.index);
    if (seen.has(spec)) {
      duplicateImports.push({ file: rel, line, spec, first: seen.get(spec) });
    } else {
      seen.set(spec, line);
    }
  }

  if (!isTestFile) continue;

  // Check 2: tests/** の '/tmp' リテラル（コメント行と明示抑制行は除外）
  text.split('\n').forEach((line, idx) => {
    if (isCommentLine(line)) return;
    if (line.includes('code-hygiene-ignore')) return;
    if (TMP_LITERAL_RE.test(line)) {
      tmpLiterals.push({ file: rel, line: idx + 1, text: line.trim() });
    }
  });

  // Check 3: tests/** の mkdtemp なのに cleanup 無し（ファイル単位）
  if (MKDTEMP_RE.test(text) && !CLEANUP_RE.test(text)) {
    mkdtempNoCleanup.push({ file: rel });
  }
}

let hasError = false;

if (duplicateImports.length > 0) {
  console.error(
    `❌ duplicate-import: 同一モジュールからの重複 import を ${duplicateImports.length} 件検出:`
  );
  for (const v of duplicateImports) {
    console.error(
      `  ${v.file}:${v.line}  '${v.spec}'（初出: line ${v.first}）→ 1 つの import 文に統合してください`
    );
  }
  hasError = true;
}

if (tmpLiterals.length > 0) {
  console.error(
    `\n❌ tmp-literal: tests/** の '/tmp' ハードコードを ${tmpLiterals.length} 件検出:`
  );
  for (const v of tmpLiterals) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error(
    "\n実 FS を使う場合は mkdtempSync(path.join(os.tmpdir(), 'prefix-'))、純粋な fixture 文字列も path.join(os.tmpdir(), ...) を使ってください。"
  );
  console.error('意図的な場合は行末に // code-hygiene-ignore を付けて抑制できます。');
  hasError = true;
}

if (mkdtempNoCleanup.length > 0) {
  console.error(
    `\n❌ mkdtemp-cleanup: mkdtemp を使うのに cleanup が無いテストを ${mkdtempNoCleanup.length} 件検出:`
  );
  for (const v of mkdtempNoCleanup) {
    console.error(
      `  ${v.file}  → rmSync(dir, { recursive: true, force: true }) を t.after() / finally で必ず実行してください`
    );
  }
  hasError = true;
}

if (hasError) process.exit(1);

console.log('✅ code hygiene OK（duplicate-import / tmp-literal / mkdtemp-cleanup）');
