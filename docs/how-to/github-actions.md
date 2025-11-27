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
    steps:
      - uses: actions/checkout@v5
      - name: Run River Reviewer
        uses: s977043/river-reviewer@v0
        with:
          phase: midstream # upstream|midstream|downstream|all
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

GitHub App または Personal Access Token を使い、必要な認証情報を secrets へ設定してください。
