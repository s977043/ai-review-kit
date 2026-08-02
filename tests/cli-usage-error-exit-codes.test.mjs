// tests/cli-usage-error-exit-codes.test.mjs
//
// #1709 Slice 1 で「現状のまま」機械固定した canary に、Slice 2（C2 -> exit 1）
// を反映したもの。
//
// ============================================================================
// ★ この表は Slice 2 適用後の実態の pin である（Slice 3 は未適用）。
// ============================================================================
//
// #1709 は「オプションエラーの exit code がコマンドごとにバラバラで、多くが
// exit 0 のまま成功扱いになる」という問題を扱う。Slice 1 時点の実測では 4 つの
// 契約に分裂していた（11 コマンド面 × 5 エラー種別 = 78 ケース、うち 57 件 =
// 73% が exit 0）。Slice 2 で C2（exit 0 + help 全文 stdout、34 件）を
// 「exit 1 + stderr 要約（Error 行 + usage 1 行 + full help への誘導）」へ
// 統一した（src/cli.mjs の usageError()）。
//
// 残る修正対象は C1（23 件、exit 0 のまま黙って無視）:
//
//   - Slice 3: C1（23 件）を exit 1 へ（未知オプション・余剰 positional の拒否）
//
// canary の役割は「正しさの主張」ではなく「変更の全量可視化」にある。
// 後続スライスでは *この表の差分 = 挙動変更の全量* という不変条件を保つこと。
// 期待値を書き換えるときは、必ず EXPECTED_CONTRACT_COUNTS も併せて更新する。
//
// ---------------------------------------------------------------------------
// #1721 で C2 に寄っていた 3 セルについて
// ---------------------------------------------------------------------------
// #1721（feedback add のオプション値を parse 時に検証する）で
// `feedback add --type`（値欠落）/ `--pr`（値欠落）/ `--pr abc`（不正値）の
// 3 セルが C2（exit 0 + help）に寄っていた（うち 1 件は exit 1 -> 0 の後退）。
// Slice 2 の一括統一で、この 3 セルも他の C2 と一緒に exit 1（C3）へ移った。
//
// なお #1721 が塞いだ入力パターンのうち、この 78 ケースに現れるのは上記 3 件で、
// 残り（`--skill` 欠落 / `--trigger --pr` / `--fingerprint --pr` / `--fingerprint ""`）は
// 本マトリクスの 5 エラー種別の組み合わせ外なので tests/cli-parse-args.test.mjs 側で
// 担保されている。
//
// 4 契約（`contract` フィールドの値）。C2 は Slice 2 で usage error からは
// 消滅し、正規の help 表示（`--help` / 引数なし）だけが対照群に残る:
//
//   | クラス | exit | help 全文が stdout | 内容                                       |
//   | ------ | ---- | ------------------ | ------------------------------------------ |
//   | C1     | 0    | no                 | メッセージすら出ず黙って無視。処理は続行   |
//   | C2     | 0    | yes                | help 全文を stdout（正規の help 表示のみ） |
//   | C3     | 1    | no                 | stderr にエラー（#1709 Slice 2 で統一）    |
//   | C4     | 3    | no                 | stderr にエラー（review 系のハンドラ検出） |
//
// 判定は (exit code, help 全文が stdout に出たか) の 2 軸だけで機械的に行う。
// stderr の文言（Error 行 + usage 要約）はここでは固定しない。
//
// 実行環境（決定論のための前提）:
//   隔離した一時 git repo を cwd にする。`skills/` と
//   `tests/fixtures/review-eval/cases.json` を置くのは、それらが無いと
//   `skills list` / `eval` が ENOENT で偶発的に exit 1 になり、usage error の
//   契約ではなく環境の欠落を pin してしまうため（実測で 5 セルが動いた）。
//   この 2 つを用意した状態が、実 repo で観測される契約と一致する。
//
// 実装コスト: 81 回の CLI 起動を before フックで 1 回だけ掃引し、各 test は
// その結果を参照するだけにしてある（in-process 実行で全掃引 ~2.5 秒）。

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test, { after, before, describe } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import { createTempGitRepo } from './helpers/temp-repo.mjs';

const HELP_MARKER = 'Usage: river <command> <path> [options]';

/** 観測された 4 契約。canary はこの 2 軸だけを判定する。 */
const CONTRACTS = {
  C1: { exit: 0, helpOnStdout: false, label: 'exit 0 / silently ignored' },
  C2: { exit: 0, helpOnStdout: true, label: 'exit 0 / full help on stdout' },
  C3: { exit: 1, helpOnStdout: false, label: 'exit 1 / error on stderr' },
  C4: { exit: 3, helpOnStdout: false, label: 'exit 3 / error on stderr' },
};

/**
 * 契約ごとの件数。表を編集したら必ずここも更新する
 * （= 挙動変更の総量をレビューで一目で見えるようにするための第 2 の錠）。
 */
const EXPECTED_CONTRACT_COUNTS = { C1: 23, C2: 0, C3: 53, C4: 2 };

/** 一時 repo 配下の「存在しないパス」に実行時に差し替えるプレースホルダ。 */
const NONEXISTENT_PATH = '<nonexistent-path>';

/**
 * 78 ケースの canary テーブル。
 * kind は #1709 のエラー種別 5 分類:
 *   value-missing / invalid-value / unknown-option / unknown-subcommand / surplus-positional
 */
const CASES = [
  // ---- river run ----
  { surface: 'run', kind: 'value-missing', argv: ['run', '.', '--base'], contract: 'C3' },
  { surface: 'run', kind: 'value-missing', argv: ['run', '.', '--max-cost'], contract: 'C3' },
  { surface: 'run', kind: 'value-missing', argv: ['run', '.', '--from'], contract: 'C1' },
  { surface: 'run', kind: 'invalid-value', argv: ['run', '.', '--depth', 'bogus'], contract: 'C3' },
  {
    surface: 'run',
    kind: 'invalid-value',
    argv: ['run', '.', '--output', 'bogus'],
    contract: 'C3',
  },
  { surface: 'run', kind: 'invalid-value', argv: ['run', '.', '--max-cost', '-1'], contract: 'C3' },
  { surface: 'run', kind: 'unknown-option', argv: ['run', '.', '--nope'], contract: 'C1' },
  { surface: 'run', kind: 'unknown-option', argv: ['run', '.', '--dry-runn'], contract: 'C1' },
  { surface: 'run', kind: 'surplus-positional', argv: ['run', '.', 'extra'], contract: 'C1' },

  // ---- river review plan ----
  {
    surface: 'review plan',
    kind: 'value-missing',
    argv: ['review', 'plan', '--plan-only', '--output-file'],
    contract: 'C3',
  },
  {
    surface: 'review plan',
    kind: 'value-missing',
    argv: ['review', 'plan', '--plan-only', '--artifacts-dir'],
    contract: 'C3',
  },
  {
    surface: 'review plan',
    kind: 'invalid-value',
    argv: ['review', 'plan', '--plan-only', '--output', 'bogus'],
    contract: 'C3',
  },
  {
    // C4 は本表に 2 件ある。こちらは共有パーサではなくハンドラ層
    // （src/lib/review-plan.mjs の resolveReviewOutputFormat）が検出するもの。
    // もう 1 件は下の `review route` / unknown-subcommand（`river review bogus`）で、
    // そちらは src/cli/commands/review.mjs のサブコマンド dispatch が検出しており、
    // 検出箇所が異なる。
    surface: 'review plan',
    kind: 'invalid-value',
    argv: ['review', 'plan', '--plan-only', '--output', 'html'],
    contract: 'C4',
  },
  {
    surface: 'review plan',
    kind: 'unknown-option',
    argv: ['review', 'plan', '--plan-only', '--nope'],
    contract: 'C1',
  },
  {
    surface: 'review plan',
    kind: 'surplus-positional',
    argv: ['review', 'plan', '.', 'extra', '--plan-only'],
    contract: 'C1',
  },

  // ---- river review exec ----
  {
    surface: 'review exec',
    kind: 'value-missing',
    argv: ['review', 'exec', '--dry-run', '--output-file'],
    contract: 'C3',
  },
  {
    surface: 'review exec',
    kind: 'invalid-value',
    argv: ['review', 'exec', '--dry-run', '--output', 'bogus'],
    contract: 'C3',
  },
  {
    surface: 'review exec',
    kind: 'unknown-option',
    argv: ['review', 'exec', '--dry-run', '--nope'],
    contract: 'C1',
  },
  {
    surface: 'review exec',
    kind: 'surplus-positional',
    argv: ['review', 'exec', '.', 'extra', '--dry-run'],
    contract: 'C1',
  },

  // ---- river review route ----
  {
    surface: 'review route',
    kind: 'value-missing',
    argv: ['review', 'route', '--format'],
    contract: 'C3',
  },
  {
    surface: 'review route',
    kind: 'invalid-value',
    argv: ['review', 'route', '--format', 'bogus'],
    contract: 'C3',
  },
  {
    surface: 'review route',
    kind: 'unknown-option',
    argv: ['review', 'route', '--nope'],
    contract: 'C1',
  },
  {
    // C4 の 2 件目。src/cli/commands/review.mjs のサブコマンド dispatch が返す。
    // 1 件目は上の `review plan` / invalid-value（`--output html`）で、そちらは
    // src/lib/review-plan.mjs が検出する。
    surface: 'review route',
    kind: 'unknown-subcommand',
    argv: ['review', 'bogus'],
    contract: 'C4',
  },
  {
    surface: 'review route',
    kind: 'surplus-positional',
    argv: ['review', 'route', '.', 'extra'],
    contract: 'C1',
  },

  // ---- river skills ----
  {
    surface: 'skills',
    kind: 'value-missing',
    argv: ['skills', 'list', '--source'],
    contract: 'C3',
  },
  {
    surface: 'skills',
    kind: 'value-missing',
    argv: ['skills', 'import', '--from'],
    contract: 'C1',
  },
  {
    surface: 'skills',
    kind: 'value-missing',
    argv: ['skills', 'resolve', '--path'],
    contract: 'C3',
  },
  {
    surface: 'skills',
    kind: 'invalid-value',
    argv: ['skills', 'list', '--source', 'bogus'],
    contract: 'C3',
  },
  { surface: 'skills', kind: 'unknown-option', argv: ['skills', 'list', '--nope'], contract: 'C1' },
  {
    // `bogus` はサブコマンドではなく対象 path として飲まれ、"Not a git repository"
    // で exit 1 になる。usage error として返しているわけではない（#1709 未決 7）。
    surface: 'skills',
    kind: 'unknown-subcommand',
    argv: ['skills', 'bogus'],
    contract: 'C3',
  },
  {
    surface: 'skills',
    kind: 'surplus-positional',
    argv: ['skills', 'list', 'extra'],
    contract: 'C1',
  },

  // ---- river runs ----
  { surface: 'runs', kind: 'value-missing', argv: ['runs', 'list', '--output'], contract: 'C3' },
  {
    surface: 'runs',
    kind: 'invalid-value',
    argv: ['runs', 'list', '--output', 'bogus'],
    contract: 'C3',
  },
  { surface: 'runs', kind: 'unknown-option', argv: ['runs', 'list', '--nope'], contract: 'C1' },
  { surface: 'runs', kind: 'unknown-subcommand', argv: ['runs', 'bogus'], contract: 'C3' },
  { surface: 'runs', kind: 'surplus-positional', argv: ['runs', 'list', 'extra'], contract: 'C1' },

  // ---- river feedback ----
  // Slice 1 時点は同一コマンド・同一エラー種別の中で 2 契約に割れている面だった
  // （#1709 が「世代間の非対称」として書いた問題が、実際にはコマンド内部の
  // 非対称でもあることの実例）。Slice 2 で value-missing / invalid-value は
  // C3 に揃った。
  {
    // #1721 で exit 1 -> exit 0 に後退していたセル。Slice 2 で exit 1 に戻った。
    surface: 'feedback',
    kind: 'value-missing',
    argv: ['feedback', 'add', '--type'],
    contract: 'C3',
  },
  {
    surface: 'feedback',
    kind: 'value-missing',
    argv: ['feedback', 'add', '--type', 'false_positive', '--skill', 's', '--run-id'],
    contract: 'C3',
  },
  {
    surface: 'feedback',
    kind: 'value-missing',
    argv: ['feedback', 'add', '--type', 'false_positive', '--skill', 's', '--reviewer'],
    contract: 'C3',
  },
  {
    // #1709 調査時点では C1（無言 + entry 書き込み、--pr が null に落ちる = B2）。
    // #1721 が parse 層で弾くようになり entry は書かれなくなり（C2）、
    // Slice 2 で exit 1（C3）になった。
    surface: 'feedback',
    kind: 'value-missing',
    argv: ['feedback', 'add', '--type', 'false_positive', '--skill', 's', '--pr'],
    contract: 'C3',
  },
  {
    surface: 'feedback',
    kind: 'invalid-value',
    argv: ['feedback', 'add', '--type', 'bogus', '--skill', 's'],
    contract: 'C3',
  },
  {
    surface: 'feedback',
    kind: 'invalid-value',
    argv: ['feedback', 'add', '--type', 'false_positive', '--skill', 's', '--run-id', '   '],
    contract: 'C3',
  },
  {
    // 同じく B2。#1721 前は --pr abc が黙って捨てられ entry が書き込まれていた。
    // #1721 で entry 書き込みが止まり（C1 -> C2）、Slice 2 で exit 1（C3）になった。
    surface: 'feedback',
    kind: 'invalid-value',
    argv: ['feedback', 'add', '--type', 'false_positive', '--skill', 's', '--pr', 'abc'],
    contract: 'C3',
  },
  {
    surface: 'feedback',
    kind: 'unknown-option',
    argv: ['feedback', 'add', '--type', 'false_positive', '--skill', 's', '--nope'],
    contract: 'C1',
  },
  {
    surface: 'feedback',
    kind: 'unknown-subcommand',
    argv: ['feedback', 'bogus'],
    contract: 'C3',
  },
  {
    surface: 'feedback',
    kind: 'surplus-positional',
    argv: ['feedback', 'add', 'extra', '--type', 'false_positive', '--skill', 's'],
    contract: 'C1',
  },

  // ---- river promote ----
  {
    surface: 'promote',
    kind: 'value-missing',
    argv: ['promote', 'propose', '--input'],
    contract: 'C3',
  },
  {
    surface: 'promote',
    kind: 'value-missing',
    argv: ['promote', 'propose', '--cluster-key'],
    contract: 'C3',
  },
  {
    surface: 'promote',
    kind: 'value-missing',
    argv: ['promote', 'approve', 'id1', '--approver'],
    contract: 'C3',
  },
  {
    surface: 'promote',
    kind: 'invalid-value',
    argv: ['promote', 'retire', '--threshold', '0'],
    contract: 'C3',
  },
  {
    surface: 'promote',
    kind: 'invalid-value',
    argv: ['promote', 'list', '--output', 'bogus'],
    contract: 'C3',
  },
  {
    // #1709 Slice 1 で明示的に追加が求められていた promoteUnknownOption のケース。
    surface: 'promote',
    kind: 'unknown-option',
    argv: ['promote', 'list', '--nope'],
    contract: 'C3',
  },
  { surface: 'promote', kind: 'unknown-subcommand', argv: ['promote', 'bogus'], contract: 'C3' },
  {
    surface: 'promote',
    kind: 'surplus-positional',
    argv: ['promote', 'list', 'extra'],
    contract: 'C1',
  },

  // ---- river evolve ----
  {
    surface: 'evolve',
    kind: 'value-missing',
    argv: ['evolve', 'aggregate', '--min'],
    contract: 'C3',
  },
  {
    surface: 'evolve',
    kind: 'value-missing',
    argv: ['evolve', 'replay', '--spec'],
    contract: 'C3',
  },
  {
    surface: 'evolve',
    kind: 'value-missing',
    argv: ['evolve', 'aggregate', '--month'],
    contract: 'C3',
  },
  {
    surface: 'evolve',
    kind: 'invalid-value',
    argv: ['evolve', 'aggregate', '--min', '0'],
    contract: 'C3',
  },
  {
    surface: 'evolve',
    kind: 'invalid-value',
    argv: ['evolve', 'aggregate', '--month', '2026-13-01'],
    contract: 'C3',
  },
  {
    surface: 'evolve',
    kind: 'invalid-value',
    argv: ['evolve', 'aggregate', '--output', 'yaml'],
    contract: 'C3',
  },
  {
    surface: 'evolve',
    kind: 'unknown-option',
    argv: ['evolve', 'aggregate', '--nope'],
    contract: 'C3',
  },
  { surface: 'evolve', kind: 'unknown-subcommand', argv: ['evolve', 'agregate'], contract: 'C3' },
  {
    surface: 'evolve',
    kind: 'surplus-positional',
    argv: ['evolve', 'aggregate', '.', 'extra'],
    contract: 'C3',
  },

  // ---- river suppression ----
  // Slice 1 時点で 5 種別すべてが C3 だった唯一の面。ただし必須オプション検証が
  // ハンドラ層に寄っている副産物であって、未知オプション自体を検出している
  // わけではない（`suppression add --nope` の stderr は "--fingerprint is required"）。
  {
    surface: 'suppression',
    kind: 'value-missing',
    argv: ['suppression', 'add', '--fingerprint'],
    contract: 'C3',
  },
  {
    surface: 'suppression',
    kind: 'value-missing',
    argv: ['suppression', 'add', '--feedback'],
    contract: 'C3',
  },
  {
    surface: 'suppression',
    kind: 'invalid-value',
    argv: ['suppression', 'add', '--fingerprint', 'fp', '--feedback', 'bogus', '--rationale', 'r'],
    contract: 'C3',
  },
  {
    surface: 'suppression',
    kind: 'invalid-value',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'fp',
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--scope',
      'bogus',
    ],
    contract: 'C3',
  },
  {
    surface: 'suppression',
    kind: 'unknown-option',
    argv: ['suppression', 'add', '--nope'],
    contract: 'C3',
  },
  {
    surface: 'suppression',
    kind: 'unknown-subcommand',
    argv: ['suppression', 'bogus'],
    contract: 'C3',
  },
  {
    surface: 'suppression',
    kind: 'surplus-positional',
    argv: ['suppression', 'add', 'extra'],
    contract: 'C3',
  },

  // ---- river doctor ----
  { surface: 'doctor', kind: 'value-missing', argv: ['doctor', '.', '--output'], contract: 'C3' },
  {
    surface: 'doctor',
    kind: 'invalid-value',
    argv: ['doctor', '.', '--output', 'bogus'],
    contract: 'C3',
  },
  { surface: 'doctor', kind: 'unknown-option', argv: ['doctor', '.', '--nope'], contract: 'C1' },
  { surface: 'doctor', kind: 'surplus-positional', argv: ['doctor', '.', 'extra'], contract: 'C1' },

  // ---- river eval ----
  {
    // 値欠落が既定 fixture への黙ったフォールバックになり PASS を出す。調査の B3。
    surface: 'eval',
    kind: 'value-missing',
    argv: ['eval', '--cases'],
    contract: 'C1',
  },
  {
    surface: 'eval',
    kind: 'invalid-value',
    argv: ['eval', '--cases', NONEXISTENT_PATH],
    contract: 'C3',
  },
  { surface: 'eval', kind: 'unknown-option', argv: ['eval', '--nope'], contract: 'C1' },
  { surface: 'eval', kind: 'surplus-positional', argv: ['eval', 'extra'], contract: 'C1' },
];

/**
 * 対照群。usage error ではないが、同じ 2 軸で挙動が決まるため一緒に固定する。
 * `--help` の exit 0 + stdout は .github/workflows/test.yml の `--help > /dev/null`
 * ガードが依存する不変条件で、S2/S3 でも変えてはならない。
 * `river bogus` は Slice 1 時点では C2（`Unknown command:` 分岐が到達不能な
 * dead code である症状 = 調査の B1）だったが、Slice 2 で parse 層が未知
 * コマンドを捕捉するようになり C3（exit 1 + stderr）が到達点になった。
 */
const CONTROL_CASES = [
  { surface: '(control)', kind: 'help-flag', argv: ['--help'], contract: 'C2', invariant: true },
  { surface: '(control)', kind: 'no-args', argv: [], contract: 'C2', invariant: true },
  {
    surface: '(control)',
    kind: 'unknown-command',
    argv: ['bogus'],
    contract: 'C3',
    invariant: true,
  },
];

// argv 要素には空白のみの値（`--run-id "   "`）が含まれるため、区切り文字連結だと
// 別ケースと衝突しうる。JSON 表現なら文字列配列に対して単射なので一意性が保たれる。
const caseKey = (c) => `${c.surface}|${c.kind}|${JSON.stringify(c.argv)}`;
const caseTitle = (c) =>
  `${c.surface} / ${c.kind} / \`river ${c.argv.join(' ')}\` -> ${c.contract} (${CONTRACTS[c.contract].label})`;

describe('#1709 canary: CLI usage-error exit codes (pinned to CURRENT behavior)', () => {
  /** @type {Map<string, { code: number, helpOnStdout: boolean }>} */
  const observed = new Map();
  /** @type {(() => Promise<void>) | null} */
  let cleanupRepo = null;

  before(async () => {
    const { dir, cleanup } = await createTempGitRepo({
      prefix: 'river-usage-exit-',
      initialFiles: {
        'a.txt': 'a\n',
        // `skills list` が ENOENT にならないための最小構成（上のヘッダー参照）。
        'skills/.gitkeep': '',
        // `eval` の既定 cases パス。空配列なら評価対象 0 件で正常終了する。
        'tests/fixtures/review-eval/cases.json': '[]\n',
      },
      changedFiles: { 'a.txt': 'a\nb\n' },
    });
    cleanupRepo = cleanup;

    const nonexistent = join(dir, 'no-such-cases.json');
    for (const testCase of [...CASES, ...CONTROL_CASES]) {
      const argv = testCase.argv.map((arg) => (arg === NONEXISTENT_PATH ? nonexistent : arg));
      // runCliInProcess は process.env / process.cwd をプロセス全体で差し替えるため、
      // Promise.all で並行実行してはならない（tests/helpers/README.md 参照）。
      const result = await runCliInProcess(argv, {
        cwd: dir,
        env: {
          RIVER_OFFLINE: '1',
          ANTHROPIC_API_KEY: '',
          OPENAI_API_KEY: '',
          NO_COLOR: '1',
          RIVER_PHASE: undefined,
          RIVER_PLANNER_MODE: undefined,
        },
      });
      observed.set(caseKey(testCase), {
        code: result.code,
        helpOnStdout: result.stdout.includes(HELP_MARKER),
      });
    }
  });

  after(async () => {
    if (cleanupRepo) await cleanupRepo();
  });

  // ---------------------------------------------------------------------------
  // テーブルそのものの健全性（転記ミス・重複の検出）
  // ---------------------------------------------------------------------------

  test('the matrix pins 78 usage-error cases and every row is unique', () => {
    assert.equal(CASES.length, 78, '#1709 の実測マトリクスは 78 ケース');
    const keys = new Set(CASES.map(caseKey));
    assert.equal(keys.size, CASES.length, '同一 (surface, kind, argv) の行が重複している');
    for (const testCase of CASES) {
      assert.ok(
        CONTRACTS[testCase.contract],
        `unknown contract class: ${testCase.contract} (${testCase.argv.join(' ')})`
      );
      assert.ok(
        [
          'value-missing',
          'invalid-value',
          'unknown-option',
          'unknown-subcommand',
          'surplus-positional',
        ].includes(testCase.kind),
        `unknown error kind: ${testCase.kind}`
      );
    }
  });

  test('the contract distribution is C1:23 / C2:0 / C3:53 / C4:2 (23 of 78 exit 0)', () => {
    const counts = { C1: 0, C2: 0, C3: 0, C4: 0 };
    for (const testCase of CASES) counts[testCase.contract] += 1;
    assert.deepEqual(
      counts,
      EXPECTED_CONTRACT_COUNTS,
      '契約ごとの件数が変わった。挙動変更の総量として意図したものか確認し、この期待値も更新すること'
    );
    const exitZero = counts.C1 + counts.C2;
    assert.equal(
      exitZero,
      23,
      'usage error のうち exit 0 で成功扱いになる件数（残る Slice 3 対象）'
    );
  });

  // ---------------------------------------------------------------------------
  // 78 ケースの本体
  // ---------------------------------------------------------------------------

  for (const testCase of CASES) {
    test(caseTitle(testCase), () => {
      const got = observed.get(caseKey(testCase));
      assert.ok(got, `before フックが結果を記録していない: ${caseKey(testCase)}`);
      const want = CONTRACTS[testCase.contract];
      assert.equal(
        got.code,
        want.exit,
        `exit code が ${testCase.contract} の期待 (${want.exit}) と違う`
      );
      assert.equal(
        got.helpOnStdout,
        want.helpOnStdout,
        `help 全文が stdout に出たか（${testCase.contract} の期待: ${want.helpOnStdout}）`
      );
    });
  }

  // ---------------------------------------------------------------------------
  // 対照群
  // ---------------------------------------------------------------------------

  for (const testCase of CONTROL_CASES) {
    test(caseTitle(testCase), () => {
      const got = observed.get(caseKey(testCase));
      assert.ok(got, `before フックが結果を記録していない: ${caseKey(testCase)}`);
      const want = CONTRACTS[testCase.contract];
      assert.equal(got.code, want.exit);
      assert.equal(got.helpOnStdout, want.helpOnStdout);
    });
  }
});
