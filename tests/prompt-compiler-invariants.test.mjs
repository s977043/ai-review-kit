// ADR-006 の最重要不変条件の機械保証（#1859）。
//
//   Model Profile は Review Judgment を変更してはならない。
//   severity、GO / NO-GO、スキル選択、チームポリシーを profile 側に持たせない。
//
// 検証方法: profile モジュールのソースを **列挙して走査**し、判断側の語が
// 現れないことを見る。特定のファイル名や期待文字列をハードコードして
// 「今ある 2 本だけ」を見る形にはしない。3 本目の profile が足された日に、
// 何もしなくてもこのテストが対象へ含めるようにするためである。
//
// 走査対象に profile-resolver.mjs も含める。resolver は profile を選ぶ層で
// あり、ここで判断側の値を見て分岐すると profile が判断へ触れるのと等価になる。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'prompt');
const PROFILES_DIR = path.join(PROMPT_DIR, 'profiles');

/**
 * 判断側の語。ADR-006「不変条件」が挙げる 4 種を、ソース上に現れる識別子へ
 * 落としたもの。単語境界で見る（"unit" が nit に、"monitor" が nit に当たる
 * ような誤検出を避ける）。
 */
const JUDGMENT_TOKENS = [
  // severity 語彙（内部語彙と出力スキーマの両方）
  { label: 'severity', re: /\bseverit(y|ies)\b/i },
  { label: 'blocker', re: /\bblocker\b/i },
  { label: 'warning', re: /\bwarning\b/i },
  { label: 'nit', re: /\bnit\b/i },
  { label: 'critical', re: /\bcritical\b/i },
  { label: 'major', re: /\bmajor\b/i },
  { label: 'minor', re: /\bminor\b/i },
  // GO / NO-GO
  { label: 'GO/NO-GO', re: /\bNO[-_ ]?GO\b/i },
  { label: 'gate decision', re: /\bgate(Decision|Result)?\b/i },
  // スキル選択
  { label: 'skill', re: /\bskills?\b/i },
  { label: 'skillIds', re: /\bskillIds?\b/i },
  // チームポリシー / 件数上限（constraints は判断側の持ち物）
  { label: 'maxFindings', re: /\bmaxFindings\b/i },
  { label: 'team policy', re: /\bteamPolicy\b/i },
];

function listSources(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

const profileFiles = listSources(PROFILES_DIR);
const scannedFiles = [...profileFiles, path.join(PROMPT_DIR, 'profile-resolver.mjs')];

test('profile モジュールが 1 本以上あり、走査が空振りしていない', () => {
  assert.ok(profileFiles.length >= 1, 'no profile module was found to scan');
  for (const file of scannedFiles) {
    assert.ok(fs.existsSync(file), `${file} does not exist`);
    assert.ok(fs.readFileSync(file, 'utf8').length > 0, `${file} is empty`);
  }
});

for (const file of scannedFiles) {
  test(`判断側の語を含まない: ${path.relative(PROMPT_DIR, file)}`, () => {
    const source = fs.readFileSync(file, 'utf8');
    const hits = JUDGMENT_TOKENS.filter((token) => token.re.test(source)).map((t) => t.label);
    assert.deepEqual(
      hits,
      [],
      `${path.relative(PROMPT_DIR, file)} references review-judgment concepts: ${hits.join(', ')}`
    );
  });
}

test('走査器そのものが機能している（判断側の語を入れた偽ソースを検出する）', () => {
  // 走査ロジックが常に空配列を返すだけの no-op になっていないことを確かめる。
  const fake = 'export const p = { severity: "blocker", skills: [] };';
  const hits = JUDGMENT_TOKENS.filter((token) => token.re.test(fake)).map((t) => t.label);
  assert.deepEqual(hits.sort(), ['blocker', 'severity', 'skill'].sort());
});

test('profile が公開する値は宣言だけである（判断側の値を含まない）', async () => {
  for (const file of profileFiles) {
    const mod = await import(file);
    for (const [name, value] of Object.entries(mod)) {
      const serialized = JSON.stringify(value);
      for (const token of JUDGMENT_TOKENS) {
        assert.equal(
          token.re.test(serialized),
          false,
          `exported ${name} in ${path.basename(file)} carries ${token.label}`
        );
      }
    }
  }
});
