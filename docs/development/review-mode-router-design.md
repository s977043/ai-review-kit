# Review Mode Router 設計書

> Status: Implemented (Slice 1 + 2)
> Related: Issue #1323、`src/lib/review-mode-router.mjs`、`src/lib/risk-map.mjs`、`src/lib/file-classifier.mjs`

## 1. 概要

Review Mode Router は、PR の diff リスクに基づいてレビュー深度（mode）を自動選択するコンポーネントです。
LLM 呼び出しを一切行わず、ヒューリスティックのみで動作します（dry-run）。

### 解決する課題

- チーム全員が同じ `--depth` を手動指定しており、diff の内容と深度がミスマッチになる
- `risk-map.yaml` の `require_human_review` 設定が CLI の mode 選択に繋がっていない
- マイグレーションやスキーマ変更の PR が `tiny` モードで流れてしまうことがある

## 2. スコープと境界

### スコープ内

- diff ファイルリスト・file-classifier・risk-map に基づく mode 推薦
- `river review route` CLI サブコマンド（`--dry-run` フラグで明示、既定動作は常に dry-run）
- JSON / markdown フォーマット出力
- 既存 `review plan | exec | verify` との明示的な連携コマンド出力（`nextCommand`）

### スコープ外（非ゴール）

- LLM による diff 内容分析
- 自動的な `review plan` / `review exec` の起動（HITL 境界：推薦のみ）
- cost-control-mode（Issue #921: PR 状態ベースの別軸、parked）
- `--depth` 引数の自動上書き

## 3. mode の定義

| Router mode      | 内部 reviewMode | 相当する `--depth` | 説明                                                                     |
| ---------------- | --------------- | ------------------ | ------------------------------------------------------------------------ |
| `light`          | `tiny`          | `quick`            | docs / test のみ変更。最小コスト                                         |
| `standard`       | `medium`        | `standard`         | 通常の app コード変更                                                    |
| `team`           | `large`         | `thorough`         | migration / schema / 大規模変更。`--reviewers auto` 推薦                 |
| `human-required` | (なし)          | (なし)             | risk-map が `require_human_review` を返した場合。AI レビューでなく人間へ |

## 4. ルーティングロジック

### 入力

```ts
interface RouterInput {
  changedFiles: string[]; // 変更ファイルパス一覧
  diffText?: string; // raw diff（行数カウントに使用、省略可）
  riskMap?: RiskMapConfig; // loadRiskMap() の返り値（null = 設定なし）
}
```

### 決定ルール（優先順位順）

1. **risk-map 最優先**: `aggregateAction === 'require_human_review'` → `human-required`
2. **risk-map escalate**: `aggregateAction === 'escalate'` → `team` 以上
3. **migration/schema**: fileTypes に `migration` または `schema` → `team` 以上
4. **大規模変更**: `fileCount >= 20` または `changedLines >= 500` → `team` 以上
5. **infra/config 変更**: fileTypes に `infra` または `config` → `standard` 以上
6. **docs/test のみ**: `app`/`config`/`schema`/`migration`/`infra` がゼロ → `light`
7. **デフォルト**: `standard`

「以上」の意味は、既に上位 mode が決定している場合はそちらを維持する、という意味です。

### 出力

```ts
interface RouterOutput {
  selectedMode: 'light' | 'standard' | 'team' | 'human-required';
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  matchedTriggers: string[];
  recommendedReviewers: string;
  riskAction: string;
  nextCommand: string;
}
```

#### `nextCommand` の例

```bash
# light
river review plan . --depth quick

# standard
river review plan .

# team
river review plan . --depth thorough --reviewers auto

# human-required
# No AI review recommended. Assign human reviewer.
```

## 5. 既存実装との対応

| Router 概念        | 既存コード                          | 接続方法                         |
| ------------------ | ----------------------------------- | -------------------------------- |
| fileTypes 分類     | `src/lib/file-classifier.mjs`       | `classifyChangedFiles`           |
| risk 評価          | `src/lib/risk-map.mjs`              | `evaluateRisk`                   |
| reviewMode 変換    | `src/lib/review-plan-generator.mjs` | `DEPTH_TO_REVIEW_MODE`           |
| reviewers 自動選択 | `src/lib/reviewer-orchestrator.mjs` | 参考のみ（route では実行しない） |

## 6. #921 cost-control-mode との棲み分け

Issue #921 は「PR ライフサイクル状態（draft/ready/main-bound）に基づくコスト制御」を扱う別軸の設計であり、現在 parked 状態です。

Review Mode Router はファイル内容・リスクマップに基づく**静的な深度推薦**であり、PR 状態は参照しません。将来的に両者が連携する場合、#921 の実装後に結合を検討します。

## 7. CLI 使用例

```bash
# カレントディレクトリの diff をルーティング（JSON 出力）
river review route .

# markdown 形式で出力
river review route . --format markdown

# 特定のベースブランチと比較
river review route . --base main
```

## 8. 実装コンポーネント

| ファイル                                        | 内容                                  |
| ----------------------------------------------- | ------------------------------------- |
| `src/lib/review-mode-router.mjs`                | `routeReviewMode()` 関数本体          |
| `tests/review-mode-router.test.mjs`             | ユニットテスト                        |
| `src/cli.mjs`                                   | `river review route` サブコマンド追加 |
| `docs/development/review-mode-router-design.md` | 本ドキュメント                        |
