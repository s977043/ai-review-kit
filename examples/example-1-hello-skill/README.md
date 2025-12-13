# example-1: Hello Skill（最小）

最小構成で「PRにコメントが返る」体験を通すサンプルです。

## できること

- GitHub Actions で River Reviewer を実行
- `dry_run: true` で外部APIを呼ばずにコメント投稿まで確認

## セットアップ

1. このディレクトリを対象リポジトリにコピーします（`.github/workflows/` を含む）
2. PR を作成します

## 補足

- `phase: midstream` では Hello Skill が常に候補に入ります（このリポに同梱されています）。
- 実運用では `dry_run: false` にして LLM レビューを有効化してください。
