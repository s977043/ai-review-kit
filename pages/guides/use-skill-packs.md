# Skill Pack を使う

Skill Pack は、オープンなレビューナレッジ（TypeScript レビュー、DDD レビューなど）を梱包済みで配布する単位です。
skill を自作しなくても、pack を選ぶだけでレビューが機能します。

## pack を導入する

`--skill-set <pack-id>` で pack を指定して実行します。

```bash
# TypeScript pack（型安全・null 安全・型駆動設計）でレビュー
river run . --skill-set typescript

# 複数 pack はカンマ区切りで指定する（skill は重複なく 1 回ずつ実行される）
river run . --skill-set typescript,basic
```

利用できる pack の一覧は [Skills Catalog](../reference/skills-catalog.md) の冒頭を参照してください。

## pack の成熟度（tier）

| tier           | 意味                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| `official`     | 全 skill が fixture / canary / eval を備え、maintainer review を通過済み |
| `community`    | fixture はあるが canary / eval が不完全。opt-in での利用を推奨           |
| `experimental` | アイデア段階。動作するが品質ゲートは未整備                               |

tier の機械判定は `npm run packs:tier` で確認できます。

## 既存の recommendations との関係

pack は registry の `recommendations:`（旧来の skill set）の後継です。

- `--skill-set <name>` は **packs を先に検索**し、見つからなければ recommendations にフォールバックする
- 同名が両方に存在する場合は pack が優先され、警告が表示される
- 旧 `typescript` recommendation 相当の構成は `--skill-set typescript,basic` で再現できる

## pack を自作する

manifest の雛形は [scripts/templates/pack/pack.yaml](https://github.com/s977043/river-review/blob/main/scripts/templates/pack/pack.yaml) に、設計方針・軸定義・tier 昇格条件は [skill-pack-design.md](https://github.com/s977043/river-review/blob/main/docs/development/skill-pack-design.md) にあります。pack は skill を id で参照する静的リストであり、skill ファイルの移動は不要です。
