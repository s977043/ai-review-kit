# GitHub Actions で River Reviewer をセットアップする

以下は River Reviewer を GitHub Actions で実行する最小ワークフロー例です。`.github/workflows/river-reviewer.yml` などのファイル名で配置してください。

> **⚠️ 重要**: フォークされたリポジトリからの PR では、GitHub がセキュリティ上の理由でリポジトリの secrets を公開しません。外部コントリビューターの PR でレビューを実行する場合は、`pull_request_target` などのイベント選択と権限設定を検討してください。

```yaml
name: River Reviewer
on:
  pull_request:
  push:
    branches: [main]
jobs:
  river-reviewer:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Run River Reviewer (midstream)
        uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.1.1
        with:
          phase: midstream # upstream|midstream|downstream
          dry_run: true # 外部 API を呼ばずに PR コメントを投稿する（フォールバック）
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

PR へのコメント投稿には `issues: write` が必要です。権限不足の場合は workflow の `permissions` を見直してください。

> 最新タグが出ている場合は `@v0.1.1` を置き換えてください。安定動作のため、可能な限りリリースタグへピン留めしてください。
