#!/usr/bin/env node
// ドキュメントが書いている「列挙・件数」主張を実体と機械照合するチェッカー。
//
// 背景（2026-08-02 の 4 体系ドキュメント監査）:
//   機械が検証している参照（相対リンク 1123 件 / npm script 340 件）の乖離率は 0.18% で健全だった。
//   一方 CI 非対象の「列挙・件数・構成」主張は 20 件サンプルで 18/20（90%）が陳腐化していた。
//   例: docs/skills-structure.md が upstream 46 / midstream 26 / downstream 9 と書いていたが、
//   実測は 49 / 60 / 8 だった（midstream は 2.3 倍の乖離）。
//   docs 側のチェックリストでは止まらないことも実証済みで、
//   plugin-asset-registration-checklist.md の「commands/README.md も更新」項目は 37〜41 日守られなかった。
//   docs/development/improvement-flow.md の「mechanical に実行できるか」基準に従い、script + CI に倒す。
//
// 設計方針:
//   - 誤検出でメイン開発を止めないことを最優先とする。曖昧な対象は登録しない（後から足せる）。
//   - 宣言側のマーカー（表・行）が見つからない場合は「一致」ではなく **エラー** にする。
//     regex がすり抜けて検証が空振りする方が、落ちるより危険なため
//     （validate-meta-consistency.mjs の extractLatestRelease === null と同じ扱い）。
//   - 意図的に概数で書きたい箇所は 2 通りで除外できる（いずれも理由が必須）。
//       1. doc 側インラインコメント `<!-- doc-enum:ignore <specId> -- <理由> -->`（spec 全体を除外）
//       2. spec テーブル側の `ignoreKeys: { '<key>': '<理由>' }`（キー単位で除外）
//
// 運用手順は docs/development/doc-enumeration-checks.md を参照。

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { isDirectRun } from './lib/is-direct-run.mjs';
// 「トップレベルの *.md を列挙する」実装は validate-plugin-manifest.mjs が既に持つ。
// 同じ概念を再実装せず import する（CLAUDE.md「Import the SSoT, never re-derive it」）。
import { listMarkdownFiles } from './validate-plugin-manifest.mjs';
// stream（phase）名の SSoT。
import { PHASES } from '../src/lib/planner-utils.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/** doc 側の除外ディレクティブ。理由（`--` 以降）が空なら不許可とする。 */
const IGNORE_DIRECTIVE_RE = /<!--\s*doc-enum:ignore\s+([a-z0-9-]+)\s*(?:--\s*([^]*?))?-->/g;

/**
 * doc 本文から `<!-- doc-enum:ignore <specId> -- <理由> -->` を拾う。
 *
 * @param {string} text
 * @returns {Map<string, string>} specId -> 理由（未記載なら空文字）
 */
export function parseIgnoreDirectives(text) {
  const found = new Map();
  for (const match of String(text ?? '').matchAll(IGNORE_DIRECTIVE_RE)) {
    found.set(match[1], (match[2] ?? '').trim());
  }
  return found;
}

/**
 * Markdown のテーブル行を単純にセル配列へ分解する。テーブル行でなければ null。
 *
 * @param {unknown} line
 * @returns {string[] | null}
 */
function splitTableRow(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * ヘッダーセル名が完全一致する最初のテーブルから、その列のデータセルを取り出す。
 * 該当テーブルが無ければ null（＝マーカー消失としてエラーにする）。
 *
 * @param {string} text
 * @param {string} header
 * @returns {string[] | null}
 */
export function parseMarkdownTableColumn(text, header) {
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const headerCells = splitTableRow(lines[i]);
    if (!headerCells) continue;
    const column = headerCells.indexOf(header);
    if (column < 0) continue;
    const separator = splitTableRow(lines[i + 1]);
    if (!separator || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;

    const values = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      const row = splitTableRow(lines[j]);
      if (!row) break;
      if (column < row.length) values.push(row[column]);
    }
    return values;
  }
  return null;
}

/** `` `foo` `` 形式のセルからコードスパンを外す。 */
export function unwrapCodeSpan(cell) {
  const match = /^`([^`]+)`$/.exec(String(cell ?? '').trim());
  return match ? match[1] : String(cell ?? '').trim();
}

/**
 * docs/skills-structure.md のツリー内コメント（`├── upstream/  # 46 スキル`）から
 * stream ごとの件数宣言を拾う。
 *
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function parseSkillStreamCounts(text) {
  const counts = new Map();
  const pattern = /[├└]──\s*(upstream|midstream|downstream)\/\s*#\s*(\d+)\s*スキル/g;
  for (const match of String(text ?? '').matchAll(pattern)) {
    counts.set(match[1], Number(match[2]));
  }
  return counts;
}

/** repo-relative なディレクトリ直下のサブディレクトリ名を返す（存在しなければ throw）。 */
async function listDirectories(relDir) {
  const entries = await fs.readdir(path.join(ROOT, relDir), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** コマンドディレクトリ直下の *.md（README.md を除く）を返す。 */
async function listCommandFiles(relDir) {
  const files = await listMarkdownFiles(relDir);
  return files.filter((file) => file !== 'README.md');
}

/**
 * 宣言的な spec テーブル。ドキュメントの列挙・件数と実体の対応をここに 1 行で登録する。
 *
 * 各 spec:
 *   id        … doc-enum:ignore で参照する識別子
 *   doc       … 検査対象ドキュメント（repo-relative）
 *   summary   … エラーメッセージに出す「何の列挙か」
 *   marker    … 宣言側の目印（消失時のエラー文に出す）
 *   kind      … 'counts'（キー→数値）か 'names'（名前の集合）
 *   declare   … doc 本文から宣言値を取り出す純関数。マーカー消失時は 'names' なら null を返す
 *   measure   … 実測値を返す async 関数
 *   ignoreKeys… キー単位の除外（値は理由。理由なしの除外は書けない）
 */
export const DOC_ENUMERATION_SPECS = [
  {
    id: 'skills-stream-counts',
    doc: 'docs/skills-structure.md',
    summary: 'skills/<stream>/ のスキル件数',
    marker: '`├── <stream>/  # <n> スキル` のツリー行',
    kind: 'counts',
    declare: parseSkillStreamCounts,
    // ツリー図はディレクトリ構成の記述なので、ローダーが読める件数ではなく
    // 実ディレクトリ数（skills/<stream>/<skill-id>/）を実体とする。
    measure: async () => {
      const counts = new Map();
      for (const phase of PHASES) {
        counts.set(phase, (await listDirectories(`skills/${phase}`)).length);
      }
      return counts;
    },
  },
  {
    id: 'distributed-commands-table',
    doc: 'commands/README.md',
    summary: '配布コマンド表の File 列',
    marker: '`Command | File | Purpose` 表',
    kind: 'names',
    declare: (text) => {
      const column = parseMarkdownTableColumn(text, 'File');
      return column && new Set(column.map(unwrapCodeSpan));
    },
    measure: async () => new Set(await listCommandFiles('commands')),
  },
  {
    id: 'repo-dev-commands-table',
    doc: '.claude/commands/README.md',
    summary: 'repo-dev コマンド表の File 列',
    marker: '`Command | File | Purpose` 表',
    kind: 'names',
    declare: (text) => {
      const column = parseMarkdownTableColumn(text, 'File');
      return column && new Set(column.map(unwrapCodeSpan));
    },
    measure: async () => new Set(await listCommandFiles('.claude/commands')),
  },
  {
    // validate-plugin-manifest.mjs の checkClaudeMdCommandParity が見るのは
    // 「Details: distributed commands (...)」の散文だけで、Custom Commands 表は未検証だった。
    id: 'claude-md-command-table',
    doc: 'CLAUDE.md',
    summary: 'CLAUDE.md `Custom Commands` 表のコマンド名',
    marker: '`Command | Purpose` 表',
    kind: 'names',
    declare: (text) => {
      const column = parseMarkdownTableColumn(text, 'Command');
      return column && new Set(column.map(unwrapCodeSpan));
    },
    measure: async () => {
      const distributed = await listCommandFiles('commands');
      const repoDev = await listCommandFiles('.claude/commands');
      return new Set([...distributed, ...repoDev].map((file) => `/${file.replace(/\.md$/, '')}`));
    },
  },
];

/** 件数系の差分。 */
function diffCounts(spec, declared, measured, ignoreKeys) {
  const errors = [];
  for (const [key, actual] of measured) {
    if (key in ignoreKeys) continue;
    if (!declared.has(key)) {
      errors.push(
        `${spec.doc} [${spec.id}]: "${key}" の件数宣言が見つからない（マーカー: ${spec.marker}）`
      );
      continue;
    }
    const claimed = declared.get(key);
    if (claimed !== actual) {
      errors.push(
        `${spec.doc} [${spec.id}]: ${spec.summary} の "${key}" は ${claimed} と書かれているが実測は ${actual}`
      );
    }
  }
  for (const key of declared.keys()) {
    if (key in ignoreKeys) continue;
    if (!measured.has(key)) {
      errors.push(`${spec.doc} [${spec.id}]: "${key}" を宣言しているが実測対象に存在しない`);
    }
  }
  return errors;
}

/** 名前集合の差分。 */
function diffNames(spec, declared, measured, ignoreKeys) {
  const errors = [];
  const isIgnored = (name) => name in ignoreKeys;
  const declaredNames = [...declared].filter((name) => !isIgnored(name));
  const measuredNames = [...measured].filter((name) => !isIgnored(name));
  const declaredSet = new Set(declaredNames);
  const measuredSet = new Set(measuredNames);

  for (const name of measuredNames.sort()) {
    if (!declaredSet.has(name)) {
      errors.push(
        `${spec.doc} [${spec.id}]: 実体に "${name}" があるが ${spec.summary} に載っていない（行を追加する）`
      );
    }
  }
  for (const name of declaredNames.sort()) {
    if (!measuredSet.has(name)) {
      errors.push(
        `${spec.doc} [${spec.id}]: ${spec.summary} が "${name}" を挙げているが実体に存在しない（行を削除する）`
      );
    }
  }
  return errors;
}

/** 既定の doc リーダー。テストからは差し替えて注入できるようにしておく。 */
async function readDocFromDisk(docPath) {
  return fs.readFile(path.join(ROOT, docPath), 'utf8');
}

/**
 * spec テーブルを走らせて宣言と実体を突き合わせる。
 *
 * @param {{ specs?: typeof DOC_ENUMERATION_SPECS, readDoc?: (doc: string) => Promise<string> }} [options]
 * @returns {Promise<{ errors: string[], skipped: string[], checked: number }>}
 */
export async function checkDocEnumerations({
  specs = DOC_ENUMERATION_SPECS,
  readDoc = readDocFromDisk,
} = {}) {
  const errors = [];
  const skipped = [];
  let checked = 0;

  for (const spec of specs) {
    let text;
    try {
      text = await readDoc(spec.doc);
    } catch (err) {
      errors.push(`${spec.doc} [${spec.id}]: ドキュメントを読めない (${err.message})`);
      continue;
    }

    const ignores = parseIgnoreDirectives(text);
    if (ignores.has(spec.id)) {
      const reason = ignores.get(spec.id);
      if (!reason) {
        errors.push(
          `${spec.doc} [${spec.id}]: doc-enum:ignore に理由が無い — ` +
            `\`<!-- doc-enum:ignore ${spec.id} -- <理由> -->\` の形式で理由を書く`
        );
      } else {
        skipped.push(`${spec.doc} [${spec.id}]: ${reason}`);
      }
      continue;
    }

    let measured;
    try {
      measured = await spec.measure();
    } catch (err) {
      errors.push(`${spec.doc} [${spec.id}]: 実測に失敗した (${err.message})`);
      continue;
    }

    const declared = spec.declare(text);
    if (declared === null || declared === undefined) {
      errors.push(
        `${spec.doc} [${spec.id}]: 宣言側のマーカー（${spec.marker}）が見つからない — ` +
          `doc の形式を戻すか、scripts/check-doc-enumerations.mjs の spec を更新する`
      );
      continue;
    }

    checked += 1;
    const ignoreKeys = spec.ignoreKeys ?? {};
    errors.push(
      ...(spec.kind === 'counts'
        ? diffCounts(spec, declared, measured, ignoreKeys)
        : diffNames(spec, declared, measured, ignoreKeys))
    );
  }

  return { errors, skipped, checked };
}

// CLI entry point
if (isDirectRun(import.meta.url)) {
  checkDocEnumerations()
    .then(({ errors, skipped, checked }) => {
      for (const note of skipped) {
        console.log(`  (ignored) ${note}`);
      }
      if (errors.length === 0) {
        console.log(`Doc enumerations: OK (${checked} spec(s) checked, ${skipped.length} ignored)`);
        return 0;
      }
      console.error(`Doc enumerations: ${errors.length} error(s) found`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      console.error('');
      console.error('spec: scripts/check-doc-enumerations.mjs (DOC_ENUMERATION_SPECS)');
      console.error('運用: docs/development/doc-enumeration-checks.md');
      return 1;
    })
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((err) => {
      console.error(`Doc enumeration check failed: ${err.message}`);
      process.exitCode = 1;
    });
}
