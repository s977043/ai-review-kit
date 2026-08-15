// ADR-006 の最重要不変条件の機械保証（#1859）。
//
//   Model Profile は Review Judgment を変更してはならない。
//   severity、GO / NO-GO、スキル選択、チームポリシーを profile 側に持たせない。
//
// 検査の主軸は **振る舞い** である。ソースに判断側の語が現れるかどうかでは、
// 次の 3 つを取り逃がす（いずれも実物で再現を確認済み）。
//
//   1. profile を `profiles/<name>/index.mjs` のようにサブディレクトリへ置く
//   2. profile 自体は無害なまま、`rendererId` で判断を書き換える renderer を指す
//   3. `String.fromCharCode` などで語を組み立てる / 値を関数 export にする
//
// そこで、profile を **再帰的に列挙**し、同一の既知 IR を全 profile へ通して、
// 判断側（`ir.judgment` / `ir.constraints`）に由来する行が profile 間で同一で
// あり、かつ IR に入れた値どおりであることを見る。renderer 経由の上書きも、
// 難読化された profile も、この形なら等しく落ちる。
//
// ソース走査は補助として残す。profile 階層に判断側の語が現れること自体が
// 設計の逸脱の兆候であり、振る舞い検査より読んで分かりやすいためである。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileReviewPrompt } from '../src/prompt/compiler.mjs';
import { buildReviewRequest } from '../src/prompt/review-request.mjs';
import { resolveProfile } from '../src/prompt/profile-resolver.mjs';

const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'prompt');
const PROFILES_DIR = path.join(PROMPT_DIR, 'profiles');

/** 再帰走査。サブディレクトリへ置いた profile を取り逃がさない。 */
function listSourcesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourcesRecursive(full));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(full);
  }
  return out.sort();
}

const profileFiles = listSourcesRecursive(PROFILES_DIR);
const relProfileFiles = profileFiles.map((f) =>
  path.relative(PROFILES_DIR, f).split(path.sep).join('/')
);

/**
 * 現時点で存在するべき profile。件数ではなくパスで pin する。
 * 3 本目を足すときはここへ 1 行足す（走査から漏れていないことの確認になる）。
 */
const EXPECTED_PROFILE_FILES = ['generic.mjs', 'openai.mjs'];

// --- 既知 IR。判断側の値をここで決め打ちし、profile がこれを動かせないことを見る ---

const KNOWN_MAX_FINDINGS = 8;
const KNOWN_SEVERITY = 'normal';
const KNOWN_FOCUS_HINT = 'Provide a balanced review covering important issues.';

/**
 * 判断側に由来する行。IR に入れた値から一意に決まり、profile が変えてはならない。
 * sections.mjs から import せずベタ書きする（実装から期待値を作らないため）。
 */
const JUDGMENT_DERIVED_LINES = [
  `- Limit to ${KNOWN_MAX_FINDINGS} findings. If there are no issues worth mentioning, reply with "NO_ISSUES".`,
  `- ${KNOWN_FOCUS_HINT}`,
  '- 厳格度 (normal): 重要度と再現性のバランスを取り、主要なリスクを指摘する',
  '- Use Severity: blocker|warning|nit and Confidence: high|medium|low.',
];

/** 判断側の値が変わったら必ず消える行（変異が「効いた」ことの対照に使う）。 */
const FORBIDDEN_WHEN_OVERRIDDEN = [
  '- 厳格度 (strict): 軽微な懸念も含めて網羅的に指摘する',
  '- Limit to 1 findings.',
];

function knownIR() {
  return buildReviewRequest({
    subject: { phase: 'midstream', changedFiles: [{ path: 'src/a.ts', hunks: [] }] },
    judgment: { skillIds: ['s1'], severity: KNOWN_SEVERITY, plan: { selected: [] } },
    context: { diff: 'KNOWN-DIFF-BODY' },
    constraints: {
      maxFindings: KNOWN_MAX_FINDINGS,
      focusHint: KNOWN_FOCUS_HINT,
      additionalInstructions: [],
    },
    outputContract: { language: 'ja' },
    execution: { provider: 'openai', model: 'gpt-4o-mini' },
  });
}

/** system message と user prompt を合わせた全文。配置の違いを吸収する。 */
function compiledText(profile) {
  const out = compileReviewPrompt(knownIR(), profile);
  return `${out.systemMessage}\n${out.prompt}`;
}

async function loadProfiles() {
  const loaded = [];
  for (const file of profileFiles) {
    const mod = await import(pathToFileURL(file).href);
    for (const [name, value] of Object.entries(mod)) {
      loaded.push({ file, name, value });
    }
  }
  return loaded;
}

// --- 走査そのものの健全性 ---

test('profile の走査が再帰的で、期待どおりのパスを拾っている', () => {
  assert.deepEqual(relProfileFiles, EXPECTED_PROFILE_FILES);
  for (const file of profileFiles) {
    assert.ok(fs.readFileSync(file, 'utf8').length > 0, `${file} is empty`);
  }
});

// --- 本丸: 振る舞いによる不変条件 ---

test('全 profile が同一 IR から同一の判断側の行を出す', async () => {
  const profiles = await loadProfiles();
  assert.ok(profiles.length >= 2, 'at least the two declared profiles must load');

  const texts = profiles.map(({ file, name, value }) => ({
    label: `${path.basename(file)}#${name}`,
    text: compiledText(value),
  }));

  for (const { label, text } of texts) {
    for (const line of JUDGMENT_DERIVED_LINES) {
      assert.ok(text.includes(line), `${label} lost a judgment-derived line: ${line}`);
    }
    for (const line of FORBIDDEN_WHEN_OVERRIDDEN) {
      assert.equal(text.includes(line), false, `${label} overrode review judgment: ${line}`);
    }
  }

  // 判断側の行だけを抜き出した射影が、profile 間で完全一致すること。
  const projections = texts.map(({ label, text }) => ({
    label,
    lines: text
      .split('\n')
      .filter(
        (l) =>
          /^- (Limit to |厳格度 |Severity focus |Use Severity:)/.test(l) ||
          l === `- ${KNOWN_FOCUS_HINT}`
      )
      .join('\n'),
  }));
  for (const p of projections) {
    assert.equal(p.lines, projections[0].lines, `${p.label} differs from ${projections[0].label}`);
  }
});

test('resolveProfile が返す profile も同じ判断側の行を出す', () => {
  // resolver 側に判断側の分岐を仕込まれた場合を、振る舞いで捕まえる。
  const providers = ['openai', 'anthropic', 'google', 'unknown', null];
  const projections = providers.map((provider) => ({
    provider,
    text: compiledText(resolveProfile({ provider })),
  }));
  for (const { provider, text } of projections) {
    for (const line of JUDGMENT_DERIVED_LINES) {
      assert.ok(text.includes(line), `provider=${provider} lost: ${line}`);
    }
    for (const line of FORBIDDEN_WHEN_OVERRIDDEN) {
      assert.equal(text.includes(line), false, `provider=${provider} overrode judgment: ${line}`);
    }
  }
});

test('IR の判断側の値を変えたときだけ出力が動く（検査が効いていることの対照）', () => {
  // 上の 2 テストが「何をしても緑」ではないことを示す。IR 側を strict /
  // maxFindings=1 にすれば、禁止行がちゃんと現れる。
  const ir = buildReviewRequest({
    subject: { phase: 'midstream', changedFiles: [] },
    judgment: { skillIds: [], severity: 'strict', plan: { selected: [] } },
    context: { diff: 'x' },
    constraints: { maxFindings: 1, focusHint: KNOWN_FOCUS_HINT, additionalInstructions: [] },
    outputContract: { language: 'ja' },
    execution: { provider: 'openai' },
  });
  const out = compileReviewPrompt(ir, resolveProfile({ provider: 'openai' }));
  const text = `${out.systemMessage}\n${out.prompt}`;
  for (const line of FORBIDDEN_WHEN_OVERRIDDEN) {
    assert.ok(text.includes(line), `control case should contain: ${line}`);
  }
});

// --- 補助: profile の形の検査 ---

test('profile の export は plain object のみで、関数を含まない', async () => {
  for (const { file, name, value } of await loadProfiles()) {
    const where = `${path.basename(file)}#${name}`;
    assert.equal(typeof value, 'object', `${where} must be a plain object`);
    assert.notEqual(value, null, `${where} must not be null`);
    assert.equal(Object.getPrototypeOf(value), Object.prototype, `${where} must be a plain object`);
    // 関数を持たせると JSON.stringify から消え、値側の検査を素通りする。
    const walk = (node, trail) => {
      for (const [key, child] of Object.entries(node)) {
        assert.notEqual(typeof child, 'function', `${where}${trail}.${key} must not be a function`);
        if (child && typeof child === 'object') walk(child, `${trail}.${key}`);
      }
    };
    walk(value, '');
  }
});

// --- 補助: ソース走査 ---

/**
 * 判断側の語。単語境界で見る（"unit" が nit に当たるような誤検出を避ける）。
 * renderer は対象にしない。renderer は IR の判断側の値を **読んで描画する**のが
 * 仕事であり、語が現れるのが正常だからである。renderer 経由の上書きは上の
 * 振る舞い検査が担当する。
 */
const JUDGMENT_TOKENS = [
  { label: 'severity', re: /\bseverit(y|ies)\b/i },
  { label: 'blocker', re: /\bblocker\b/i },
  { label: 'warning', re: /\bwarning\b/i },
  { label: 'nit', re: /\bnit\b/i },
  { label: 'critical', re: /\bcritical\b/i },
  { label: 'major', re: /\bmajor\b/i },
  { label: 'minor', re: /\bminor\b/i },
  { label: 'GO/NO-GO', re: /\bNO[-_ ]?GO\b/i },
  { label: 'gate decision', re: /\bgate(Decision|Result)?\b/i },
  { label: 'skill', re: /\bskills?\b/i },
  { label: 'skillIds', re: /\bskillIds?\b/i },
  { label: 'maxFindings', re: /\bmaxFindings\b/i },
  { label: 'team policy', re: /\bteamPolicy\b/i },
];

for (const file of profileFiles) {
  test(`判断側の語をソースに含まない: profiles/${path.relative(PROFILES_DIR, file)}`, () => {
    const source = fs.readFileSync(file, 'utf8');
    const hits = JUDGMENT_TOKENS.filter((token) => token.re.test(source)).map((t) => t.label);
    assert.deepEqual(hits, [], `references review-judgment concepts: ${hits.join(', ')}`);
  });
}

test('走査器そのものが機能している（判断側の語を入れた偽ソースを検出する）', () => {
  const fake = 'export const p = { severity: "blocker", skills: [] };';
  const hits = JUDGMENT_TOKENS.filter((token) => token.re.test(fake)).map((t) => t.label);
  assert.deepEqual(hits.sort(), ['blocker', 'severity', 'skill'].sort());
});
