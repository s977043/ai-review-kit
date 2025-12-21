# AgentCheck 導入メモ

## インストールと実行

1. リポジトリルートで `npm install -g @devly/agentcheck` または Docker イメージを取得する。
2. `agentcheck init` で設定を生成し、`.agentcheck.yml` にプロジェクト固有ルールを追加する。
3. `agentcheck run --path . --format json` を実行し、出力を River Reviewer の出力スキーマにマッピングする。

## River Reviewer への組み込み方

- midstream/downstream フェーズの前処理として、AgentCheck の JSON 出力を Runner に渡す。
- 重大度タグを River Reviewer の `severity` (`critical`/`major`/`minor`) に合わせる。
- 追加ルールは `skills/community` やリポジトリ固有のチェックリストと整合させる。

## 注意点

- MIT ライセンスなので再配布は比較的容易だが、依存ライブラリのライセンスも確認する。
- 大規模リポジトリでは実行時間が長い。対象ディレクトリや変更ファイルに絞るオプションを活用する。
