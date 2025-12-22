# 評価フィクスチャ形式（fixtures-based eval）

River Reviewer は、差分に対するレビュー出力の品質を継続的に確認するために、フィクスチャ（入力と期待）を用いた評価をサポートします。本ページではフィクスチャ形式と評価ランナーの使い方を定義します。

## 目的

- スキルの出力形式（ラベル、Severity/Confidence）の整合性を自動で検証
- 代表的な変更に対して、最低限含まれるべき語句（must_include）をチェック
- 継続的評価（ローカル/CI）により、破壊的変更を早期検出

## 入力形式（cases.json）

フィクスチャは JSON で定義します。デフォルトの読み込み先は `tests/fixtures/review-eval/cases.json` です。

各ケースは次のフィールドを持ちます。

- `name`（string）: ケース名
- `phase`（string, optional）: 適用フェーズ（例: `upstream`/`midstream`/`downstream`）
- `diffFile`（string）: Unified Diff 形式のファイルへの相対パス（`cases.json` からの相対）
- `planSkills`（string[]）: このケースで適用するスキルの ID（簡易プラン）
- `mustInclude`（string[]）: 出力に必ず含まれてほしい語句（AND 条件）
- `expectNoFindings`（boolean, optional）: 指摘ゼロを期待する場合に `true`
- `minFindings`（number, optional）: 最低指摘数（`expectNoFindings` が `true` の場合は 0）
- `maxFindings`（number, optional）: 最大指摘数の上限

### 例

```json
{
  "name": "secrets: hardcoded token (export const)",
  "phase": "midstream",
  "diffFile": "../planner-dataset/diffs/midstream-security-hardcoded-token.diff",
  "planSkills": ["rr-midstream-security-basic-001"],
  "mustInclude": [
    "Finding:",
    "Evidence:",
    "Fix:",
    "GitHub Secrets",
    "Severity: blocker",
    "Confidence: high"
  ],
  "maxFindings": 3
}
```

## 実行方法（ローカル）

- 依存導入: `npm ci`
- 実行: `npm run eval:fixtures`
  - オプション: `--cases <path>`（デフォルトは `tests/fixtures/review-eval/cases.json`）
  - オプション: `--phase <upstream|midstream|downstream>`（各ケースの `phase` を上書き）
  - オプション: `--verbose`（詳細ログ）

評価ランナーの実体は `scripts/evaluate-review-fixtures.mjs` で、内部では `src/lib/review-fixtures-eval.mjs` を呼び出します。

## 判定仕様

- 出力形式検証: `Finding:`/`Evidence:`/`Fix:`、`Severity:`/`Confidence:` の整合を確認
- 指摘数: `minFindings` 以上、`maxFindings` 以下
- 語句検査: `mustInclude` の各語句がすべて含まれていること

いずれかのチェックに失敗した場合、終了コード 1 を返します。

## CI 連携（任意）

GitHub Actions での実行は任意です。CI へ統合する場合は、以下のようなステップを追加します。

```yaml
- name: Evaluate review fixtures
  run: npm run eval:fixtures -- --verbose
```

`must_include` の期待に合致しない場合はジョブが失敗します。

## 既知の制限

- LLM を使わずヒューリスティック出力のみで評価する（`dryRun: true`）
- `planSkills` は ID のみ指定可能である（メタデータを最小限にモック）
- Diff の最適化は行わず、フィクスチャに含まれるハンクをそのまま評価する

## 関連ファイル

- `scripts/evaluate-review-fixtures.mjs`
- `src/lib/review-fixtures-eval.mjs`
- `tests/fixtures/review-eval/cases.json`
