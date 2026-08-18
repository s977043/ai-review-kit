# `--reviewers` フラグリファレンス

> **スコープ注意**: このページは `river run` の `--reviewers` フラグと検証コマンドのみを扱います。
>
> - `river run` の全フラグ（`--phase` / `--planner` / `--dry-run` / `--output` / `--max-cost` / `--debug` / `--estimate` など）は **[stable-interfaces.md](./stable-interfaces.md)** を参照してください。
> - W-check で使用する `river review exec` のフラグ（`--artifact`, `--ensemble`, `--phase`）は **[W-check ガイド](../guides/w-check.md)** および **[cli-review-exec-spec.md](./cli-review-exec-spec.md)** を参照してください。

Runner CLI を使用して、River Review のエージェントとスキルをローカルまたは CI で検証します。
軽量な Python ランナーが `schemas/output.schema.json` に従う構造化されたレビュー結果を出力します。
Python の例を実行する前に、`pip install jsonschema` で必要な依存関係をインストールしてください。

## `--reviewers` フラグ

`river run` の `--reviewers` フラグにはロール名のリスト（カンマ区切り）または特殊キーワード `auto` を指定できます。

### `auto` キーワード

`--reviewers auto` を指定すると、diff の内容を解析してレビュアーロールを自動選択します。`bug-hunter` は常に含まれ、以下のシグナルに基づいて追加ロールが加わります。

| シグナル                                                                                                                      | 追加されるロール      |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| config / schema / migration / infra ファイルが変更されている、またはリスク評価済みファイルが存在する                          | `security-scanner`    |
| test ファイルが変更されている、または app ファイルが 3 件以上ある                                                             | `test-gap`            |
| package manifest / lockfile（`package.json` / `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`）が変更されている          | `dependency-reviewer` |
| UI / コンポーネント / スタイル（`.tsx` / `.jsx` / `.css` / `.scss` / `.sass` / `.less` / `.vue` / `.svelte`）が変更されている | `frontend-reviewer`   |
| `.github/workflows/` 配下のワークフローが変更されている                                                                       | `ci-cd-reviewer`      |

シグナルが何もない場合は `bug-hunter` のみが使われます。

JSON 出力の `autoSelectedRoles` フィールドで選択されたロールを確認できます。

```json
{
  "autoSelectedRoles": ["bug-hunter", "security-scanner"]
}
```

### 大きな diff の分割と findings の重複排除

複数のロール（`auto` を含む）でレビューする場合、大きな diff は自動的にチャンクに分割され、ロール × チャンクで並列実行されます。各実行から得られた findings は、最終 ID を割り当てる前にチャンク・ロール間で重複排除されます（実装: `src/lib/reviewer-orchestrator.mjs` の `splitDiffIntoChunks` / `deduplicateFindings`）。このため、同一箇所の重複指摘は 1 件に統合されます。

### 進捗出力とロール単位タイムアウト

並列ロール実行では、ロールの開始・完了・失敗を 1 行ずつ **stderr** に出力します。成果物は stdout に出るため、進捗行が JSON / YAML / Markdown を汚すことはありません。

```text
Reviewer bug-hunter: start
Reviewer security-scanner: start
Reviewer bug-hunter: done in 6.2s (3 findings)
Reviewer security-scanner: timeout after 120.0s (other chunks/roles continue)
Reviewers: 1/2 roles succeeded, 0 failed, 120.0s total (timed out: security-scanner)
```

関連するフラグと環境変数は次のとおりです。

| 名前                     | 種別   | 既定値                                | 説明                                                                                                                                           |
| ------------------------ | ------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--quiet`                | flag   | `false`                               | 上記のロール進捗行だけを抑止する。`river run` が出す他のログ（実行ヘッダーや `Run saved:` など）には作用しない                                 |
| `RIVER_REVIEWER_TIMEOUT` | env    | 未設定                                | ロール 1 件あたりの上限ミリ秒。`1`〜`3600000` の整数のみ受理し、範囲外・非整数は警告のうえ無視する（`review.orchestrator.timeoutMs` より優先） |
| `review.orchestrator.*`  | config | `timeoutMs` 未設定 / `progress: true` | `.river-review.json` 側の同等設定。詳細は [コンフィグ / スキーマ概要](./config-schema.md) を参照                                               |

ロール単位のタイムアウトは既定で無効（無制限）です。**既定のままなら待ち時間は従来と変わりません**。この PR で変わるのは観測性だけであり、上限を明示的に設定した場合にのみ打ち切りが働きます。

タイムアウトは fail-soft であり、上限に達したロールを失敗として記録したうえで、残りのロールの findings で処理を続行します。全体を中断しません。**成功ロールが 1 件も無い場合は「レビュー未実行」として扱い**、gate は GO になりません（`decision` は `human-review-required`、`--gate` の終了コードは 0 以外）。

打ち切りの事実は次の場所から観測できます。

| 経路                                 | 見える場所                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `--output json`                      | top-level の `timedOutRoles`（打ち切られたロール名の配列。1 件も無ければキー自体が出ない）                |
| run record（`--save` / CI 自動保存） | `reviewDebug.timeoutMs` / `reviewDebug.timedOutRoles` / `reviewDebug.durationMs`                          |
| ライブラリとして呼ぶ場合             | `reviewerResults[].timedOut` / `reviewerResults[].durationMs`、および `debug.*`（上記 run record と同じ） |

`--output yaml` と `--output html` には打ち切り情報を載せていません。機械可読な判定には JSON 出力を使ってください。

> **注意**: タイムアウトはオーケストレーション層の待ち時間を打ち切るだけであり、進行中の LLM 呼び出しを cancel しません。放置されたリクエストは `src/lib/llm-pipeline.mjs` 側の上限（1 回 15 秒 + 上限付きリトライ、最大およそ 45 秒）が尽きるまで走り続けるため、`timeout` 行を出した後もプロセスはその間だけ生存します。真のキャンセルには `generateReview()` への `AbortSignal` 導入が必要であり、本 PR のスコープ外です。

## コマンド

- Agents: `npm run agents:validate` (または `node scripts/validate-agents.mjs`)
- Skills: `npm run skills:validate` (または `node scripts/validate-skills.mjs`)
- 構造化出力 (Python): `python scripts/rr_runner.py --input tests/fixtures/structured-output/sample_llm_response.json`

## 終了コード

### `river run` / `src/cli.mjs`

| コード | 意味                                                                                      |
| ------ | ----------------------------------------------------------------------------------------- |
| `0`    | 正常終了                                                                                  |
| `1`    | 実行エラー・スキーマエラー・引数エラー（不明コマンド / オプション値の欠落・不正値を含む） |
| `2`    | `--warn-on` の警告しきい値超過                                                            |
| `3`    | `--gate` の ESCALATE 判定、`review` ハンドラの設定エラー、`review` の未実装サブコマンド   |

引数エラー（usage error）の exit code は #1709 で exit 1 + stderr 要約へ統一されました。不明コマンドとオプション値の欠落・不正値は Slice 2 で統一済みです。未知オプション・余剰 positional・残っていた値欠落経路（例: `--from` / `--cases`）も Slice 3 で統一されました。help 全文の stdout 出力と exit 0 の組み合わせは、明示的な `--help` と引数なし起動だけが維持します。

`river review` のサブコマンド欠落・未知サブコマンドも #1755 で exit 1 へ移しました。exit 3 が残るのは、引数の書き方ではなく次の 3 系統です。

- `--gate` の ESCALATE 判定
- `review` ハンドラが検出する設定エラー（`--output html` など）
- `review` の未実装経路（`river review verify` と、`--plan-only` を付けない `river review plan` は「Phase 3 では未実装」として exit 3 を返す）

この統一により、オプション名の typo・余剰 positional・値の欠落は `$?` の exit 1 として検知できます。**値の妥当性**は、次のオプションについて parse 層で検証します。

- 列挙値: `--phase` / `--severity` / `--planner` / `--depth` / `--output` / `--format` / `--fail-on` / `--warn-on` / `--source` / `--fingerprint-algo`
- 数値: `--pr` / `--threshold` / `--min` / `--max-cost`
- 日付: `--expires` / `--month`

usage error のときにデータ書き込み（feedback / suppression のエントリ追加など）が先行することはありません。

`--expires` が受理するのは RFC 3339 の `YYYY-MM-DD` 形式と date-time 形式だけです。日付のみの入力は UTC の深夜として解釈し、保存時に date-time へ正規化します（`schemas/suppression-context.schema.json` の `expiresAt` が `format: date-time` のため）。

ただし値の検証は全オプションには及びません。次の 2 経路は現在も exit 0 のまま通るため、`$?` だけでは検知できません。

- 存在しないパスを `--baseline` に渡した場合（回帰比較が黙って行われない）
- 未知の語彙を `--context` / `--dependency` に渡した場合

環境変数 `RIVER_PHASE` は #1759 C2 で `--phase` と同じ語彙・同じ大小文字無視の検証を通るようになりました。不正値は `--phase` と同じ形の `Error: RIVER_PHASE must be one of: ...` を stderr へ出して exit 1 です。未設定・空文字は既定の `midstream` へフォールバックする挙動を維持します。

オプションの値は**スペース区切り**で渡します。`--output=json` のような `=` 連結形式は受理せず、未知オプションとして exit 1 になります（互換のため `--run-id=<id>` だけは例外的に受理します）。なお `--artifact plan=./plan.md` のように、**値の内部**に `=` を含む形式は有効です。

対象パスの位置をオプションの前後どちらにも書けるのは、次の面だけです。

- `run` / `doctor`
- `skills`（サブコマンドを付けない形）
- `review`（`plan` / `exec` / `verify` / `route`）
- `evolve aggregate`（`evolve replay` は入力を `--spec` から取るため対象外）

この範囲では `river run . --dry-run` と `river run --dry-run .` が同じ意味になります。対象パスとして解釈できる非オプションのトークンは 1 つだけで、2 つ目以降は余剰 positional として exit 1 です。

`review` のサブコマンド（`plan` / `exec` / `verify` / `route`）も、オプションの前後どちらにも書けます。`river review plan --plan-only` と `river review --plan-only plan` は同じ意味です。サブコマンドを打ち忘れた場合と、語彙に無いトークンを渡した場合は exit 1 になります。

`review` ではサブコマンド語が上記の positional 勘定に入りません。`river review --plan-only plan ./sub` は、サブコマンド 1 つとパス 1 つの組として受理されます。3 つ目の非オプションから余剰 positional です。

POSIX の `--` 終端も使えます。`--` の後ろに置いたトークンは、オプションやサブコマンド名ではなく、パスとして読みます。ここでも受け取るのは 1 つ目だけで、2 つ目以降は余剰 positional として exit 1 です。`river run -- .` は `river run .` と同じ意味になります。`river run -- --dry-run` は `--dry-run` という名前のパスを指定した扱いになるため、`--dry-run` フラグは有効になりません。

`--` の後ろのトークンは実在するパスでなければならず、存在しない場合は exit 1 です。これは `river evolve aggregate -- ./typo` のような打鍵ミスが「データ 0 件の正常な集計」として exit 0 になるのを防ぐためです。後ろにトークンを置かない裸の `--` は、どのコマンド面でも何もしない指定として受理されます。

上記以外の面（`skills list` / `runs list` / `promote list` / `eval` など）は末尾のパスを受け取らず、余剰 positional として exit 1 になります。なお `runs diff <id1> <id2> [<id3>...]` や `promote approve <id>` のように、非オプションのトークンを仕様として複数受け取るサブコマンドは別扱いです。

### `river review` / `river eval`（`runners/cli`）

`runners/cli` のコマンドは現時点ではすべてのエラーをコード `1` に集約します。コード `3` は発生しません。

| コード | 意味                                             |
| ------ | ------------------------------------------------ |
| `0`    | 正常終了                                         |
| `1`    | 実行エラー・スキーマエラーを含むすべての異常終了 |

### 検証スクリプト（Python）

- `0`: 検証が正常に完了した。
- `1`: スキーマチェックが通過しなかったか、スキーマエラーが発生した。

## 例

```bash
# すべてのエージェントを検証
npm run agents:validate

# すべてのスキルを検証
npm run skills:validate

# 構造化されたレビュー出力をビルド（artifacts/river-review-output.json に書き込み）
python scripts/rr_runner.py --input tests/fixtures/structured-output/sample_llm_response.json
```
