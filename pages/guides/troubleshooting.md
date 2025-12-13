# トラブルシューティング

よくある症状と、切り分けのための確認ポイントをまとめます。

## CLI（`river run`）

### まず最初に（事前診断）

原因の切り分けが難しい場合は、まず `river doctor .` を実行して「設定の不足」や「差分取得の失敗」を確認してください。

### OpenAI API key が見つからない

- 症状（例）:
  - `LLM: OPENAI_API_KEY (or RIVER_OPENAI_API_KEY) not set`
  - `River Reviewer doctor` の `OpenAI (review): not set`
- 対応:
  - `OPENAI_API_KEY` または `RIVER_OPENAI_API_KEY` を環境変数で設定すること
  - 外部送信を避けたい場合は `--dry-run` を利用すること

### Git リポジトリとして認識されない

- 症状: `Not a git repository: ...`
- 対応:
  - Git 管理下のディレクトリで実行すること
  - 必要なら `git init` / `git clone ...`

### スキル定義の読み込み/検証に失敗する

- 症状: `Skill configuration error: ...`
- 対応:
  - `npm run skills:validate` を実行してエラー詳細を確認すること
  - スキルスキーマの詳細は `pages/reference/skill-schema-reference.md` を参照すること

### ルール（`.river/rules.md`）が読めない

- 症状: rules ファイル読み込みエラー
- 対応:
  - `.river/rules.md` の存在と読み取り権限を確認すること（不要なら削除して無効化できる）

### 何がスキップされたのか分からない

- 対応:
  - `river run . --debug` を付けて、選択されたスキルとスキップ理由の出力を確認すること

### ローカル実行でファイルが検出されない

- 対応:
  - `git status` や `git diff` で差分を確認すること
  - `river run . --debug` で対象ファイル・ハンクのプレビューを確認すること

### レート制限エラー

- 対応:
  - OpenAI 側のレート制限に達していないか確認すること
  - しばらく待ってから再実行すること
  - 必要に応じて `--dry-run` でプロンプト/スキル選択のみ確認すること

## GitHub Actions

### レビューが実行されない / 権限エラー

- `permissions` が不足している可能性がある（例: `pull-requests: write`）
- `OPENAI_API_KEY` などの Secrets が正しく設定されているか確認すること

### 差分が検出されない

- `actions/checkout` の `fetch-depth: 0` を推奨する（merge-base を安定して取得するため）
