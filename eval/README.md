# Eval artifacts

このディレクトリには評価/採点に関する補助資料を置きます。

## rubric.yaml

- 用途: severity と phase の定義/説明を統一するためのルーブリックです。
- 参照: 現時点ではコードや CLI から直接読み込まれておらず、運用/設計の参照用です。
- 実行コマンド: rubric.yaml を読む専用コマンドはありません。評価ランナーは `npm run eval:fixtures` を利用します。
