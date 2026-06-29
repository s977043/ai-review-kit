# W チェック（二重レビュー）ガイド

## 概要

**W チェック**（Wチェック / double review）とは、他の AI レビュアーや人間レビュアーが生成した既存のレビュー結果を River Review に渡して再点検する機能です。River Review は渡されたレビュー結果と PR 差分を照合し、指摘の実在性を検証・統合した上でマージ判断を出力します。

典型的なユースケース:

- Claude Code のレビューと Codex のレビューを統合して、各レビュアーの見落としを補完したい
- 人間レビュアーの指摘と AI レビューを照合し、ハルシネーション（架空コード参照）を除去したい
- 複数の AI ツールを並列実行した結果を一元的にトリアージしたい

## クイックスタート

W チェックを初めて使う場合は、以下の手順でゼロから動かせます。

1. **各 AI レビュアーを実行し、出力を Markdown ファイルに保存する**

   例: Codex と Gemini を使う場合

   ```bash
   # Codex のレビュー出力を保存
   codex review > codex-review.md

   # Gemini のレビュー出力を保存
   gemini review > gemini-review.md
   ```

   フォーマットは自由形式の UTF-8 Markdown で構いません（特定スキーマ不要）。
   詳細は「[アーティファクトの仕様](#アーティファクトの仕様)」を参照してください。

2. **レビュー結果ファイルを `.river/reviews/` に配置する**

   ```bash
   mkdir -p .river/reviews
   cp codex-review.md .river/reviews/codex.md
   cp gemini-review.md .river/reviews/gemini.md
   # セルフレビューがある場合は別途渡せます（次ステップ参照）
   ```

3. **`river review exec` を実行する**

   ```bash
   river review exec \
     --ensemble .river/reviews/ \
     --phase midstream
   ```

   セルフレビューも合わせて渡す場合:

   ```bash
   river review exec \
     --artifact review-self=./self-review.md \
     --ensemble .river/reviews/ \
     --phase midstream
   ```

4. **出力を解釈する**

   synthesis skill が重複排除・ハルシネーション検証を行い、最終的に以下のいずれかの verdict を出力します:

   | verdict        | 意味                                                     |
   | -------------- | -------------------------------------------------------- |
   | `merge-ready`  | confirmed な critical / major 指摘なし → マージ可        |
   | `human-review` | 低確信度の指摘あり → 人間レビュー推奨                    |
   | `block`        | confirmed な critical または major 指摘あり → マージ保留 |

   出力フォーマットの詳細は「[synthesis skill の出力例](#synthesis-skill-の動作)」を参照してください。

> **degraded mode について**: どちらか一方のアーティファクトが欠損していても W チェックは動作します。ただし両方揃っている場合より精度は下がります。詳細は「[アーティファクトの仕様](#アーティファクトの仕様)」を参照してください。

## アーティファクトの仕様

W チェックは `review-self` と `review-external` の 2 種類のアーティファクトを入力として受け取ります。

| 項目         | `review-self`                                     | `review-external`                                        |
| ------------ | ------------------------------------------------- | -------------------------------------------------------- |
| 役割         | 実装者自身のセルフレビュー                        | 外部 AI / 人間レビュアーの出力                           |
| フォーマット | UTF-8 Markdown フリーフォーム（特定スキーマ不要） | UTF-8 Markdown フリーフォーム（特定スキーマ不要）        |
| 必須 / 任意  | 任意                                              | 任意                                                     |
| 欠損時の挙動 | W チェック系 skill がその入力をスキップ           | W チェック系 skill がその入力をスキップ                  |
| 内部での扱い | provenance: `self-review` として区別              | provenance: `ai-review` または `human-review` として区別 |

両アーティファクトとも任意です。どちらか一方だけでも W チェックは動作しますが（degraded mode）、両方揃っている場合により精度の高い統合が可能です。

詳細は [`pages/reference/artifact-input-contract.md`](../reference/artifact-input-contract.md) の `review-self` / `review-external` 節を参照してください。

## CLI での実行方法

### パターン 1: ファイルを 1 つずつ指定

```bash
river review exec \
  --artifact review-self=./self-review.md \
  --artifact review-external=./codex-review.md \
  --phase midstream
```

### パターン 2: `--ensemble` でディレクトリ一括指定

複数のレビュー結果ファイルをディレクトリにまとめて一括で渡す方法です。`--ensemble` は指定ディレクトリ内の `*.md` ファイルをファイル名のアルファベット順にすべて結合し、`review-external` アーティファクトとして扱います。

```bash
mkdir -p .river/reviews
# .river/reviews/ に各レビュー結果の .md を置く
# 例: .river/reviews/codex.md, .river/reviews/gemini.md, .river/reviews/human.md
river review exec \
  --ensemble .river/reviews/ \
  --phase midstream
```

`--artifact review-external` と `--ensemble` を同時に指定した場合は `--artifact review-external` が優先されます（`--ensemble` は無視され警告が出力されます）。

## GitHub Actions での設定方法

現時点では GitHub Actions の `inputs` に `review-self` / `review-external` の入力は未実装です（別途対応予定）。回避策として、`dist/index.mjs` を直接呼び出すことで同等の動作が可能です。

### 推奨: アーティファクト経由でレビューファイルを渡す

GitHub Actions の repository/environment 変数（`vars.*`）はマルチライン Markdown の保存に **48 KB の上限**があり、大きなレビュー出力は**サイレントに切り捨てられます**。代わりに `actions/upload-artifact` / `actions/download-artifact` でファイルを渡すことを推奨します。

```yaml
jobs:
  ai-reviews:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Run Codex review
        run: codex review > codex-review.md
        # 各 AI ツールの実行コマンドに合わせて変更してください

      - name: Upload review artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ai-reviews
          path: |
            codex-review.md

  w-check:
    needs: ai-reviews
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6

      - name: Download review artifacts
        uses: actions/download-artifact@v4
        with:
          name: ai-reviews
          path: .river/reviews/

      - name: Run W-check
        run: |
          node runners/github-action/dist/index.mjs run . \
            --phase midstream \
            --ensemble .river/reviews/
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

> **注意**: `runners/github-action/dist/index.mjs` のパスはリポジトリのチェックアウトパスを前提としています。`github.action_path` は composite action の内部でのみ有効なため、呼び出し元ワークフローから直接使用することはできません。River Review を Action として `uses: s977043/river-review@vX.Y.Z` で呼び出す形式が整備された際は、そちらに移行してください。

## synthesis skill の動作

W チェックの統合処理は `independent-review-synthesis` skill（`recommended: true`）が担います。この skill は以下の 3 つの主要ステップで動作します。

1. **重複排除 (Deduplicate)**: 複数のレビュアーが同じ箇所を指摘した場合、file path・行範囲・evidence テキストに基づいて同一 finding として統合する。
2. **ハルシネーション検証 (Hallucination guard)**: 各 finding の `evidence` が参照するファイルパスとコードスニペットを実際の差分と照合し、実在しないコードを参照している指摘を `dismissed-hallucination` として除外する。
3. **マージ推奨 (Merge recommendation)**: 確認済みの critical / major finding の有無に基づいて `merge-ready` / `human-review` / `block` のいずれかを出力する。

### 出力例

synthesis skill が生成する JSON 出力の構造例です（フィールド名は [`schemas/output.schema.json`](../../schemas/output.schema.json) で定義）:

```json
{
  "summary": {
    "issueCountBySeverity": { "critical": 1, "major": 0, "minor": 1, "info": 0 },
    "issueCountByPhase": { "upstream": 0, "midstream": 2, "downstream": 0 },
    "notes": "verdict: block — confirmed critical finding present"
  },
  "issues": [
    {
      "id": "w-001",
      "ruleId": "independent-review-synthesis",
      "title": "SQL インジェクションの可能性",
      "message": "userInput を直接クエリに埋め込んでいる。パラメータバインドに変更してください。",
      "severity": "critical",
      "phase": "midstream",
      "file": "src/db/query.ts",
      "line": 42,
      "status": "verified",
      "evidence": ["+ const sql = `SELECT * FROM users WHERE id = ${userInput}`"]
    },
    {
      "id": "w-002",
      "ruleId": "independent-review-synthesis",
      "title": "存在しない関数への参照",
      "message": "レビュアーが指摘した validateInput() は差分に存在しないため除外。",
      "severity": "minor",
      "phase": "midstream",
      "file": "src/utils/validate.ts",
      "line": 10,
      "status": "suppressed",
      "evidence": []
    }
  ]
}
```

`status: "verified"` は差分との照合で実在が確認された finding、`status: "suppressed"` はハルシネーション等で除外された finding を表します。`summary.notes` に verdict（`merge-ready` / `human-review` / `block`）が記録されます。出力スキーマの完全な定義は [`schemas/output.schema.json`](../../schemas/output.schema.json) を参照してください。

skill の詳細: [`skills/midstream/independent-review-synthesis/SKILL.md`](https://github.com/s977043/river-review/blob/main/skills/midstream/independent-review-synthesis/SKILL.md)

## 関連ページ

- [Artifact Input Contract](../reference/artifact-input-contract.md) — `review-self` / `review-external` の仕様詳細
- [Independent Review Synthesis skill](https://github.com/s977043/river-review/blob/main/skills/midstream/independent-review-synthesis/SKILL.md) — synthesis skill の全ルール
- [GitHub Actions セットアップ](./github-actions.md) — 基本的な GitHub Actions 構成
