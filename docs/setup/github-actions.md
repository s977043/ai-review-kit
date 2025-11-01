# GitHub ActionsでAI Review Kitをセットアップする

以下はAI Review KitをGitHub Actionsで実行するための最小ワークフロー例です。
`.github/workflows/ai-review.yml`などのファイル名で作成し、pushイベント時に自動的に実行されます。

> **⚠️ 重要**: フォークされたリポジトリからのPRでは、GitHubがセキュリティ上の理由でリポジトリのsecretsを公開しません。外部コントリビューターからのPRでレビューを実行する場合は、`pull_request_target`イベントの使用を検討するか、適切な権限スコープを設定してください。

```yaml
name: AI Review Kit
on:
  pull_request:
  push:
    branches: [main]
jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 20
      - name: Run AI Review Kit
        # 注: 実際のアクション参照に置き換えてください
        # 例: your-org/your-action@v1
        uses: s977043/ai-review-kit-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

GitHub Appまたはパーソナルアクセストークンを使って認証情報を満たすように設定してください。
