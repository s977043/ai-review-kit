#!/usr/bin/env node
// ソースへの C0 制御文字混入ガード（#2055）。
//
// 背景: PR #2050 の実装中に scripts/validate-plugin-manifest.mjs へ 1 バイトの NUL(U+0000)
// が混入した。`'\0'` というエスケープ列（2 文字）を書いたつもりが制御文字そのものが
// 入った形で、**機能面の影響はゼロ**（NUL も未知の 1 文字なので挙動は変わらない）だった。
// 壊れたのは検索性で、NUL を含むファイルは grep / ripgrep がバイナリと判定して
// 黙って走査対象から外す。実測（2026-09-04、混入していた間）:
//     $ file scripts/validate-plugin-manifest.mjs
//     scripts/validate-plugin-manifest.mjs: data
//     $ grep -c ra1Sink scripts/validate-plugin-manifest.mjs   # 出力なし / exit 1
// つまり 651 行のコードが検索へ一切映らない。探す人やエージェントは「存在しない」と
// 結論する。npm test / prettier / markdownlint / textlint / meta:validate はすべて素通しした。
//
// 判定は完全に決定論で、誤検出の余地がほぼない。docs/development/improvement-flow.md の
// 「mechanical に検証できるか」基準に従い、散文でなく script + 必須 CI（Meta consistency）へ倒す。
//
// 設計上の決定（PR 本文と同じ内容をここにも残す）:
//   1. 対象 pathspec: scripts/ src/ tests/ 配下の **git 追跡ファイル全部**（拡張子で絞らない）。
//      実測（2026-09-04）: scripts/ + src/ が 185 件（うち .mjs 154 件、残りは
//      .sh/.ts/.md/.jsx/.yaml/.py/.js/.css）、tests/ が 426 件（.mjs/.json/.diff/.md/.ts/
//      .txt/.tsx/.yaml/.patch）。いずれもテキストのみでバイナリ資産は 1 件も無いため、
//      拡張子の許可リストを持つ必要が無い。持たない方が新拡張子の取りこぼしも起きない。
//      tests/ を含めるのは、事故の本質が「grep から消える」ことであり、テストコードも
//      同じく grep で探される対象だから（実際、本 PR 時点で唯一の既存違反は tests/ にあった）。
//   2. 許可する制御文字: TAB(0x09) / LF(0x0A) / CR(0x0D) のみ。
//      それ以外の C0（0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F）と DEL(0x7F) を違反とする。
//      これは grep/ripgrep がバイナリ判定へ倒す条件に合わせた最小集合で、
//      NFC 正規化や全角/半角の統一（#2055 の Non-goals）には踏み込まない。
//   3. 非 UTF-8 / バイナリの扱い: 本チェックは **生バイト**を見るので UTF-8 デコードをしない。
//      対象 pathspec の下にバイナリ（画像・フォント等）が置かれれば違反として落ちるが、
//      それは意図した挙動である（バイナリ資産は assets/ に置くべきで、scripts/ src/ tests/
//      へ入れるのは配置ミス）。恒久的な例外が要る場合は ALLOWED_FILES に理由付きで宣言する。
//   4. 列挙基準: `git ls-files`。`find` や再帰 readdir は .claude/worktrees/ の
//      フルコピーを拾ってしまうため使わない（ADR-009 D3-3 項番 1 / RA-1 実装と同じ理由）。
//
// 意図的に制御文字を含む文字列をテストしたい場合は、生バイトではなく
// エスケープ列（'skill\u0000id'）で書く。実行時の文字列は同じで、ファイルはテキストのまま残る。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { isDirectRun } from './lib/is-direct-run.mjs';

/** 走査対象の git pathspec。ディレクトリ指定は再帰的に一致する。 */
export const SCAN_PATHSPECS = Object.freeze(['scripts/', 'src/', 'tests/']);

/** 許可する制御文字（TAB / LF / CR）。 */
export const ALLOWED_CONTROL_BYTES = Object.freeze([0x09, 0x0a, 0x0d]);

const ALLOWED_SET = new Set(ALLOWED_CONTROL_BYTES);

/**
 * 恒久的な例外。`<ROOT 相対 path>` → 理由。
 * 空の理由は受け付けない（理由なしの黙殺を作れないようにする）。
 * @type {Map<string, string>}
 */
export const ALLOWED_FILES = new Map();

/** 対象が 1 件も無いまま OK を返さないためのエラー文言。 */
export const NOTHING_SCANNED_ERROR =
  '走査対象が 0 件だった — git ls-files が空を返している（リポジトリ外での実行、' +
  'または SCAN_PATHSPECS の指定ミス）。「落ちない script」は目的ではないのでエラーとする';

/**
 * 1 バイトが違反かどうか。
 *
 * @param {number} code 0-255
 * @returns {boolean}
 */
export function isForbiddenByte(code) {
  if (ALLOWED_SET.has(code)) return false;
  return code < 0x20 || code === 0x7f;
}

/** 制御文字の可読名。 */
function controlName(code) {
  if (code === 0x00) return 'NUL';
  if (code === 0x0b) return 'VT';
  if (code === 0x0c) return 'FF';
  if (code === 0x1b) return 'ESC';
  if (code === 0x7f) return 'DEL';
  return `C0 U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * バッファを走査して違反位置を返す。
 *
 * 行番号は LF の数で数える（生バイト基準。CR 単独改行は行を分けない）。
 * column は「その行の先頭からのバイト数（1 始まり）」。
 *
 * @param {Buffer | Uint8Array} buffer
 * @returns {Array<{offset: number, line: number, column: number, code: number, name: string}>}
 */
export function scanBuffer(buffer) {
  const bytes = buffer;
  const found = [];
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const code = bytes[i];
    if (code === 0x0a) {
      line += 1;
      lineStart = i + 1;
      continue;
    }
    if (isForbiddenByte(code)) {
      found.push({
        offset: i,
        line,
        column: i - lineStart + 1,
        code,
        name: controlName(code),
      });
    }
  }
  return found;
}

/**
 * 走査対象のファイルを列挙する（ROOT 相対 path、ソート済み）。
 *
 * @param {string} root リポジトリ（または worktree）のルート
 * @param {readonly string[]} [pathspecs]
 * @returns {string[]}
 */
export function listTargetFiles(root, pathspecs = SCAN_PATHSPECS) {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .toString('utf8')
    .split('\0')
    .filter((entry) => entry !== '')
    .sort();
}

/**
 * チェック本体。
 *
 * @param {{ root?: string, pathspecs?: readonly string[], allowedFiles?: Map<string, string> }} [options]
 * @returns {{ violations: Array<object>, errors: string[], scanned: number, ignored: string[] }}
 */
export function checkControlCharacters(options = {}) {
  const root = options.root ?? process.cwd();
  const pathspecs = options.pathspecs ?? SCAN_PATHSPECS;
  const allowedFiles = options.allowedFiles ?? ALLOWED_FILES;

  const errors = [];
  const ignored = [];
  for (const [file, reason] of allowedFiles) {
    if (String(reason ?? '').trim() === '') {
      errors.push(`ALLOWED_FILES["${file}"] に理由が書かれていない — 理由なしの除外は許可しない`);
    }
  }

  let files;
  try {
    files = listTargetFiles(root, pathspecs);
  } catch (err) {
    return {
      violations: [],
      errors: [...errors, `対象の列挙に失敗した (${err.message})`],
      scanned: 0,
      ignored,
    };
  }

  const violations = [];
  let scanned = 0;
  for (const file of files) {
    if (allowedFiles.has(file)) {
      ignored.push(`${file} — ${allowedFiles.get(file)}`);
      continue;
    }
    let buffer;
    try {
      buffer = readFileSync(path.join(root, file));
    } catch (err) {
      // 追跡されているのに読めない（sparse-checkout・symlink 切れ等）。
      // 素通しさせず、エラーとして報告する。
      errors.push(`${file}: 読み取りに失敗した (${err.message})`);
      continue;
    }
    scanned += 1;
    for (const hit of scanBuffer(buffer)) {
      violations.push({ file, ...hit });
    }
  }

  if (scanned === 0 && errors.length === 0) {
    errors.push(NOTHING_SCANNED_ERROR);
  }

  return { violations, errors, scanned, ignored };
}

function main() {
  const { violations, errors, scanned, ignored } = checkControlCharacters();

  for (const note of ignored) {
    console.log(`  (ignored) ${note}`);
  }

  if (errors.length > 0) {
    console.error(`制御文字チェック: ${errors.length} 件のエラー`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error(`❌ ソースへの C0 制御文字混入を ${violations.length} 件検出:`);
    for (const v of violations) {
      console.error(
        `  ${v.file}:${v.line}:${v.column}  byte offset ${v.offset}  ` +
          `0x${v.code.toString(16).padStart(2, '0')} (${v.name})`
      );
    }
    console.error('');
    console.error(
      '制御文字を含むファイルは grep / ripgrep がバイナリ判定で走査対象から外すため、' +
        'コードが検索へ映らなくなります（#2055）。'
    );
    console.error(
      "意図的に制御文字を含む文字列を扱う場合は、生バイトではなくエスケープ列（例 'skill\\u0000id'）で書いてください。"
    );
    console.error(
      '恒久的な例外は scripts/check-control-characters.mjs の ALLOWED_FILES へ理由付きで追記してください。'
    );
    process.exit(1);
  }

  console.log(`✅ C0 制御文字なし（${scanned} ファイル走査 / ${SCAN_PATHSPECS.join(' ')}）`);
}

if (isDirectRun(import.meta.url)) {
  main();
}
