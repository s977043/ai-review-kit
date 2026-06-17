# GitHub Actions で River Review をセットアップする

以下は River Review を GitHub Actions で実行する最小ワークフロー例です。`.github/workflows/river-review.yml` などのファイル名で配置してください。

> **⚠️ 重要**: フォークされたリポジトリからの PR では、GitHub がセキュリティ上の理由でリポジトリの secrets を公開しません。外部コントリビューターの PR でレビューを実行する場合は、`pull_request_target` などのイベント選択と権限設定を検討してください。

```yaml
name: River Review
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
jobs:
  river-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Run River Review (midstream)
        uses: s977043/river-review/runners/github-action@v1.22.0
        with:
          phase: midstream # upstream|midstream|downstream を参照
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## phase の選び方

| phase        | タイミング                                 | 代表的なトリガー                                       | 用途                                                  |
| ------------ | ------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------- |
| `upstream`   | マージ前ゲート（ドラフト／レビュー依頼時） | `pull_request: types: [ready_for_review]`              | 品質チェックをドラフト段階で実施したい場合            |
| `midstream`  | PR オープン・同期時のレビュー（**推奨**）  | `pull_request: types: [opened, synchronize, reopened]` | PR が更新されるたびにレビューを実行する一般的なケース |
| `downstream` | マージ後の分析                             | `push` / `workflow_run`                                | マージ済みコードの品質集計やレトロスペクティブ用途    |

ほとんどのチームは **`midstream`** を選んでください。PR が開かれたタイミングと差分が更新されるたびにレビューが実行されます。

PR へのコメント投稿には `issues: write` が必要です。権限不足の場合は workflow の `permissions` を見直してください。

> 例では `@v1.22.0` に固定しています。新しいリリースが出た場合はそのタグへ置き換えてください。安定動作のため、可能な限りリリースタグへピン留めしてください。

## Anthropic (Claude) を使う場合

`.river-review.json`（リポジトリルートに配置）で `claude-*` モデルを指定し、`ANTHROPIC_API_KEY` を渡します。設定できる全フィールドは [設定スキーマリファレンス](../reference/config-schema.md) を参照してください。

```yaml
- name: Run River Review (midstream, Claude)
  uses: s977043/river-review/runners/github-action@v1.22.0
  with:
    phase: midstream
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

```json
{
  "model": {
    "provider": "anthropic",
    "modelName": "claude-sonnet-4-6",
    "temperature": 0
  }
}
```

`RIVER_ANTHROPIC_API_KEY` を fallback として参照するため、他のツールとキーを分けたい場合はそちらを使っても動作します。
