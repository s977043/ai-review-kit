# Riverbed Memory ストレージ設計

Riverbed Memory は、過去の判断やパターンを LLM レビューに活用するための軽量ストレージです。リポジトリ内の `.river/memory/` 配下に JSON ファイルで保存し、必要に応じてインデックスを再生成します。

## ディレクトリ構成

```text
.river/memory/
  entries/
    adr-example.json
    review-2024-11-01.json
    pattern-react-query.json
  index.json
```

- `entries/*.json`: 個別エントリ。`schemas/riverbed-entry.schema.json` を参照。
- `index.json`: エントリの一覧とメタデータ。`schemas/riverbed-index.schema.json` を参照。

## エントリ仕様（抜粋）

- `id`: 一意な文字列（例: `adr-001`, `pattern-react-query`）
- `type`: `adr | review | wontfix | pattern | decision`
- `content`: 本文。Markdown/テキストを想定
- `metadata`:
  - `createdAt` (ISO8601), `updatedAt` (任意)
  - `author`
  - `phase` (`upstream | midstream | downstream`, 任意)
  - `tags`, `relatedFiles`, `links`, `summary`
- `context`: 任意の追加情報（PR 番号、関連 ADR ID など）

詳細は `schemas/riverbed-entry.schema.json` を参照してください。

## インデックス仕様（抜粋）

- `generatedAt`: インデックス生成時刻
- `entries[]`:
  - `id`, `type`, `path`
  - `title`, `tags`, `phase`, `createdAt`, `summary`

## 生成と利用の流れ

1. 変更履歴や ADR を JSON 形式で `.river/memory/entries/` に追加する
2. インデックス生成スクリプト（将来の `npm run riverbed:index` など）で `index.json` を更新する
3. レビュー時に近傍のエントリを検索し、プロンプトへ組み込む

### ストレージポリシー

- Git 管理を想定。機微情報は記載しない
- UTF-8 エンコード
- 破損ファイルはスキップしてログに記録し、レビューを継続する方針

## サンプルデータ

`tests/fixtures/riverbed/` に ADR、wontfix、pattern の例を配置しています。スキーマを満たす最小構成の参考として利用できます。
