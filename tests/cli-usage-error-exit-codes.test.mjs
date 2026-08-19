// tests/cli-usage-error-exit-codes.test.mjs
//
// #1709 Slice 1 で「現状のまま」機械固定した canary に、Slice 2（C2 -> exit 1）
// と Slice 3（C1 -> exit 1）を反映したもの。
//
// ============================================================================
// ★ この表は Slice 3 適用後の実態の pin である（#1709 の統一は完了形）。
// ============================================================================
//
// #1709 は「オプションエラーの exit code がコマンドごとにバラバラで、多くが
// exit 0 のまま成功扱いになる」という問題を扱う。Slice 1 時点の実測では 4 つの
// 契約に分裂していた（11 コマンド面 × 5 エラー種別 = 78 ケース、うち 57 件 =
// 73% が exit 0）。Slice 2 で C2（exit 0 + help 全文 stdout、34 件）を
// 「exit 1 + stderr 要約（Error 行 + usage 1 行 + full help への誘導）」へ
// 統一し（src/cli.mjs の usageError()）、Slice 3 で残る C1（23 件、exit 0 の
// まま黙って無視）を strict parse で同じ契約へ統一した（parseArgs 末尾の
// 未知オプション / 余剰 positional の catch-all と、値を取るオプションの
// 値欠落ガード）。
//
// Slice 3 では併せて、Slice 2 の敵対的レビューが見つけた canary 未収載の
// suppression の穴 2 件（`--scope` の値欠落 / `--pr abc` が exit 0 のまま
// エントリ書き込みまで発生）を表へ追加して pin した（78 -> 80 ケース）。
//
// ---------------------------------------------------------------------------
// v1.72.0（#1746）の回帰 hotfix で追加した 5 ケース（80 -> 85）
// ---------------------------------------------------------------------------
// Slice 3 の敵対的レビュー W2 が挙げた「値を取るのに値検証が無い」オプション
// 3 件（`--severity` / `--expires` / `--phase`）を invalid-value として pin した。
// `--severity BOGUS` と `--expires notadate` は exit 0 のまま
// `.river/memory/index.json` へ不正値を書き込んでいたため、下の「副作用ゼロ」
// 不変条件の対象でもある。
//
// 併せて W1（`<コマンド> <フラグ> <パス>` が exit 1 になる後方互換の回帰）を
// VALID_CASES 側へ pin した。Slice 3 時点の VALID_CASES 28 行はすべてパス先行
// だったため、この回帰を 1 行も検出できなかった。
//
// その hotfix 自身への敵対的レビュー（#1753）で 2 件を追加した:
//   - M2: `--expires` の検証が schema (`format: date-time`) より緩く、
//     `2027` / `March 5, 2027` を受理していた（invalid-value 2 件を CASES へ）
//   - B1: 列挙値オプションの大小無視を壊さないこと（VALID_CASES へ）
//
// ---------------------------------------------------------------------------
// #1755 / #1759 A1 で追加した 17 ケース（85 -> 102）と C4 -> C3 の 1 件
// ---------------------------------------------------------------------------
// #1755: `river review --gate exec` のようにサブコマンドをフラグの後ろへ置くと、
// そのトークンがパスとして飲まれて「サブコマンド無し」となり exit 3 = ESCALATE を
// 返していた。パス側で拾わずサブコマンドとして解決するようにし、残る本当の
// usage error（サブコマンド欠落 / 未知サブコマンド）は parse 層で exit 1 にした。
// これに伴い `river review bogus` が C4 -> C3 へ移り、C4 は
// `review plan --plan-only --output html`（ハンドラ層の設定エラー）1 件になる。
//
// #1759 A1: POSIX の `--` 終端が `Error: unknown option --.` で exit 1 になって
// いた（v1.71.1 では exit 0）。`--` 以降を positional path として読むようにした。
//
// **末尾の裸 `--`（後ろにトークンが無い形）は、全コマンド面で no-op として受理
// される。** パスを取らない面（`runs` / `promote` / `eval`）でも、書き込みを伴う面
// （`feedback add` / `suppression add`）でも同じで、BEFORE はいずれも
// `Error: unknown option --.` の exit 1 だった。したがって
// `feedback add --type X --skill Y --` のように、**BEFORE では usage error だった
// 形が AFTER では書き込みまで完了する**組み合わせが多数生じる。実測では、末尾の
// `--` を外した同一 argv と書き込み内容は同一であり、`--` が書き込みの中身を変える
// ことはない。書き込み系の代表 2 形を VALID_CASES に、`--` の後ろへオプション風
// トークンや余剰トークンを置いた形（書き込み前に落ちるべき形）を CASES に pin した。
//
// なお「任意の argv の末尾に `--` を足した形」は組み合わせ爆発するため、表には
// **コマンド面（サブコマンド）ごとに代表 1 形以上**を入れる方針で pin してある。
// 個別の argv ではなく上記のルール（末尾の裸 `--` = no-op）が不変条件である。
//
// ★ その帰結として、下の `no usage-error case leaves a write side effect` は
//   **この領域を構造的に検出できない**。あの不変条件は CASES（= usage error）の
//   掃引だけを対象にしており、usage error でなくなった形は定義上その掃引から
//   外れるためである。`--` を含む形の書き込み有無は、canary ではなく上記の
//   VALID_CASES の pin と PR #1761 の実測表で担保している。
//
// pin の範囲は「BEFORE(v1.72.2) と AFTER で exit code が変わる形の全量」で決めた。
// 109 形を両実装で機械掃引して差分を取り、変化した 37 形（サブコマンド語と同名の
// ディレクトリが cwd にある場合は 39 形）すべてを、exit code に応じて
// CASES / VALID_CASES / 対照群のいずれかへ収めている。掃引スクリプトの入力は
// 本ファイルの内容と同じ形の一覧で、変化の内訳は PR #1761 の本文に表として残した。
// #1746 W1 も #1753 B1 も「その書き方が表に無かった」ことが検出漏れの原因なので、
// 部分的な pin では同じ入口を開けたままにすることになる。
//
// canary の役割は「正しさの主張」ではなく「変更の全量可視化」にある。
// 今後の変更でも *この表の差分 = 挙動変更の全量* という不変条件を保つこと。
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
// 4 契約（`contract` フィールドの値）。C1 は Slice 3 で、C2 は Slice 2 で
// usage error からは消滅し、正規の help 表示（`--help` / 引数なし）だけが
// 対照群に残る:
//
//   | クラス | exit | help 全文が stdout | 内容                                       |
//   | ------ | ---- | ------------------ | ------------------------------------------ |
//   | C1     | 0    | no                 | メッセージすら出ず黙って無視（Slice 3 で消滅） |
//   | C2     | 0    | yes                | help 全文を stdout（正規の help 表示のみ） |
//   | C3     | 1    | no                 | stderr にエラー（#1709 Slice 2/3 で統一）  |
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
// 実装コスト: 116 回（CASES 108 + 対照群 8）の CLI 起動を before フックで
// 1 回だけ掃引し、各 test は
// その結果を参照するだけにしてある（in-process 実行で全掃引 ~2.5 秒）。

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test, { after, before, describe } from 'node:test';

import { parseArgs } from '../src/cli.mjs';
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
// #1797 で suppression の `--fingerprint-algo`（値欠落 / 不正値）2 件を追加し
// C3 が 101 -> 103 になった。
// #1759 C4（issue 側の C4 番号。本ファイルの contract C4 とは無関係）で
// `evolve aggregate --month` の月として不正な値（2026-13 / 2026-00）を
// invalid-value 2 件として追加し、C3 が 105 -> 107 になった。
const EXPECTED_CONTRACT_COUNTS = { C1: 0, C2: 0, C3: 107, C4: 1 };

/** 一時 repo 配下の「存在しないパス」に実行時に差し替えるプレースホルダ。 */
const NONEXISTENT_PATH = '<nonexistent-path>';

/**
 * 108 ケースの canary テーブル（Slice 1 の実測 78 + Slice 3 で pin した
 * suppression の穴 2 件 + #1746 回帰 hotfix で pin した値検証の穴 5 件
 * + #1755 で pin した review のサブコマンド欠落・未知 2 件
 * + #1759 C4 で pin した --month の不正な月 2 件）。
 * kind は #1709 のエラー種別 5 分類:
 *   value-missing / invalid-value / unknown-option / unknown-subcommand / surplus-positional
 */
const CASES = [
  // ---- river run ----
  { surface: 'run', kind: 'value-missing', argv: ['run', '.', '--base'], contract: 'C3' },
  { surface: 'run', kind: 'value-missing', argv: ['run', '.', '--max-cost'], contract: 'C3' },
  { surface: 'run', kind: 'value-missing', argv: ['run', '.', '--from'], contract: 'C3' },
  { surface: 'run', kind: 'invalid-value', argv: ['run', '.', '--depth', 'bogus'], contract: 'C3' },
  {
    surface: 'run',
    kind: 'invalid-value',
    argv: ['run', '.', '--output', 'bogus'],
    contract: 'C3',
  },
  { surface: 'run', kind: 'invalid-value', argv: ['run', '.', '--max-cost', '-1'], contract: 'C3' },
  {
    // #1746 W2 (3): `--phase BOGUS` は exit 0 のまま既定 (midstream) へ黙って
    // フォールバックし、打鍵した phase と違う phase をレビューしていた。
    surface: 'run',
    kind: 'invalid-value',
    argv: ['run', '.', '--phase', 'BOGUS'],
    contract: 'C3',
  },
  { surface: 'run', kind: 'unknown-option', argv: ['run', '.', '--nope'], contract: 'C3' },
  { surface: 'run', kind: 'unknown-option', argv: ['run', '.', '--dry-runn'], contract: 'C3' },
  { surface: 'run', kind: 'surplus-positional', argv: ['run', '.', 'extra'], contract: 'C3' },

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
    // #1755 以降、C4 は本表でこの 1 件だけ。ハンドラ層
    // （src/lib/review-plan.mjs の resolveReviewOutputFormat）が検出する設定
    // エラーであり、引数の打鍵ミスではない。かつては `river review bogus` も
    // C4 だったが、あれは usage error なので exit 1（C3）へ移した。
    surface: 'review plan',
    kind: 'invalid-value',
    argv: ['review', 'plan', '--plan-only', '--output', 'html'],
    contract: 'C4',
  },
  {
    surface: 'review plan',
    kind: 'unknown-option',
    argv: ['review', 'plan', '--plan-only', '--nope'],
    contract: 'C3',
  },
  {
    surface: 'review plan',
    kind: 'surplus-positional',
    argv: ['review', 'plan', '.', 'extra', '--plan-only'],
    contract: 'C3',
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
    contract: 'C3',
  },
  {
    surface: 'review exec',
    kind: 'surplus-positional',
    argv: ['review', 'exec', '.', 'extra', '--dry-run'],
    contract: 'C3',
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
    contract: 'C3',
  },
  {
    // #1755 で C4 -> C3。未知サブコマンドは usage error であり、exit 3 が意味する
    // ESCALATE ではない。検出も parseArgs 側へ移した。
    surface: 'review route',
    kind: 'unknown-subcommand',
    argv: ['review', 'bogus'],
    contract: 'C3',
  },
  {
    surface: 'review route',
    kind: 'surplus-positional',
    argv: ['review', 'route', '.', 'extra'],
    contract: 'C3',
  },

  // ---- river review（サブコマンド欠落・フラグ後置の未知サブコマンド）----
  // 以下 6 行はいずれも BEFORE（v1.72.2）が exit 3 だった形。#1755 の趣旨は
  // 「引数の打鍵ミスを ESCALATE(3) と読ませない」ことなので、6 形すべてを
  // 明示的に pin する。
  {
    // #1755 の残余ケース。フラグの後ろに置いたトークンが既知サブコマンドでない
    // ときは、パスとして飲み込んだうえで「サブコマンド無し」として exit 3 を
    // 返していた。exit 1 + 順序に言及するメッセージへ変更した。
    surface: 'review',
    kind: 'unknown-subcommand',
    argv: ['review', '--plan-only', 'bogus'],
    contract: 'C3',
  },
  {
    // サブコマンドを打ち忘れた形。旧: exit 3 + `Usage: river review plan --plan-only`。
    surface: 'review',
    kind: 'unknown-subcommand',
    argv: ['review', '--plan-only'],
    contract: 'C3',
  },
  { surface: 'review', kind: 'unknown-subcommand', argv: ['review'], contract: 'C3' },
  {
    // 旧実装は `.` をサブコマンドとして記録して「未知サブコマンド」と報告していた。
    surface: 'review',
    kind: 'unknown-subcommand',
    argv: ['review', '.'],
    contract: 'C3',
  },
  {
    surface: 'review',
    kind: 'unknown-subcommand',
    argv: ['review', '.', '--plan-only'],
    contract: 'C3',
  },
  {
    surface: 'review',
    kind: 'unknown-subcommand',
    argv: ['review', '--plan-only', '.'],
    contract: 'C3',
  },

  // ---- POSIX `--` 終端（#1759 A1 で導入した経路の usage error 側）----
  // `--` 以降は「パス」としか読まないため、パスとして成立しない入力はここで
  // 全部 exit 1 になる。正常系（exit 0）側は下の VALID_CASES で pin する。
  {
    // `--` の後ろのトークンは存在するパスでなければならない。この検証が無いと
    // `evolve aggregate -- nosuchdir` が「データ 0 件の正常な集計」として
    // exit 0 になり、打鍵ミスと区別できなかった（#1746 W2 と同型の穴）。
    surface: 'run',
    kind: 'invalid-value',
    argv: ['run', '--', NONEXISTENT_PATH],
    contract: 'C3',
  },
  {
    surface: 'evolve',
    kind: 'invalid-value',
    argv: ['evolve', 'aggregate', '--', NONEXISTENT_PATH],
    contract: 'C3',
  },
  {
    // `--` の後ろはオプションとして解釈しない。`--dry-run` はパス名として読まれ、
    // そのパスが無いので exit 1 になる（フラグとしては有効にならない）。
    // フラグ化していないことの直接証明は下の `--` 意味論テストが担う。
    surface: 'run',
    kind: 'invalid-value',
    argv: ['run', '--', '--dry-run'],
    contract: 'C3',
  },
  {
    // `--` の後ろでも「2 つ目以降の非オプション」は余剰 positional のまま。
    surface: 'run',
    kind: 'surplus-positional',
    argv: ['run', '--', '.', 'extra'],
    contract: 'C3',
  },
  {
    // パスを取らない面（`runs`）では `-- <path>` 自体が余剰 positional。
    surface: 'runs',
    kind: 'surplus-positional',
    argv: ['runs', '--', '.'],
    contract: 'C3',
  },
  {
    // `--` の後ろのサブコマンド語はサブコマンドにならない。この一時 repo には
    // `./list` が無いのでパスとしても成立せず exit 1。cwd に同名ディレクトリが
    // ある場合はパスとして解決され exit 0 になる（POSIX 準拠の帰結）。
    surface: 'skills',
    kind: 'invalid-value',
    argv: ['skills', '--', 'list'],
    contract: 'C3',
  },
  {
    // 同上。`./aggregate` が無いので exit 1。
    surface: 'evolve',
    kind: 'invalid-value',
    argv: ['evolve', '--', 'aggregate'],
    contract: 'C3',
  },
  {
    // `--` で明示したパスは「サブコマンドではない」と叱らない。`.` は実在する
    // のでパスとして受理され、残る欠落（サブコマンド無し）だけを報告する。
    surface: 'review',
    kind: 'unknown-subcommand',
    argv: ['review', '--', '.'],
    contract: 'C3',
  },
  {
    // 書き込み系の面で塞ぎ続けるべき失敗 (1): `--` の後ろのオプション風トークンを
    // オプションとして通してはならない。`feedback` はパスを取らないので、
    // `--type` は余剰 positional として弾かれ、エントリは書かれない。
    surface: 'feedback',
    kind: 'surplus-positional',
    argv: ['feedback', 'add', '--', '--type', 'false_positive', '--skill', 's'],
    contract: 'C3',
  },
  {
    // 同 (2): `--` の後ろの余剰トークンも従来どおり弾く（書き込み前に落ちる）。
    surface: 'feedback',
    kind: 'surplus-positional',
    argv: ['feedback', 'add', '--type', 'false_positive', '--skill', 's', '--', 'extra'],
    contract: 'C3',
  },
  {
    // 同上。`./plan` が無いので「パスが存在しない」として落ちる。`plan` を
    // 「サブコマンドではない」と報告してはならない（語彙に含まれるため矛盾する）。
    surface: 'review',
    kind: 'invalid-value',
    argv: ['review', '--', 'plan'],
    contract: 'C3',
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
    contract: 'C3',
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
  { surface: 'skills', kind: 'unknown-option', argv: ['skills', 'list', '--nope'], contract: 'C3' },
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
    contract: 'C3',
  },

  // ---- river runs ----
  { surface: 'runs', kind: 'value-missing', argv: ['runs', 'list', '--output'], contract: 'C3' },
  {
    surface: 'runs',
    kind: 'invalid-value',
    argv: ['runs', 'list', '--output', 'bogus'],
    contract: 'C3',
  },
  { surface: 'runs', kind: 'unknown-option', argv: ['runs', 'list', '--nope'], contract: 'C3' },
  { surface: 'runs', kind: 'unknown-subcommand', argv: ['runs', 'bogus'], contract: 'C3' },
  { surface: 'runs', kind: 'surplus-positional', argv: ['runs', 'list', 'extra'], contract: 'C3' },

  // ---- river feedback ----
  // Slice 1 時点は同一コマンド・同一エラー種別の中で 2 契約に割れている面だった
  // （#1709 が「世代間の非対称」として書いた問題が、実際にはコマンド内部の
  // 非対称でもあることの実例）。Slice 2 で value-missing / invalid-value が
  // C3 に揃い、Slice 3 で unknown-option / surplus-positional も C3 に揃った。
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
    contract: 'C3',
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
    contract: 'C3',
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
    contract: 'C3',
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
    // #1759 C4: the literal YYYY-MM shape matched but 13 is not a valid
    // month. BEFORE this was accepted silently (exit 0, contract C4-style
    // "no usage error"); AFTER it is a usage error like the other
    // --month invalid-value cases above.
    surface: 'evolve',
    kind: 'invalid-value',
    argv: ['evolve', 'aggregate', '--month', '2026-13'],
    contract: 'C3',
  },
  {
    // #1759 C4: same as above but for month 00 (not a valid 1-12 month).
    surface: 'evolve',
    kind: 'invalid-value',
    argv: ['evolve', 'aggregate', '--month', '2026-00'],
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
  // #1860 で足した `evolve prompt-compare`。サブコマンドを増やすと
  // strict parse の catch-all の効き方が面ごとに変わるため、aggregate と同じ
  // 2 形（未知オプション / 余剰 positional）をこの面でも pin する。
  {
    surface: 'evolve',
    kind: 'unknown-option',
    argv: ['evolve', 'prompt-compare', '--nope'],
    contract: 'C3',
  },
  {
    surface: 'evolve',
    kind: 'surplus-positional',
    argv: ['evolve', 'prompt-compare', '.', 'extra'],
    contract: 'C3',
  },

  // ---- river suppression ----
  // Slice 1 時点で 5 種別すべてが C3 だった唯一の面。ただし当時は必須オプション
  // 検証がハンドラ層に寄っている副産物で、未知オプション自体は検出していなかった
  // （`suppression add --nope` の stderr は "--fingerprint is required" だった）。
  // Slice 3 の strict parse で、未知オプションと値欠落は parse 層が検出する。
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
    // Slice 2 の敵対的レビューが見つけた canary 未収載の穴 (1): 末尾 --scope の
    // 値欠落が既定値 'file' に黙って落ち、exit 0 のままエントリが書き込まれていた。
    surface: 'suppression',
    kind: 'value-missing',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      '0123456789abcdef',
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--scope',
    ],
    contract: 'C3',
  },
  {
    // 同 (2): --pr の不正値が parseInt の NaN として黙って捨てられ、exit 0 の
    // ままエントリが書き込まれていた（feedback --pr と同型の穴）。
    surface: 'suppression',
    kind: 'invalid-value',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'fedcba9876543210',
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--pr',
      'abc',
    ],
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
    // #1797: `--fingerprint-algo` は値を取る新規オプション。値欠落を既定値へ
    // 黙って落とすと、利用者が v2 を指定したつもりで v1 のエントリが
    // 書き込まれる（Slice 2 の `--scope` の穴と同型）ため、parse 層で落とす。
    surface: 'suppression',
    kind: 'value-missing',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      '0123456789abcdef',
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--fingerprint-algo',
    ],
    contract: 'C3',
  },
  {
    // #1797: 不正値も parse 層で落とす。schema の
    // `$defs.fingerprintAlgo.enum` 外の値を書き込むと、applySuppressions が
    // fail-safe で無視するため「何も抑制しない suppression」が exit 0 で
    // 永続化される（`--severity BOGUS` と同型の穴）。
    surface: 'suppression',
    kind: 'invalid-value',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      '0123456789abcdef',
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--fingerprint-algo',
      'v9',
    ],
    contract: 'C3',
  },
  {
    // #1746 W2 (1): `--severity BOGUS` は exit 0 のまま
    // context.severity: "BOGUS" を永続化していた（suppression-context.schema.json
    // の severity enum が拒否する値）。
    surface: 'suppression',
    kind: 'invalid-value',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      '0123456789abcdef',
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--severity',
      'BOGUS',
    ],
    contract: 'C3',
  },
  {
    // #1746 W2 (2): `--expires notadate` は exit 0 のまま
    // context.expiresAt: "notadate" を永続化していた。失効判定は文字列比較
    // だったため、この値は永久に失効しない suppression になっていた。
    surface: 'suppression',
    kind: 'invalid-value',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'fedcba9876543210',
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--expires',
      'notadate',
    ],
    contract: 'C3',
  },
  {
    // #1753 の敵対的レビュー M2: `Date.parse` ベースの検証は緩すぎて
    // `2027` / `March 5, 2027` を受理し、schema (`format: date-time`) が拒否する
    // 値を書き込んでいた。RFC 3339 の date / date-time だけを受理する。
    surface: 'suppression',
    kind: 'invalid-value',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      '0123456789abcdef',
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--expires',
      '2027',
    ],
    contract: 'C3',
  },
  {
    surface: 'suppression',
    kind: 'invalid-value',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      '0123456789abcdef',
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--expires',
      'March 5, 2027',
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
  { surface: 'doctor', kind: 'unknown-option', argv: ['doctor', '.', '--nope'], contract: 'C3' },
  { surface: 'doctor', kind: 'surplus-positional', argv: ['doctor', '.', 'extra'], contract: 'C3' },

  // ---- river eval ----
  {
    // Slice 3 まで、値欠落が既定 fixture への黙ったフォールバックになり
    // PASS を出していた（調査の B3）。strict parse で exit 1 に統一。
    surface: 'eval',
    kind: 'value-missing',
    argv: ['eval', '--cases'],
    contract: 'C3',
  },
  {
    surface: 'eval',
    kind: 'invalid-value',
    argv: ['eval', '--cases', NONEXISTENT_PATH],
    contract: 'C3',
  },
  { surface: 'eval', kind: 'unknown-option', argv: ['eval', '--nope'], contract: 'C3' },
  { surface: 'eval', kind: 'surplus-positional', argv: ['eval', 'extra'], contract: 'C3' },
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
  // 自由記述オプションは `-` 始まりの値を受理する（誤拒否ガード）。strict parse は
  // 「値らしきトークンを弾く」ものではないという境界を、実行レベルで固定する。
  // この 2 ケースは正常系なのでエントリを書き込む。副作用ゼロの不変条件は
  // usage error 側（CASES）の掃引だけを対象にしているのはそのため。
  {
    surface: '(control)',
    kind: 'free-text-leading-dash',
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'abcdef0123456789',
      '--feedback',
      'false_positive',
      '--rationale',
      '-1 は誤検知',
    ],
    contract: 'C1',
    invariant: true,
  },
  {
    surface: '(control)',
    kind: 'free-text-leading-dash',
    argv: [
      'feedback',
      'add',
      '--type',
      'false_positive',
      '--skill',
      's',
      '--evidence',
      '-1 は誤検知',
    ],
    contract: 'C1',
    invariant: true,
  },
  // `--` を通したことで初めて到達可能になった「未実装」経路（#1759 A1）。
  // usage error ではないので CASES ではなく対照群に置く。BEFORE はいずれも
  // `Error: unknown option --.` の exit 1 で、`--` が通るようになった結果、
  // その面が元から持っていた exit 3（Phase 3 未実装）が表に出た。
  // **本 PR で exit 3 が増えるのはこの 3 形だけ**である。
  {
    surface: '(control)',
    kind: 'not-implemented',
    argv: ['review', 'plan', '--'],
    contract: 'C4',
    invariant: true,
  },
  {
    surface: '(control)',
    kind: 'not-implemented',
    argv: ['review', 'plan', '--', '.'],
    contract: 'C4',
    invariant: true,
  },
  {
    surface: '(control)',
    kind: 'not-implemented',
    argv: ['review', 'verify', '--'],
    contract: 'C4',
    invariant: true,
  },
];

/**
 * 対照群の契約ごとの件数。CASES の EXPECTED_CONTRACT_COUNTS と同じ役割の
 * 「第 2 の錠」で、対照群を足し引きしたら必ずここも更新する。
 */
const EXPECTED_CONTROL_CONTRACT_COUNTS = { C1: 2, C2: 2, C3: 1, C4: 3 };

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
  /** @type {string | null} */
  let repoDir = null;
  /** usage error 掃引（CASES）だけを終えた時点で `.river` が生まれたか。 */
  let riverExistsAfterErrorSweep = null;

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
    repoDir = dir;

    const nonexistent = join(dir, 'no-such-cases.json');
    const sweep = async (cases) => {
      for (const testCase of cases) {
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
    };

    // usage error（CASES）を先に掃引し、その時点の `.river` 有無を記録する。
    // 対照群には正常系（エントリを書き込む free-text ケース）が含まれるため、
    // 副作用ゼロの判定はこの順序でしか成立しない。
    await sweep(CASES);
    riverExistsAfterErrorSweep = existsSync(join(dir, '.river'));
    await sweep(CONTROL_CASES);
  });

  after(async () => {
    if (cleanupRepo) await cleanupRepo();
  });

  // ---------------------------------------------------------------------------
  // テーブルそのものの健全性（転記ミス・重複の検出）
  // ---------------------------------------------------------------------------

  test('the matrix pins 108 usage-error cases and every row is unique', () => {
    assert.equal(
      CASES.length,
      108,
      '#1709 の実測マトリクス 78 ケース + Slice 3 で pin した suppression の穴 2 件 + #1746 W2 の値検証 3 件 + #1753 M2 の --expires 2 件 + #1755 の review サブコマンド 2 件 + #1797 の --fingerprint-algo 2 件 + #1860 の evolve prompt-compare 2 件 + #1759 C4 の --month 不正な月 2 件'
    );
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

  // 成功側にも同じ pin を置く。CASES（失敗側）だけが件数で守られていて
  // VALID_CASES に assertion が無い状態が続いていたが、v1.72.0 の
  // 「フラグ先行形を拒否」も v1.72.1 の「`--phase Upstream` を誤拒否」も
  // 壊したのは**成功側**であり、守りが薄いのは逆だった。行を消すだけで
  // 黙って保護が減るのを防ぐ。
  test('the success-side table pins 86 legitimate argv forms', () => {
    assert.equal(
      VALID_CASES.length,
      86,
      'コマンド面ごとの正常形: run 12 / doctor 5 / skills 13 / runs 7 (#1759 B2 で1行追加) / review 19 / eval 2 / feedback 2 / suppression 6 / promote 6 / evolve 11 (#1759 C4 で --month 2026-01 / 2026-12 の境界値 2行追加) / help 2 / コマンド無し 1'
    );
  });

  test('the contract distribution is C1:0 / C2:0 / C3:107 / C4:1 (0 of 108 exit 0)', () => {
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
      0,
      'usage error が exit 0 で成功扱いになる経路は #1709 Slice 3 で全廃した。復活は後退'
    );
  });

  // ---------------------------------------------------------------------------
  // 108 ケースの本体
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

  // ---------------------------------------------------------------------------
  // 副作用ゼロの不変条件（#1709 Slice 3）
  // ---------------------------------------------------------------------------

  // ★ 適用範囲の限界（#1759 A1 で生じた）: この不変条件は CASES の掃引だけを
  //   見ているため、「usage error でなくなった形」は定義上その外に出る。末尾の
  //   裸 `--` は全面で no-op として受理されるようになったので、
  //   `feedback add --type X --skill Y --` のように BEFORE は exit 1 で
  //   書き込みも起きなかった形が、AFTER では書き込みまで完了する。この領域は
  //   本テストでは検出できない（前文の該当節を参照）。
  test('no usage-error case leaves a write side effect (.river must not exist)', () => {
    // 表の 106 ケースはすべて usage error であり、Slice 3 の原則は「データ
    // 書き込みは全入力検証後に行う」。suppression の穴 2 件は Slice 3 まで、
    // #1746 W2 の `--severity BOGUS` / `--expires notadate` は v1.72.0 まで、
    // exit 0 のまま .river/memory/index.json へエントリを書き込んでいた。
    // 掃引後に .river が存在しないことで「検証前の副作用ゼロ」を機械固定する。
    assert.ok(repoDir, 'before フックが temp repo を記録していない');
    assert.equal(
      riverExistsAfterErrorSweep,
      false,
      'usage error の掃引が .river 配下へ書き込んだ（検証前の副作用が復活している）'
    );
  });

  test('the control-case distribution is C1:2 / C2:2 / C3:1 / C4:3', () => {
    const counts = { C1: 0, C2: 0, C3: 0, C4: 0 };
    for (const testCase of CONTROL_CASES) counts[testCase.contract] += 1;
    assert.deepEqual(
      counts,
      EXPECTED_CONTROL_CONTRACT_COUNTS,
      '対照群の件数が変わった。意図した変更か確認し、この期待値も更新すること'
    );
  });

  test('a free-text option value starting with `-` is accepted and written', () => {
    // 誤拒否の再発検知。exit 0 だけでなく、実際にエントリが書かれたことまで見る
    // （parse で受理しても handler 手前で落ちていたら意味がないため）。
    assert.ok(repoDir, 'before フックが temp repo を記録していない');
    assert.equal(
      existsSync(join(repoDir, '.river')),
      true,
      '自由記述の値を受理する正常系がエントリを書き込んでいない'
    );
  });
});

// -----------------------------------------------------------------------------
// 正常系フラグの誤拒否ガード（#1709 Slice 3）
// -----------------------------------------------------------------------------
//
// strict parse の catch-all（未知オプション / 余剰 positional の拒否）が、
// 正当な既存フラグまで誤って弾いていないことを、全コマンド面 × 代表的な
// 正常系フラグ組み合わせの table test で固定する。判定は parseArgs の
// usageError フラグ（と promote / evolve のハンドラ委譲フィールド）で行い、
// 実行時の副作用を持ち込まない。
const VALID_CASES = [
  { argv: ['run', '.'], command: 'run' },
  {
    argv: [
      'run',
      '.',
      '--dry-run',
      '--debug',
      '--explain',
      '--estimate',
      '--phase',
      'midstream',
      '--planner',
      'off',
      '--output',
      'json',
      '--base',
      'main',
      '--depth',
      'standard',
      '--skill-set',
      'basic',
      '--save',
      '--offline',
      '--fail-on',
      'critical',
      '--warn-on',
      'major',
      '--max-cost',
      '0.5',
      '--context',
      'diff,fullFile',
      '--dependency',
      'code_search',
      '--reviewers',
      'auto',
      '--baseline',
      './baseline.json',
    ],
    command: 'run',
  },
  { argv: ['run', '.', '--rules-only', '--advisory-only'], command: 'run' },
  { argv: ['run', '.', '--gate', '--fail-on', 'major'], command: 'run' },
  { argv: ['doctor', '.', '--output', 'json'], command: 'doctor' },
  { argv: ['skills', '.', '--phase', 'upstream'], command: 'skills' },
  { argv: ['skills', 'list', '--source', 'all'], command: 'skills' },
  {
    argv: ['skills', 'import', '--from', './some-dir', '--dry-run', '--loose'],
    command: 'skills',
  },
  {
    argv: ['skills', 'export', '--to', './out', '--include-assets', '--strict'],
    command: 'skills',
  },
  { argv: ['skills', 'resolve', '--path', 'a.js', '--path', 'b.js'], command: 'skills' },
  { argv: ['runs', 'list', '--output', 'json'], command: 'runs' },
  { argv: ['runs', 'diff', 'id1', 'id2', 'id3'], command: 'runs' },
  {
    // #1759 B2: `--output json` written BEFORE the run IDs used to be
    // swallowed as runId1/runId2 ("--output" became a run ID, "json" the
    // other), leaving `output` at its default `text`. Pin the option and the
    // two run IDs resolving correctly regardless of order.
    argv: ['runs', 'diff', '--output', 'json', 'r1', 'r2'],
    command: 'runs',
    expect: { runsId1: 'r1', runsId2: 'r2', output: 'json' },
  },
  { argv: ['runs', 'summary'], command: 'runs' },
  { argv: ['runs', 'digest'], command: 'runs' },
  {
    argv: [
      'review',
      'plan',
      '--plan-only',
      '--output-file',
      './plan.json',
      '--summary-file',
      './summary.md',
      '--quiet',
      '--artifacts-dir',
      './artifacts',
      '--artifact',
      'plan=./p.md',
      '--format',
      'json',
    ],
    command: 'review',
  },
  { argv: ['review', 'exec', '--dry-run', '--plan', './plan.json'], command: 'review' },
  { argv: ['review', 'verify', '--plan', './plan.json'], command: 'review' },
  {
    argv: ['review', 'route', '.', '--format', 'markdown', '--base', 'main'],
    command: 'review',
  },
  { argv: ['eval', '--cases', './cases.json', '--verbose'], command: 'eval' },
  {
    argv: [
      'feedback',
      'add',
      '--type',
      'false_positive',
      '--skill',
      's',
      '--trigger',
      't',
      '--fingerprint',
      'fp',
      '--evidence',
      'e',
      '--pr',
      '12',
      '--reviewer',
      'r',
      '--model',
      'm',
      '--reversed-by',
      'x',
      '--run-id',
      'rid',
    ],
    command: 'feedback',
  },
  {
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'a'.repeat(16),
      '--feedback',
      'false_positive',
      '--rationale',
      'flagged but acceptable',
      '--scope',
      'subsystem',
      '--severity',
      'minor',
      '--files',
      'src/a.ts,src/b.ts',
      '--expires',
      '2027-01-01',
      '--pr',
      '123',
    ],
    command: 'suppression',
  },
  {
    // #1797: 行番号込みの fingerprint（v2）はオプトイン。既定の v1 を壊さずに
    // 受理されること（= このオプションを足したことで既存の suppression add の
    // 契約が変わっていないこと）を pin する。
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'b'.repeat(16),
      '--feedback',
      'false_positive',
      '--rationale',
      'line-anchored suppression',
      '--fingerprint-algo',
      'v2',
    ],
    command: 'suppression',
    expect: { suppressionFingerprintAlgo: 'v2' },
  },
  {
    argv: [
      'promote',
      'propose',
      '--input',
      './fb.jsonl',
      '--cluster-key',
      'skill::false_positive',
      '--policy-version',
      'v1',
      '--threshold',
      '2',
      '--index',
      './index.json',
      '--dry-run',
    ],
    command: 'promote',
  },
  { argv: ['promote', 'list', '--output', 'json', '--include-inactive'], command: 'promote' },
  {
    argv: ['promote', 'approve', 'id1', '--approver', 'me', '--reason', 'ok'],
    command: 'promote',
  },
  { argv: ['promote', 'retire', '--threshold', '1'], command: 'promote' },
  {
    argv: ['promote', 'review-effectiveness', 'id1', '--feedback-root', './fb'],
    command: 'promote',
  },
  {
    argv: ['evolve', 'aggregate', '.', '--min', '2', '--month', '2026-07', '--output', 'json'],
    command: 'evolve',
  },
  {
    // #1759 C4: lower boundary of a valid month (01) must keep succeeding.
    argv: ['evolve', 'aggregate', '.', '--month', '2026-01'],
    command: 'evolve',
  },
  {
    // #1759 C4: upper boundary of a valid month (12) must keep succeeding.
    argv: ['evolve', 'aggregate', '.', '--month', '2026-12'],
    command: 'evolve',
  },
  {
    argv: [
      'evolve',
      'replay',
      '--spec',
      './spec.json',
      '--expect-manifest',
      'm1',
      '--output',
      'json',
    ],
    command: 'evolve',
  },
  // #1860: `prompt-compare` は aggregate と同じくパスを取る面である。パス先行と
  // フラグ先行の両方を pin する（#1746 / v1.72.0 の回帰形をこの面でも塞ぐ）。
  {
    argv: ['evolve', 'prompt-compare', '.', '--output', 'json'],
    command: 'evolve',
    target: '.',
  },
  {
    argv: ['evolve', 'prompt-compare', '--output', 'json', '.'],
    command: 'evolve',
    target: '.',
  },
  { argv: ['--help'], command: 'help' },
  { argv: ['-h'], command: 'help' },

  // ---------------------------------------------------------------------------
  // `<コマンド> <フラグ> <パス>`（#1746 / v1.72.0 の回帰を pin する）
  // ---------------------------------------------------------------------------
  // 上の 28 行はすべてパス先行（`run . --dry-run`）だったため、POSIX 慣用の
  // フラグ先行順が Slice 3 の catch-all に余剰 positional として弾かれる回帰を
  // 1 行も検出できなかった。パスを取るコマンド面すべてについてフラグ先行形を
  // 固定する。`target` も併せて見るのは、「usage error にならなかった」だけでは
  // パスが正しく target になったことの証拠にならないため。
  // ---------------------------------------------------------------------------
  // 列挙値オプションの大小無視（#1753 の敵対的レビュー B1）
  // ---------------------------------------------------------------------------
  // `--phase Upstream` は v1.72.0 まで exit 0 で、`normalizePhase`
  // (src/lib/local-runner.mjs) が小文字化して upstream として正しく機能していた。
  // #1753 の初版が大小区別の検証を入れて誤拒否したのが B1 で、canary にも既存
  // テストにも大文字入力のケースが無かったことが見逃した原因。同じ語彙を扱う
  // `--fail-on` / `--warn-on` が大小無視である以上、`--severity` も揃える。
  { argv: ['run', '.', '--phase', 'Upstream'], command: 'run', expect: { phase: 'upstream' } },
  { argv: ['run', '.', '--phase', 'UPSTREAM'], command: 'run', expect: { phase: 'upstream' } },
  { argv: ['run', '.', '--fail-on', 'CRITICAL'], command: 'run', expect: { failOn: 'critical' } },
  {
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'a'.repeat(16),
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--severity',
      'Critical',
    ],
    command: 'suppression',
    expect: { suppressionSeverity: 'critical' },
  },
  {
    // #1797: 新規の列挙値オプションも同じ規約に乗せる。初版は大小区別で
    // `--fingerprint-algo V2` を exit 1 にしており、`--severity Critical` は
    // 通るのにこれだけ落ちるという非対称になっていた（B1 と同型）。
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'a'.repeat(16),
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--fingerprint-algo',
      'V2',
    ],
    command: 'suppression',
    expect: { suppressionFingerprintAlgo: 'v2' },
  },
  {
    // RFC 3339 date-time はそのまま（ミリ秒付き ISO へ正規化される）。
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'a'.repeat(16),
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--expires',
      '2027-01-01T00:00:00Z',
    ],
    command: 'suppression',
    expect: { suppressionExpiresAt: '2027-01-01T00:00:00.000Z' },
  },

  // ---------------------------------------------------------------------------
  // `river review <フラグ> <サブコマンド>`（#1755 を pin する）
  // ---------------------------------------------------------------------------
  // v1.72.1 まで、この 3 形はサブコマンド語がパスとして飲まれて exit 3
  // （= --gate の ESCALATE と同じコード）になっていた。正しい順序（下の 3 行）は
  // 影響を受けなかったため、両方を並べて pin する。フラグ後置形だけを足すと、
  // 逆方向の回帰（正しい順序が壊れる）を検出できないため。
  { argv: ['review', '--gate', 'exec'], command: 'review', expect: { reviewSubcommand: 'exec' } },
  {
    argv: ['review', '.', 'route'],
    command: 'review',
    target: '.',
    expect: { reviewSubcommand: 'route' },
  },
  {
    argv: ['review', '--plan-only', 'plan', '.'],
    command: 'review',
    target: '.',
    expect: { reviewSubcommand: 'plan' },
  },
  {
    argv: ['review', '--plan-only', '.', 'plan'],
    command: 'review',
    target: '.',
    expect: { reviewSubcommand: 'plan' },
  },
  {
    // サブコマンド解決後の 2 つ目の非オプションはパスになる（`review plan
    // --plan-only extra` が v1.72.2 でも exit 0 だったのと同じ扱い）。
    argv: ['review', '--plan-only', 'plan', 'extra'],
    command: 'review',
    target: 'extra',
    expect: { reviewSubcommand: 'plan' },
  },
  {
    argv: ['review', '--format', 'json', 'route'],
    command: 'review',
    expect: { reviewSubcommand: 'route' },
  },
  {
    argv: ['review', '--plan-only', 'plan'],
    command: 'review',
    expect: { reviewSubcommand: 'plan' },
  },
  { argv: ['review', 'exec', '--gate'], command: 'review', expect: { reviewSubcommand: 'exec' } },
  {
    argv: ['review', 'route', '--format', 'json'],
    command: 'review',
    expect: { reviewSubcommand: 'route' },
  },
  {
    argv: ['review', 'plan', '--plan-only'],
    command: 'review',
    expect: { reviewSubcommand: 'plan' },
  },
  {
    // サブコマンドはパスの後ろでも解決する（`review . plan`）。旧実装は `.` を
    // サブコマンドとして記録していた。
    argv: ['review', '.', 'plan', '--plan-only'],
    command: 'review',
    target: '.',
    expect: { reviewSubcommand: 'plan' },
  },

  // ---------------------------------------------------------------------------
  // POSIX の `--` 終端（#1759 A1 を pin する）
  // ---------------------------------------------------------------------------
  // v1.71.1 では通っていた `river run -- .` が、Slice 3 の strict parse 以降
  // `Error: unknown option --.` で exit 1 になっていた。パスを取る 5 面すべてを
  // 固定する。`--` の後ろはオプション風トークンでもパスとして読む（それが `--`
  // の存在理由）ことも併せて pin する。
  { argv: ['run', '--', '.'], command: 'run', target: '.' },
  { argv: ['doctor', '--', '.'], command: 'doctor', target: '.' },
  { argv: ['skills', '--', '.'], command: 'skills', target: '.' },
  { argv: ['evolve', 'aggregate', '--', '.'], command: 'evolve', target: '.' },
  { argv: ['evolve', '--', '.'], command: 'evolve', target: '.' },
  {
    argv: ['review', 'plan', '--plan-only', '--', '.'],
    command: 'review',
    target: '.',
    expect: { reviewSubcommand: 'plan' },
  },
  // 裸の `--`（後ろにトークンが無い形）は POSIX どおり無害な no-op。BEFORE は
  // どの面でも `Error: unknown option --.` で exit 1 だった。パスを取らない面
  // （`runs` / `promote` / `eval`）とコマンド未指定でも同じく通る。
  { argv: ['run', '--'], command: 'run', target: '.' },
  { argv: ['run', '.', '--'], command: 'run', target: '.' },
  { argv: ['doctor', '--'], command: 'doctor', target: '.' },
  { argv: ['doctor', '.', '--'], command: 'doctor', target: '.' },
  { argv: ['skills', '--'], command: 'skills', target: '.' },
  { argv: ['skills', '.', '--'], command: 'skills', target: '.' },
  { argv: ['skills', 'list', '--'], command: 'skills' },
  { argv: ['skills', 'import', '--from', './x', '--'], command: 'skills' },
  { argv: ['skills', 'export', '--to', './y', '--'], command: 'skills' },
  { argv: ['skills', 'resolve', '--path', 'a.js', '--'], command: 'skills' },
  { argv: ['review', 'route', '--'], command: 'review', expect: { reviewSubcommand: 'route' } },
  {
    argv: ['review', 'exec', '--dry-run', '--'],
    command: 'review',
    expect: { reviewSubcommand: 'exec' },
  },
  { argv: ['runs', '--'], command: 'runs' },
  { argv: ['runs', 'list', '--'], command: 'runs' },
  { argv: ['evolve', '--'], command: 'evolve' },
  { argv: ['evolve', 'aggregate', '--'], command: 'evolve' },
  { argv: ['promote', 'list', '--'], command: 'promote' },
  { argv: ['eval', '--'], command: 'eval' },
  // 書き込み系の面も同じく受理する。BEFORE は exit 1 で書き込みも起きなかったので、
  // この 2 形は「usage error だったものが書き込みを伴う正常系になる」変化を持つ。
  // 実測では、末尾の `--` を外した同一 argv と書き込み内容は同じ（`.river` 配下
  // 1 ファイル）で、`--` が書き込み内容を変えることはない。
  {
    argv: ['feedback', 'add', '--type', 'false_positive', '--skill', 's', '--'],
    command: 'feedback',
    expect: { feedbackType: 'false_positive' },
  },
  {
    argv: [
      'suppression',
      'add',
      '--fingerprint',
      'a'.repeat(16),
      '--feedback',
      'false_positive',
      '--rationale',
      'r',
      '--',
    ],
    command: 'suppression',
    expect: { suppressionRationale: 'r' },
  },
  // コマンド未指定 + 裸の `--` は help 表示（`river` 単体と同じ exit 0）。
  { argv: ['--'], command: null },

  { argv: ['run', '--dry-run', '.'], command: 'run', target: '.' },
  {
    // 値を取るオプションの値（`main`）を positional と誤認しないこと。
    argv: ['run', '--base', 'main', '--depth', 'standard', './sub'],
    command: 'run',
    target: './sub',
  },
  { argv: ['doctor', '--debug', '.'], command: 'doctor', target: '.' },
  { argv: ['skills', '--phase', 'upstream', '.'], command: 'skills', target: '.' },
  { argv: ['review', 'route', '--format', 'json', '.'], command: 'review', target: '.' },
  { argv: ['evolve', 'aggregate', '--min', '2', '.'], command: 'evolve', target: '.' },
];

describe('#1709 Slice 3: legitimate flag combinations are not rejected by strict parse', () => {
  for (const validCase of VALID_CASES) {
    test(`river ${validCase.argv.join(' ')} parses without a usage error`, () => {
      const parsed = parseArgs(validCase.argv);
      assert.equal(parsed.usageError, false, 'usageError が立った（正常系フラグの誤拒否）');
      assert.equal(parsed.command, validCase.command);
      if (validCase.target !== undefined) {
        assert.equal(parsed.target, validCase.target, 'パスが target として解釈されていない');
      }
      for (const [field, want] of Object.entries(validCase.expect ?? {})) {
        assert.equal(parsed[field], want, `${field} の正規化結果が期待と違う`);
      }
      // promote / evolve はハンドラ委譲フィールド経由で拒否するため併せて確認。
      assert.equal(parsed.promoteUnknownOption, null);
      assert.equal(parsed.evolveUnknownOption, null);
      assert.deepEqual(parsed.evolveExtraArgs, []);
    });
  }
});

// -----------------------------------------------------------------------------
// POSIX `--` 終端の意味論（#1759 A1）
// -----------------------------------------------------------------------------
//
// VALID_CASES / CASES は exit code と usageError しか見ないため、「`--` の後ろの
// `--dry-run` がフラグとして有効になっていない」ことの直接証明にはならない
// （どちらの実装でも exit 1 になりうる）。ここで parse 結果のフィールドまで見る。
describe('#1759 A1: `--` ends option parsing', () => {
  test('a flag-looking token after `--` is not activated as a flag', () => {
    const parsed = parseArgs(['run', '--', '--dry-run']);
    assert.equal(parsed.dryRun, false, '`--` の後ろの --dry-run がフラグとして有効になった');
    // パスとして読んだ結果、実在しないので usage error になる（CASES 側で pin 済み）。
    assert.equal(parsed.usageError, true);
  });

  test('a bare trailing `--` is a no-op and does not consume the path', () => {
    const parsed = parseArgs(['run', '.', '--']);
    assert.equal(parsed.usageError, false);
    assert.equal(parsed.target, '.');
    assert.equal(parsed.dryRun, false);
  });

  test('`--` does not turn a subcommand word into a subcommand', () => {
    // `./plan` はこのリポジトリに存在しないため usage error になり、
    // reviewSubcommand は null のまま（パスとしてしか読まない証拠）。
    const parsed = parseArgs(['review', '--', 'plan']);
    assert.equal(parsed.usageError, true);
    assert.equal(parsed.reviewSubcommand, null);
  });
});

// -----------------------------------------------------------------------------
// 自由記述オプションの `-` 始まり値（#1709 Slice 3 のレビュー指摘 minor-3）
// -----------------------------------------------------------------------------
//
// 自由記述の値を取るオプションは `--rationale` / `--evidence` / `--reason` の 3 つ。
// パス・列挙値・ID・数値のオプション（`--input` / `--scope` / `--pr` など）は
// 従来の厳しいガード（`-` 始まりを値欠落とみなす）を維持する。
describe('#1709 Slice 3: free-text options accept a leading dash', () => {
  const FREE_TEXT_CASES = [
    {
      label: 'suppression --rationale',
      argv: [
        'suppression',
        'add',
        '--fingerprint',
        'abcdef0123456789',
        '--feedback',
        'false_positive',
        '--rationale',
        '-1 は誤検知',
      ],
      field: 'suppressionRationale',
    },
    {
      label: 'feedback --evidence',
      argv: [
        'feedback',
        'add',
        '--type',
        'false_positive',
        '--skill',
        's',
        '--evidence',
        '-1 は誤検知',
      ],
      field: 'feedbackEvidence',
    },
    {
      label: 'promote --reason',
      argv: ['promote', 'approve', 'id1', '--approver', 'me', '--reason', '-1 件は誤検知だった'],
      field: 'promoteReason',
    },
  ];

  for (const freeTextCase of FREE_TEXT_CASES) {
    test(`${freeTextCase.label} accepts a value starting with '-'`, () => {
      const parsed = parseArgs(freeTextCase.argv);
      assert.equal(parsed.usageError, false, '正当な自由記述の値を誤って拒否した');
      assert.equal(parsed[freeTextCase.field], freeTextCase.argv.at(-1));
    });

    test(`${freeTextCase.label} still rejects a truly missing value`, () => {
      const parsed = parseArgs(freeTextCase.argv.slice(0, -1));
      assert.equal(parsed.usageError, true, '値欠落（次トークンなし）は従来どおり usage error');
      assert.equal(parsed[freeTextCase.field], null);
    });

    test(`${freeTextCase.label} does not swallow a following known flag (#1717)`, () => {
      // 緩和しても塞ぎ続けるべき失敗: `--evidence --pr 123` が
      // evidence:"--pr" を記録して pr を落とす（#1717）。
      const argv = [...freeTextCase.argv.slice(0, -1), '--debug'];
      const parsed = parseArgs(argv);
      assert.equal(parsed.usageError, true, '認識済みフラグを値として飲み込んだ');
      assert.equal(parsed[freeTextCase.field], null);
    });
  }

  test('path / enum / id options keep the strict leading-dash guard', () => {
    const strictCases = [
      { argv: ['promote', 'propose', '--input', '-notapath'], field: 'promoteInput' },
      { argv: ['run', '.', '--base', '-notaref'], field: 'base' },
      { argv: ['evolve', 'replay', '--spec', '-notafile'], field: 'evolveSpec' },
      {
        argv: [
          'suppression',
          'add',
          '--fingerprint',
          'abcdef0123456789',
          '--feedback',
          'false_positive',
          '--rationale',
          'r',
          '--severity',
          '-minor',
        ],
        field: 'suppressionSeverity',
      },
    ];
    for (const strictCase of strictCases) {
      const parsed = parseArgs(strictCase.argv);
      assert.equal(
        parsed.usageError,
        true,
        `${strictCase.argv.join(' ')} は厳しいガードを維持するはず`
      );
      assert.equal(parsed[strictCase.field], null);
    }
  });
});
