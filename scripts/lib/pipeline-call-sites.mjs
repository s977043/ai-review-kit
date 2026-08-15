// docs/development/pipeline-params-checklist.md が挙げる call site 一覧と、
// リポジトリ内の実際の call site を機械照合するための測定ユーティリティ。
//
// 背景（CLAUDE.md「Propagate signatures」/ #1827）:
//   パイプライン関数（generateReview / buildPrompt / verifyFinding / buildExecutionPlan）は
//   複数の独立した call site から呼ばれ、単一の伝播点が無い。チェックリストは散文なので、
//   call site が新設されてもチェックリストに載らず、次にパラメータを足した人が
//   その call site を見落とす。実際 #933 で riskAssessment が転送されず undefined になった。
//
//   ここで機械化するのは「チェックリストが実体と一致していること」。
//   チェックリストが陳腐化して機能しなくなる経路を塞ぐ（= 見落としの上流を潰す）。
//   個々のパラメータが転送されているかの静的検査は本モジュールの範囲外
//   （呼び出しはすべて options オブジェクト 1 個で、必須 / 任意の区別が型に無いため
//   決定論では判定できない）。
//
// 照合は scripts/check-doc-enumerations.mjs の spec 経由で行い、
// npm run meta:validate → 必須チェック `Meta consistency` に載る。

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** 走査対象のルート（repo-relative）。 */
export const SCAN_ROOTS = ['src', 'runners', 'tests', 'scripts'];

/** 走査対象の拡張子。`.d.ts` も含める（型宣言もシグネチャ伝播先のため）。 */
const SOURCE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts']);

/** 走査から外すディレクトリ名。dist はビルド生成物で、編集対象ではない。 */
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git']);

/**
 * コメントと文字列リテラルの中身を空白に潰す。
 *
 * 散文中の `generateReview()` やテスト名の中の `buildExecutionPlan (...)` を
 * call site と誤認しないための前処理。
 *
 * 素朴な正規表現（`/\/\*[^]*?\*\//`）ではこのリポジトリで実際に誤動作する:
 *   - `// … \`src|app|lib/**\` …` という**行コメント内のグロブ**がブロックコメントの開始に見え、
 *     そこから次の閉じ記号までを丸ごとコメント扱いして本物の call site を消す
 *     （tests/heuristic-review.test.mjs で検出漏れとして再現した）。
 *   - テスト名の文字列 `'forwards skillIds to buildExecutionPlan (--skill-set …)'` が
 *     呼び出しとして拾われる（tests/cli-review-plan.test.mjs で誤検出として再現した）。
 * そのため文字列・テンプレート・コメントの状態を持つ 1 パスの走査にしている。
 *
 * 正規表現リテラルは状態として追跡する。`/` の直後が `/` か `*` のときだけ
 * コメント開始とみなすので `/^…/` がコメント扱いされることは無いが、それだけでは
 * **リテラルの中身が code として読まれる**ため、引用符を含む正規表現が状態を壊す。
 * 実際 `src/lib/review-engine.mjs` の
 * `String(name).replace(/[\[\]\`*_{}()#+\-.!|<>\n]/g, '')` は、文字クラス内の
 * バックティックでテンプレート状態へ入り、そこから次のバックティックまでの
 * 実 call site を丸ごと落としていた（`buildPrompt(` の検出が 0 件になる）。
 * 検出漏れは「チェックリストから行を消せ」という**逆向きの誤指示**として出るため、
 * 誤検出より危険である。
 *
 * 正規表現かどうかは直前の意味のある文字で判定する。`)` `]` および識別子・数値の
 * 直後の `/` は除算、それ以外は正規表現とみなす一般的なヒューリスティクスである。
 * `a / b` のような除算を誤って正規表現と読むと、そこから次の `/` までを潰して
 * しまうため、判定を緩める方向へは変更しないこと。
 *
 * 改行は保存する（行番号を保ちたい将来の用途のため）。
 *
 * @param {string} source
 * @returns {string}
 */
export function stripCommentsAndStrings(source) {
  const text = String(source ?? '');
  const out = [];
  /** @type {'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex'} */
  let state = 'code';
  // 正規表現の文字クラス `[...]` の内側では `/` が終端にならない（`/[/]/` が実例）。
  let inCharClass = false;
  // 直前に出力した「意味のある」文字。正規表現か除算かの判定にのみ使う。
  let lastSignificant = '';
  // 直前の識別子。`return /x/` のように**キーワードの直後**へ正規表現が来る形を
  // 除算と誤読しないために見る。誤読すると正規表現の中身が code として読まれ、
  // 中の引用符が文字列状態を開始して後続の call site を落とす（本モジュールが
  // 直したのと同じ事故が、キーワード経由で再発する）。
  let lastWord = '';

  /** 直後に正規表現リテラルが来うるキーワード。値を返す識別子とは区別する。 */
  const REGEX_PRECEDING_KEYWORDS = new Set([
    'return',
    'throw',
    'typeof',
    'instanceof',
    'in',
    'of',
    'new',
    'delete',
    'void',
    'case',
    'do',
    'else',
    'yield',
    'await',
  ]);

  const startsRegex = () => {
    if (lastSignificant === '') return true;
    // 識別子・数値・`)`・`]` の直後は原則として値であり、続く `/` は除算。
    if (!/[\w$)\]]/.test(lastSignificant)) return true;
    return REGEX_PRECEDING_KEYWORDS.has(lastWord);
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        out.push('  ');
        i += 1;
      } else if (ch === '/' && next === '*') {
        state = 'block';
        out.push('  ');
        i += 1;
      } else if (ch === '/' && startsRegex()) {
        state = 'regex';
        inCharClass = false;
        out.push(' ');
      } else if (ch === "'" || ch === '"' || ch === '`') {
        state = ch === "'" ? 'single' : ch === '"' ? 'double' : 'template';
        out.push(' ');
      } else {
        out.push(ch);
      }
      if (state === 'code' && !/\s/.test(ch)) {
        lastSignificant = ch;
        lastWord = /[\w$]/.test(ch) ? lastWord + ch : '';
      }
      continue;
    }

    if (state === 'regex') {
      if (ch === '\\') {
        out.push('  ');
        i += 1;
        continue;
      }
      if (ch === '[') inCharClass = true;
      else if (ch === ']') inCharClass = false;
      else if (ch === '/' && !inCharClass) {
        state = 'code';
        // リテラル終端。続く flags（`g` / `i` …）は識別子文字なので、
        // 直後の `/` を除算と読ませるためにも値として扱う。
        lastSignificant = ')';
        lastWord = '';
      }
      out.push(ch === '\n' ? '\n' : ' ');
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out.push('\n');
      } else {
        out.push(' ');
      }
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        out.push('  ');
        i += 1;
      } else {
        out.push(ch === '\n' ? '\n' : ' ');
      }
      continue;
    }

    // 文字列 / テンプレート。エスケープは 1 文字読み飛ばす。
    if (ch === '\\') {
      out.push('  ');
      i += 1;
      continue;
    }
    const closer = state === 'single' ? "'" : state === 'double' ? '"' : '`';
    if (ch === closer) {
      state = 'code';
      // 閉じた文字列は「値」である。直後の `/` は除算なので、正規表現の
      // 開始と誤読しないよう値扱いの印を残す（`` `a` / 2 `` が実例）。
      lastSignificant = ')';
      lastWord = '';
      out.push(' ');
    } else {
      out.push(ch === '\n' ? '\n' : ' ');
    }
  }

  return out.join('');
}

/**
 * ある識別子が「素の関数呼び出し / 関数宣言」として現れるか。
 *
 * `client.generateReview(` のようなメソッド呼び出しは除外する。AI クライアントの
 * `generateReview` はパイプライン関数と同名の別物であることが
 * pipeline-params-checklist.md にも明記されている。
 *
 * 開き括弧の直前の空白は許さない。prettier 整形後のコードで
 * `name (` と書かれることは無く、許すと散文（コメント・テスト名）由来の
 * 誤検出を増やすだけのため。
 *
 * @param {string} strippedSource コメント・文字列を除去済みのソース
 * @param {string} name
 * @returns {boolean}
 */
export function hasBareCall(strippedSource, name) {
  return new RegExp(String.raw`(?<![.\w$])${name}\(`).test(strippedSource);
}

/**
 * ディレクトリを再帰的に走査してソースファイルの repo-relative パスを返す。
 *
 * @param {string} relDir
 * @returns {Promise<string[]>}
 */
async function listSourceFiles(relDir) {
  const absolute = path.join(ROOT, relDir);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await listSourceFiles(path.posix.join(relDir, entry.name))));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push(path.posix.join(relDir, entry.name));
  }
  return files;
}

/**
 * 指定した関数名のいずれかを素の呼び出し / 宣言として含むファイルを列挙する。
 *
 * @param {string[]} names
 * @param {{ roots?: string[], readFile?: (rel: string) => Promise<string> }} [options]
 * @returns {Promise<Set<string>>} repo-relative パスの集合
 */
export async function findCallSiteFiles(names, { roots = SCAN_ROOTS, readFile } = {}) {
  const read = readFile ?? ((rel) => fs.readFile(path.join(ROOT, rel), 'utf8'));
  const found = new Set();
  for (const root of roots) {
    for (const file of await listSourceFiles(root)) {
      const stripped = stripCommentsAndStrings(await read(file));
      if (names.some((name) => hasBareCall(stripped, name))) found.add(file);
    }
  }
  return found;
}

/**
 * チェックリストの `### 必須: ...` 節から、各項目が挙げるファイルパスを拾う。
 *
 * 節の見出しは「対象関数名をバッククォートで含む `### ` 行」で特定する。
 * 見出しが見つからなければ null を返し、呼び出し元がマーカー消失としてエラーにする
 * （見つからないものを「一致」と扱うと検証が空振りするため）。
 *
 * ファイルパスで始まらない項目（「plan 経由で下流関数に渡される場合は…」のような
 * 手順の注意書き）は列挙対象ではないので読み飛ばす。パス判定は「`/` を含む
 * バッククォート付きトークンで項目が始まること」で行う。
 *
 * @param {string} text
 * @param {string} functionName 見出しに現れる関数名（例: 'buildExecutionPlan'）
 * @returns {Set<string> | null}
 */
export function parseChecklistPaths(text, functionName) {
  const lines = String(text ?? '').split('\n');
  const headingRe = new RegExp(String.raw`^###\s+.*\`${functionName}\``);
  const start = lines.findIndex((line) => headingRe.test(line));
  if (start < 0) return null;

  const paths = new Set();
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,3}\s/.test(lines[i])) break;
    const match = /^-\s+\[[ x]\]\s+`([^`]+)`/.exec(lines[i]);
    if (!match) continue;
    const candidate = match[1].trim();
    if (!candidate.includes('/')) continue;
    paths.add(candidate);
  }
  return paths.size > 0 ? paths : null;
}

/**
 * 照合対象のパイプライン関数グループ。
 *
 * doc のチェックリストは 3 節に分かれており、1 節が 1 グループに対応する。
 * heading は節見出しの特定に使い、names は実測（call site 走査）に使う。
 */
export const PIPELINE_FUNCTION_GROUPS = [
  { id: 'generate-review', heading: 'generateReview', names: ['generateReview', 'buildPrompt'] },
  { id: 'verify-finding', heading: 'verifyFinding', names: ['verifyFinding'] },
  {
    id: 'build-execution-plan',
    heading: 'buildExecutionPlan',
    names: ['buildExecutionPlan'],
  },
];
