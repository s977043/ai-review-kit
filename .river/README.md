# .river ディレクトリについて

- `.river/rules.md`: プロジェクト固有のレビュールールを記載すると、River Reviewer のプロンプトに自動注入されます。
- `.river/rules.template.md`: ルール記述用のテンプレート。必要なセクションを参考に `rules.md` を作成してください。

## 使い方

1. `cp .river/rules.template.md .river/rules.md`
2. 各セクションにプロジェクトの方針・禁止事項・推奨パターンを記述
3. `river run . --dry-run --debug` でルールが読み込まれているか確認

Tips:

- リポジトリの秘密情報は書かない（例示する場合はダミー値で）
- 運用で変更があれば `rules.md` を更新し、レビュー基準を共有する
