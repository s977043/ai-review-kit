#!/usr/bin/env node
// dangling skill-ID 参照ガード。
// PR #1320 で skill ID を `rr-<phase>-<name>-001` -> 簡素名 `<name>` へリネームした際、
// prompt / golden / ROUTING / SKILL 等に旧 ID 参照が取りこぼされた。本スクリプトは
// scan 対象に残る旧形式 ID を検出し、CI を fail させて再発を防ぐ。
//
// 判定: 旧形式 `rr-(upstream|midstream|downstream)-<name>-<NNN>` はすべて陳腐化参照とみなす
//       （現行 ID は簡素名で rr- 接頭辞を持たないため）。
//       ALLOWED_LEGACY_IDS（意図的プレースホルダ / 追跡中の移行）と除外 path のみ許容。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// 走査対象（Codex 相談: skills/scripts/src/runners/node-api/.github/examples/commands/docs + 主要 md）
const SCAN_DIRS = [
  'skills',
  'scripts',
  'src',
  'runners/node-api',
  '.github',
  'examples',
  'commands',
  'docs',
];
const SCAN_FILES = ['README.md', 'README.en.md', 'CLAUDE.md', 'AGENTS.md'];
const EXTS = new Set(['.md', '.mjs', '.js', '.ts', '.cjs', '.yaml', '.yml', '.sh', '.json']);

// 除外 path（履歴 / 生成物 / 意図的 fixture / worktree）
const EXCLUDE = [
  'node_modules',
  '.git/',
  '.claude/worktrees',
  '/build/',
  'CHANGELOG',
  'runners/github-action/dist',
  'tests/fixtures/sample-skills',
];

// 許容する旧形式 ID（意図的プレースホルダ / doc 例示 / 追跡中の移行対象）。
// TODO(follow-up PR): 下記のうち実在 skill を指すべきものは正しい簡素名へ移行し、本 allowlist を縮小する。
const ALLOWED_LEGACY_IDS = new Set([
  'rr-midstream-example-001', // skills/README.md の doc 例示
  'rr-midstream-newcheck-001', // eval-driven-skill-design の「新規 check 追加」例示
  'rr-midstream-code-quality-001', // create-skill.mjs のテンプレート例示
  'rr-midstream-performance-001', // setup script（要移行判定）
  'rr-midstream-performance-002', // setup script（要移行判定）
  'rr-midstream-plan-conformance-001', // plan-conformance-demo の期待値 fixture
  'rr-upstream-design-architecture-001', // setup script（要移行判定）
  'rr-upstream-pr-body-required-sections-001', // plangate-rule-promotion（要移行判定）
  'rr-upstream-test-code-react-001', // selection/tdd.yaml の例示
  'rr-upstream-test-code-unit-ts-jest-001', // selection/tdd.yaml の例示
]);

const OLD_ID_RE = /rr-(?:upstream|midstream|downstream)-[a-z0-9-]+-\d{3}/g;

function isExcluded(p) {
  return EXCLUDE.some((e) => p.includes(e));
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
    if (isExcluded(full)) continue;
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
  for (const f of SCAN_FILES) {
    const abs = join(ROOT, f);
    try {
      if (statSync(abs).isFile() && !isExcluded(abs)) files.push(abs);
    } catch {
      /* file absent: skip */
    }
  }
  return files;
}

const violations = [];
for (const file of collectFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    const matches = line.match(OLD_ID_RE);
    if (!matches) return;
    for (const m of matches) {
      if (ALLOWED_LEGACY_IDS.has(m)) continue;
      violations.push({ file: relative(ROOT, file), line: idx + 1, id: m });
    }
  });
}

if (violations.length > 0) {
  console.error(
    `❌ dangling skill-ID 参照を ${violations.length} 件検出（旧形式 rr-<phase>-<name>-NNN）:`
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.id}`);
  }
  console.error('\n旧形式 ID は簡素名（rr- 接頭辞・-NNN 無し）へ更新してください。');
  console.error(
    '意図的な例示/移行中の場合は scripts/check-skill-id-references.mjs の ALLOWED_LEGACY_IDS に追記。'
  );
  process.exit(1);
}

console.log('✅ dangling skill-ID 参照なし（scan 対象・allowlist 除く）');
