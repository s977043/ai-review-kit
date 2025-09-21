# GitHub ActionsでAI Review Kitをセットアップする

以下はAI Review KitをGitHub Actionsで実行するための最小ワークフロー例です。。
`.github/workflows/ai-review.yml`などのファイル名で作成し、pushイベント時に自動的に実行されます。

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
      - uses: actions/checkout@v3
      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 20
      - name: Run AI Review Kit
        uses: s977043/ai-review-kit-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

GitHub Appまたはパーソナルアクセストークンを使って認証情報を満たすように設定してください。
