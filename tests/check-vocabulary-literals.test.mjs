import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractVocabulary, analyzeFile } from '../scripts/check-vocabulary-literals.mjs';

// check-vocabulary-literals.mjs のガード挙動を、一時 fixture を cwd にして実プロセス実行で
// 検証する。positive（検出される）と negative（誤検出しない canary）の両方を持つ
// （.claude/rules/review-core.md の責務分界 #1070）。
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'check-vocabulary-literals.mjs'
);

const VOCAB_MODULE = `export const ASK_RELEVANCE = Object.freeze({
  IN_ASK: 'in-ask',
  UNCERTAIN: 'uncertain',
  OUT_OF_ASK: 'out-of-ask',
});

export function noop() {}
`;

function runIn(dir) {
  try {
    execFileSync('node', [SCRIPT], { cwd: dir, stdio: 'pipe' });
    return 0;
  } catch (e) {
    if (typeof e.status === 'number') return e.status;
    throw e;
  }
}

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-vocab-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

function withFixture(files, fn) {
  const dir = fixture(files);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('語彙値の直書きを検出して exit 1（#2021 の実例と同形）', () => {
  withFixture(
    {
      'src/lib/vocab.mjs': VOCAB_MODULE,
      'src/lib/runner.mjs':
        "import { ASK_RELEVANCE } from './vocab.mjs';\n" +
        "export const fallback = { askRelevance: 'uncertain' };\n" +
        'export const ok = ASK_RELEVANCE.IN_ASK;\n',
    },
    (dir) => assert.equal(runIn(dir), 1)
  );
});

test('複数行 import でも結合を解決して違反を検出する（exit 1）', () => {
  // IMPORT_RE の `[^'"]*?` は否定文字クラスなので改行にもマッチし、named import が
  // 改行で折り返された形（実コードの標準形）でも import 元を解決できる。この挙動は
  // 検出器の要であり、`[^'"\n]*?` のような「読みやすい」書き換えで静かに壊れるため
  // 回帰テストで固定する。
  withFixture(
    {
      'src/lib/vocab.mjs': VOCAB_MODULE,
      'src/lib/runner.mjs':
        'import {\n' +
        '  ASK_RELEVANCE,\n' +
        '  noop,\n' +
        "} from './vocab.mjs';\n" +
        "export const fallback = { askRelevance: 'uncertain' };\n" +
        'export const ok = ASK_RELEVANCE.IN_ASK;\n' +
        'noop();\n',
    },
    (dir) => assert.equal(runIn(dir), 1)
  );
});

test('canary: 語彙モジュールを import していないファイルの同一文字列は誤検出しない', () => {
  withFixture(
    {
      'src/lib/vocab.mjs': VOCAB_MODULE,
      'src/lib/unrelated.mjs': "export const status = 'uncertain';\n",
    },
    (dir) => assert.equal(runIn(dir), 0)
  );
});

test('canary: 語彙モジュール自身の定義行は誤検出しない', () => {
  withFixture({ 'src/lib/vocab.mjs': VOCAB_MODULE }, (dir) => assert.equal(runIn(dir), 0));
});

test('canary: コメント行の言及と行末 vocab-literal-ignore は誤検出しない', () => {
  withFixture(
    {
      'src/lib/vocab.mjs': VOCAB_MODULE,
      'src/lib/runner.mjs':
        "import { ASK_RELEVANCE } from './vocab.mjs';\n" +
        "// fallback は 'uncertain' を意味する\n" +
        "export const legacy = 'uncertain'; // vocab-literal-ignore\n" +
        'export const ok = ASK_RELEVANCE.UNCERTAIN;\n',
    },
    (dir) => assert.equal(runIn(dir), 0)
  );
});

test('canary: 一般語（GENERIC_VALUES）は import 結合していても誤検出しない', () => {
  withFixture(
    {
      'src/lib/vocab.mjs':
        "export const LEVEL = Object.freeze({\n  ERROR: 'error',\n  WARNING: 'warning',\n});\n",
      'src/lib/runner.mjs':
        "import { LEVEL } from './vocab.mjs';\n" +
        "export const label = 'error';\n" +
        'export const ok = LEVEL.WARNING;\n',
    },
    (dir) => assert.equal(runIn(dir), 0)
  );
});

test('canary: tests/** は走査対象外（期待値としてのリテラルは正しい）', () => {
  withFixture(
    {
      'src/lib/vocab.mjs': VOCAB_MODULE,
      'tests/vocab.test.mjs':
        "import { ASK_RELEVANCE } from '../src/lib/vocab.mjs';\n" +
        "export const expected = 'uncertain';\n" +
        'export const ok = ASK_RELEVANCE.UNCERTAIN;\n',
    },
    (dir) => assert.equal(runIn(dir), 0)
  );
});

test('extractVocabulary: 文字列値のみのオブジェクトを抽出し、非文字列値は無視する', () => {
  const vocab = extractVocabulary(VOCAB_MODULE);
  assert.equal(vocab.get('uncertain'), 'ASK_RELEVANCE.UNCERTAIN');
  assert.equal(vocab.get('in-ask'), 'ASK_RELEVANCE.IN_ASK');

  const mixed = extractVocabulary(
    "export const WEIGHTS = Object.freeze({\n  a: 1,\n  b: 'x-value',\n});\n"
  );
  assert.equal(mixed.size, 0);
});

test('analyzeFile: 違反は file / line / 参照式を報告する', () => {
  const vocabByFile = new Map([['src/lib/vocab.mjs', extractVocabulary(VOCAB_MODULE)]]);
  const found = analyzeFile(
    'src/lib/runner.mjs',
    "import { ASK_RELEVANCE } from './vocab.mjs';\nconst x = 'out-of-ask';\n",
    vocabByFile
  );
  assert.equal(found.length, 1);
  assert.deepEqual(
    { line: found[0].line, value: found[0].value, ref: found[0].ref },
    { line: 2, value: 'out-of-ask', ref: 'ASK_RELEVANCE.OUT_OF_ASK' }
  );
});
