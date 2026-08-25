---
title: Run store と回帰比較（runs / --baseline）
---

River Review はレビュー実行（run）の結果をプロジェクトローカルの **Run store**（`.river/runs/`）に保存し、過去の実行と比較して回帰（新規・解消された指摘）を確認できます。CI に組み込めば「この PR で指摘が増えていないか」を機械的に追跡できます。

> 各フラグ・サブコマンドの一覧は [Stable Interfaces（CLI リファレンス）](../reference/stable-interfaces.md) を参照してください。本ページは使い方（how-to）に絞っています。

## 全体像

| やりたいこと                               | コマンド                                  |
| ------------------------------------------ | ----------------------------------------- |
| レビュー実行を保存する                     | `river run <path> --save`                 |
| 保存済み実行の一覧を見る                   | `river runs list`                         |
| 保存済み実行の差分（回帰・振動）を見る     | `river runs diff <id1> <id2> [<id3>...]`  |
| 保存済み実行全体の集計ダッシュボードを見る | `river runs summary`                      |
| 任意の baseline JSON と比較する            | `river run <path> --baseline <prev.json>` |

## 1. レビュー実行を保存する（`--save`）

`river run` に `--save` を付けると、実行結果が Run store に保存されます。

```bash
river run . --save
```

保存に成功すると、標準エラー出力に保存先が表示されます。

```text
Run saved: 2026-06-06T08-30-00-000Z-a1b2c3 → /path/to/repo/.river/runs/2026-06-06T08-30-00-000Z-a1b2c3.json
```

### Run store の場所

- 既定: レビュー対象リポジトリ直下の **`.river/runs/`**（プロジェクトローカル）
- リポジトリが特定できない場合のフォールバック: **`~/.river/runs/`**（グローバル）

各実行は `<runId>.json` という 1 ファイルとして保存されます。`runId` は ISO タイムスタンプ + 短いハッシュ（例: `2026-06-06T08-30-00-000Z-a1b2c3`）で構成され、ファイル名の辞書順が時系列順と一致するよう設計されています。

> `.river/runs/` は実行ログであり、リポジトリにコミットする必要はありません。`.gitignore` に追加して運用するのが一般的です。

### 保存される内容

各 run record（JSON）には次の情報が含まれます。

- `runId` / `timestamp` / `phase` / `reviewMode`
- `mergeBase` / `defaultBranch` / `changedFiles`
- `findings`（指摘）/ `suppressedFindings`（抑制された指摘）
- `overflowFindings`（表示枠の上限を超えた指摘。溢れが 0 件の run ではキー自体が存在しません）
- `finalSummary`: `findingsCount` / `suppressedCount` / `overflowCount` / `overviewCount` / `changedFilesCount` / `tokenEstimate`

`overflowFindings` は「抑制された指摘」ではありません。抑制は「どう扱うか」の判断であるのに対し、表示枠の超過は並び替えの結果にすぎないので、理由コードを持たず `suppressedFindings` とは別に保存されます。Markdown レポート自体はこの上限で本文を打ち切らないため、溢れた指摘もレポートには全文が載ります。

## 2. 保存済み実行の一覧（`river runs list`）

Run store に保存された実行を新しい順で表示します。

```bash
river runs list
```

```text
Stored runs (/path/to/repo/.river/runs):

  2026-06-06T08-30-00-000Z-a1b2c3  phase=midstream  findings=4  suppressed=1  overflow=2  files=7  2026-06-06T08:30:00.000Z
  2026-06-05T17-10-00-000Z-d4e5f6  phase=midstream  findings=6  suppressed=0  overflow=0  files=5  2026-06-05T17:10:00.000Z
```

`overflow=` を追加する前に保存した run record は `overflowCount` を持たないため、`overflow=0` と表示されます。

保存済み実行がない場合は `No stored runs found in ...` と表示されます。

## 3. 2 つの実行を比較する（`river runs diff`）

保存済みの 2 実行を `runId` で指定し、指摘の回帰を比較します。

```bash
river runs diff 2026-06-05T17-10-00-000Z-d4e5f6 2026-06-06T08-30-00-000Z-a1b2c3
```

`## Regression Review Summary` という Markdown が出力されます。

| 項目              | 意味                                                     |
| ----------------- | -------------------------------------------------------- |
| New findings      | 1 つ目になく 2 つ目に現れた指摘（回帰）                  |
| Resolved findings | 1 つ目にあり 2 つ目で消えた指摘（解消）                  |
| Persisting        | 両方に存在し、スコア変化が小さい指摘                     |
| Score changed     | 両方に存在するが composite スコアが ±0.05 以上動いた指摘 |
| Regression score  | `New − Resolved`。正なら指摘が純増（悪化）               |

New / Resolved / Score changes の各セクションには、対象ファイルと指摘内容が一覧表示されます。

> 指摘の同一性は fingerprint で判定されます。ファイルパス・ルール・指摘内容（メッセージ要旨）が同じ指摘は同一とみなされ、行番号のズレは無視されます。

### 3+ run での振動検知

`runId` を 3 件以上指定すると、**振動（oscillation）検知**が有効になります。

```bash
river runs diff <run-id-1> <run-id-2> <run-id-3>
```

振動とは、一度 Resolved（解消）になった指摘が後続の run で再び New として現れる現象です。AI による revise（修正提案）が別の問題を引き起こす自己修正ループのシグナルとなります。

出力の `Oscillated findings` セクションには、解消後に再出現した指摘が一覧表示されます。`--output json` で出力すると `oscillated` 配列として機械的に消費できます。

## 4. 集計ダッシュボード（`river runs summary`）

Run store 全体を集計した Markdown ダッシュボードを表示します。

```bash
river runs summary
```

```text
## River Review Dashboard

| Metric | Value |
|---|---|
| Total runs | 12 |
| Total findings | 48 |
| Total suppressed | 6 |
| Total overflow (overview cap) | 2 |
| Suppress rate | 11.1% |
| Avg findings/run | 4.0 |
```

加えて、Severity / Confidence の分布表が出力されます。複数実行を横断した品質トレンドの把握に使います。

`Suppress rate` は各 run record が保存した `suppressedFindings` をそのまま数えた値です。表示枠の超過を `suppressedFindings` に含めていた古い run record が Run store に残っている場合、その分だけ古い側の値が大きくなります。古い記録が混ざっているときは `Legacy pre-#1857 suppressions` の行が出るので、トレンドの断絶と実際の変化はその行で見分けてください。

## 5. 任意の baseline と比較する（`--baseline`）

`runs diff` が「保存済み 2 実行の比較」なのに対し、`--baseline` は **新しく実行した結果を、任意の過去レビュー JSON と比較**します。`main` ブランチ等で生成した基準（baseline）をファイルとして持っておき、PR ブランチで回帰チェックする用途に向きます。

```bash
river run . --baseline ./baseline-findings.json
```

`--baseline` に渡す JSON は次のいずれかの形式を受け付けます。

- findings の配列そのもの（`[ { ... }, { ... } ]`）
- `findings`（または `issues`）キーを持つオブジェクト（`{ "findings": [ ... ] }`）

出力は `runs diff` と同じ `## Regression Review Summary` 形式です。比較に失敗した場合は `Warning: --baseline comparison failed: ...` が出力され、レビュー自体は継続します。

回帰サマリの出力先は `--output` で変わります（#1706）。既定の `text` なら標準出力、`markdown` / `json` / `yaml` / `html` なら標準エラーです。`river run . --baseline base.json --output json > result.json` のようにリダイレクトしても、`result.json` は妥当な JSON のままになります。

### baseline ファイルの作り方

`--output json` で実行結果を保存しておけば、そのまま baseline として再利用できます。

```bash
# main で基準を作成
git switch main
river run . --output json > baseline-findings.json

# PR ブランチで回帰チェック
git switch feature/my-change
river run . --baseline ./baseline-findings.json
```

## CI への組み込み例

PR で指摘が純増したら気付けるようにする最小例です。

```bash
# 基準（main の指摘）を成果物として持っている前提
river run . --baseline ./baseline-findings.json --save
```

`--save` を併用すると、各 PR の実行も Run store に蓄積され、後から `river runs summary` でトレンドを確認できます。

## 関連ページ

- [Stable Interfaces（CLI リファレンス）](../reference/stable-interfaces.md) — フラグ・サブコマンド一覧
- [Riverbed Memory を使用する](./use-riverbed-memory.md) — 指摘の抑制（suppression）
- [Tracing / Observability](./tracing.md)
