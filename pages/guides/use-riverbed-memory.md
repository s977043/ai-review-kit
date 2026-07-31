# Riverbed Memory を使用する

Riverbed Memory は過去のレビュー判断を構造化レコードとして保存し、後続のレビュー実行で参照可能にする仕組みです。

## 前提条件

- Node.js 22 以上
- `npm ci` 済み

## エンドツーエンドの使い方

### 1. eval 実行時にメモリを保存する

`npm run eval:all` に `--persist-memory` フラグを付けると、eval 結果が `.river/memory/index.json` に自動保存されます。

```bash
npm run eval:all -- --persist-memory --append-ledger --description "baseline"
```

実行後、`.river/memory/index.json` にエントリが追加されます。

### 2. メモリを手動で追加する

`src/lib/riverbed-memory.mjs` の API を直接使用してレコードを追加できます。

```javascript
import { appendEntry } from './src/lib/riverbed-memory.mjs';

appendEntry('.river/memory/index.json', {
  id: 'wontfix-silent-catch-utils',
  type: 'wontfix',
  title: 'utils.mjs の silent catch は意図的',
  content: 'エラーログは上位で処理済みのため、catch 内での再 throw は不要。',
  metadata: {
    createdAt: new Date().toISOString(),
    author: 'reviewer',
    phase: 'midstream',
    tags: ['observability', 'silent-catch'],
    confidence: 0.9,
  },
  context: {
    sourcePR: 'https://github.com/example/repo/pull/42',
  },
});
```

### 3. メモリを検索する

```javascript
import { loadMemory, queryMemory } from './src/lib/riverbed-memory.mjs';

const index = loadMemory('.river/memory/index.json');

// type でフィルタ
const wontfixEntries = queryMemory(index, { type: 'wontfix' });

// phase + tags でフィルタ
const midstreamSecurity = queryMemory(index, {
  phase: 'midstream',
  tags: ['security'],
});
```

### 4. CI で永続化する（GitHub Artifact）

`.github/workflows/riverbed-persist.yml` が GitHub Artifact 経由でメモリを永続化します。

```yaml
# 他のワークフローから呼び出す
jobs:
  persist:
    uses: ./.github/workflows/riverbed-persist.yml
```

前回のアーティファクトを自動ダウンロードし、更新後にアップロードします（90 日 retention）。メモリが見つからない場合も正常動作します（stateless fallback）。

## レビュー実行を保存して比較する（result store）

レビュー実行を保存し、過去の実行と回帰比較できます。result store はメモリ（`.river/memory/`）とは別の `.river/runs/` に保存されます。

### `--save`: 実行を保存する

`river run` に `--save` を付けると、その実行を result store（`.river/runs/`）に保存します。

```bash
river run . --reviewers auto --save
```

### `river runs`: 保存済み実行を確認する

```bash
# 保存済み実行の一覧（runId / phase / findings 数など）
river runs list

# 2 つの実行の差分（new / fixed findings）
river runs diff <run-id-1> <run-id-2>

# 集計（ダッシュボード相当のメトリクス）
river runs summary
```

### `--baseline`: 過去のレビューと回帰比較する

`--baseline <path>` に過去のレビュー JSON を渡すと、通常の出力の前に回帰サマリ（new / fixed findings）を表示します。JSON は `findings` 配列そのもの、または `findings`（あるいは `issues`）キーを持つオブジェクト（例: `river run . --output json` の出力）のいずれでも受け付けます。

回帰サマリの出力先は `--output` によって変わります（#1706）。既定の `text` では標準出力へ、`markdown` / `json` / `yaml` / `html` では標準エラーへ出ます。構造化出力をリダイレクトしてもサマリが混入しない、という保証のためです。

```bash
# 1. 基準となるレビューを JSON で保存する
river run . --output json > baseline.json

# 2. 現在の差分を基準と比較する
river run . --baseline baseline.json
```

## レコード型

| type          | 用途                                          |
| ------------- | --------------------------------------------- |
| `adr`         | ADR への紐付け                                |
| `review`      | レビュー結果の記録                            |
| `wontfix`     | 意図的に対応しない判断                        |
| `pattern`     | 繰り返し出現するパターン                      |
| `decision`    | 設計判断の記録                                |
| `eval_result` | 評価実行結果（`--persist-memory` で自動生成） |

## スキーマ

レコードは `schemas/riverbed-entry.schema.json` に準拠します。必須フィールド:

- `id` — 一意識別子
- `type` — 上記のレコード型
- `content` — 本文
- `metadata.createdAt` — ISO タイムスタンプ
- `metadata.author` — 作成者

## 関連

- スキーマ定義: `schemas/riverbed-entry.schema.json`
- インデックススキーマ: `schemas/riverbed-index.schema.json`
- 永続化ワークフロー: `.github/workflows/riverbed-persist.yml`
- 背景と設計思想: `pages/explanation/riverbed-memory.md`
