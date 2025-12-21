# AgentCheck 導入メモ

## インストールと実行

AgentCheck は `devlyai/AgentCheck` のテンプレートをローカルに取り込んで使う形が基本です（npm パッケージ前提ではありません）。

1. 取り込み（例）

   ```bash
   git clone https://github.com/devlyai/AgentCheck.git .claude-temp
   mkdir -p .claude
   cp -r .claude-temp/agentcheck .claude/
   cp -r .claude-temp/agents .claude/
   rm -rf .claude-temp
   echo ".claude/agentcheck/reports/" >> .gitignore
   ```

2. Claude Code でプロジェクトコンテキストを初期化する（例: `Initialize AgentCheck context for this project`）。
3. Claude Code で分析を実行し、`.claude/agentcheck/reports/` に出力された結果を River Reviewer の `output.schema.json` にマッピングする。

## River Reviewer への組み込み方

- midstream/downstream フェーズの前処理として、AgentCheck の JSON 出力を Runner に渡す。
- 重大度タグを River Reviewer の `severity`（`info`/`minor`/`major`/`critical`）に合わせる。
- 追加ルールは `skills/community` やリポジトリ固有のチェックリストと整合させる。

## 注意点

- MIT ライセンスなので再配布は比較的容易だが、依存ライブラリのライセンスも確認する。
- 大規模リポジトリでは実行時間が長い。対象ディレクトリや変更ファイルに絞るオプションを活用する。
