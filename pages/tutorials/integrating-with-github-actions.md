# GitHub Actions との連携

River Reviewer をリポジトリに組み込み、すべての PR でフェーズを意識したフィードバックが得られるようにします。

## 1. ワークフローの追加

`.github/workflows/river-review.yml` を作成します:

```yaml
name: River Reviewer
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: {org}/{repo}/.github/actions/river-reviewer@v0.1.0
        with:
          phase: midstream
          dry_run: true
          debug: false
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

> 安定性のために `@v0.1.0` のようなリリースタグを指定してください。

## 2. クレデンシャルをフローから分離する

- デフォルトでは、River Reviewer はクレデンシャルや API キーを必要としません。
- レビューアが追加のコンテキストや外部 API アクセスを必要とする場合は、リポジトリまたは組織の Secrets 経由でトークンを渡し、必要な Secrets を文書化してください。

## 3. フェーズごとの調整

- スキルに `phase: upstream|midstream|downstream` タグを付けます。
- 必要に応じて、ワークフローでパスフィルタを使用してレビューアの実行タイミングを制限します。

## 4. プッシュごとの検証

`npm run skills:validate` を実行して、スキーマの変更を早期に検出できるようにします。大規模なリポジトリでは、pre-commit フックや専用の CI ジョブでの検証を検討してください。
