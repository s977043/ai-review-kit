# River Review をはじめる

River Review は、ソフトウェア開発ライフサイクルのためのフローベースの AI レビューエージェントです。上流（Upstream）の設計から中流（Midstream）の実装、下流（Downstream）の QA までをカバーします。

このチュートリアルでは、GitHub Actions を使用して最初のレビューを実行する手順を説明します。

## 前提条件

### リポジトリシークレットの設定（AI レビューを使う場合）

ヘッドレスの GitHub Action で **AI レビューまで動かす場合**は、LLM API キー（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` のいずれか）をリポジトリシークレットとして登録する。

1. GitHub リポジトリの **Settings → Secrets and variables → Actions** を開く。
2. **New repository secret** をクリックし、名前を `OPENAI_API_KEY`（または他のプロバイダのキー名）、値を取得済みの API キーに設定する。

> **注意:** サンプルワークフローの `dry_run: true` は LLM への実際の API 呼び出しをスキップする。実際のレビュー出力を得るには、シークレットを登録した上で `dry_run` を `false` に変更すること。
>
> **キーが無くても動くもの:** キー未設定でも、機械的チェック（secret 直書き・マージコンフリクト・`.only` 残しなどの決定論的な観点）はそのまま動く。また、Claude Code などの AI エージェントがスキルを直接適用する通常の使い方では、そもそもキーは不要である（[実行モデル](../explanation/what-is-river-review.md)を参照）。

---

## 1. インストール / 有効化

以下のワークフローを追加してください:

```yaml
name: River Review
on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: s977043/river-review/runners/github-action@v1.22.0
        with:
          phase: midstream
          dry_run: true # 外部 API を呼び出す場合は false に設定
          debug: true # マージベース、トークン見積もり、プロンプトプレビューを表示
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

> 安定性のために `@v1.22.0` のようなリリースタグを指定してください。

## スキルの準備

River Review はスキルファイルを元にレビューを実行する。`skills/midstream/` 以下に少なくとも 1 つのスキルが存在しない場合、ワークフローはエラーなく完了するがレビュー出力は生成されない。

スキルをまだ作成していない場合は [最初のスキルを作成する](./creating-your-first-skill.md) を先に参照すること。

---

## 2. レビューの実行

PR（プルリクエスト）を作成してください。River Review は自動的に以下を行います:

- 変更されたファイルの検出
- 関連スキルの読み込み
- スキーマの検証
- 構造化されたレビューコメントの出力

これでフローに乗る準備が整いました。

## 3. 結果の確認

PR が作成されると、Actions ワークフローが自動的に実行されます。結果は次の 2 か所で確認できます:

- **PR のコメントスレッド** — River Review がレビューコメントを直接 PR に投稿します（`dry_run: false` の場合）。
- **Actions のログ** — ワークフロー実行ページでトークン見積もり、スキル読み込み結果、スキーマ検証の詳細を確認できます（`debug: true` の場合）。
