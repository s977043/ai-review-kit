# examples/skills/

スキル作成の参考用サンプル集です。ここに置かれたスキルは `skills/registry.yaml` に登録されず、レビュー実行のスキル選択対象にもなりません。

| サンプル                                      | phase      | 参考になる点                             |
| --------------------------------------------- | ---------- | ---------------------------------------- |
| [architecture-sample](./architecture-sample/) | upstream   | 設計・ADR ドキュメント向けスキルの構成例 |
| [code-quality-sample](./code-quality-sample/) | midstream  | コード品質向けスキルの構成例             |
| [test-review-sample](./test-review-sample/)   | downstream | テスト観点スキルの構成例                 |

## 位置づけ

- 本番のスキル群は `skills/upstream|midstream|downstream/` 配下に置き、`skills/registry.yaml` へ登録する
- E2E 疎通保証（最小構成でも必ず 1 スキル選択される状態）は `skills/midstream/hello-skill/` が担う
- 新しいスキルを作る際は `skills/_template.md` と `pages/guides/add-new-skill.md` を参照する

これらのサンプルを実際のレビューで動かしたい場合は、`skills/<phase>/` 配下へコピーして registry に登録してください。
