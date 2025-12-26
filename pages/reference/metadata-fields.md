# メタデータ・フィールド

以下のフィールドを使用して、スキルのメタデータを一貫性のあるものにし、ルーティングしやすくします。

| フィールド     | 目的                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | 一意の識別子（`rr-xxxx` 形式を推奨）。                                                                                                        |
| `name`         | レビューに表示される人間が読めるスキル名。                                                                                                    |
| `description`  | スキルが何をチェックするかの短い要約。                                                                                                        |
| `phase`        | スキルが属するフローセグメント: `upstream`、`midstream`、または `downstream`。                                                                |
| `applyTo`      | スキルが検査すべきファイルのグロブパターン。                                                                                                  |
| `tags`         | オプションの分類（例: `security` や `performance`）。                                                                                         |
| `severity`     | オプションの影響レベル: `info`、`minor`、`major`、`critical`。                                                                                |
| `inputContext` | スキルが期待する必須入力（例: `diff`、`fullFile`、`tests`、`adr`、`commitMessage`、`repoConfig`）。                                           |
| `outputKind`   | 生成される出力カテゴリ（例: `findings`、`summary`、`actions`、`tests`、`metrics`、`questions`）。省略時は `findings` がデフォルトになります。 |
| `modelHint`    | モデル選択のヒント: `cheap` / `balanced` / `high-accuracy`。                                                                                  |
| `dependencies` | 必須ツール/リソース（例: `code_search`、`test_runner`、`adr_lookup`、`repo_metadata`、`coverage_report`、`tracing`、または `custom:*`）。     |

メタデータは front matter に保持し、指示が実行される前に解析できるようにしてください。すべての必須フィールドは `/schemas/skill.schema.json` を使用したチェックに合格する必要があります。
