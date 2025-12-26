# GitHub Actions との連携

River Reviewer をリポジトリへ組み込み、すべての PR でフェーズを意識したフィードバックが得られるようにする。

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

> 安定性のために `@v0.1.0` のようなリリースタグを指定する。

## 2. クレデンシャルをフローから分離する

- デフォルトでは、River Reviewer はクレデンシャルや API キーを必要としない。
- レビューアが追加のコンテキストや外部 API アクセスを必要とする場合は、リポジトリまたは組織の Secrets 経由でトークンを渡し、必要な Secrets を文書化する。

## 3. フェーズごとの調整

- スキルに `phase: upstream|midstream|downstream` タグを付ける。
- 必要であれば、ワークフローのパスフィルタで実行タイミングを絞り込む。

## 4. プッシュごとの検証

`npm run skills:validate` を実行し、スキーマ変更の早期検出に役立てる。大規模なリポジトリでは、pre-commit フックや専用の CI ジョブへ組み込むことを検討する。
