# PR-Agent GitHub Actions 導入メモ

## 最小構成例

```yaml
name: pr-agent-review
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run PR-Agent
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          pip install pr-agent
          pr-agent --pr_url "${{ github.event.pull_request.html_url }}" --config pr_agent/settings.yaml
```

## River Reviewer 向け調整

- `pr_agent/settings.yaml` でコメント言語を日本語に設定し、重大度タグを付与する。
- Runner で扱えるよう、pr-agent の JSON 出力をファイルに保存し、後続ステップで集約する。
- 自動コメントの上限を設定し、重大度ごとにグループ化して投稿する。

## 注意点

- AGPL ライセンスのため、クローズドソースでの再配布や改変はポリシー確認が必須。
- GitHub トークンは最小権限（`pull_request:read`, `contents:read` など）で付与する。
