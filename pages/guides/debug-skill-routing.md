# スキルルーティングのデバッグ

スキルがトリガーされない（または頻繁にトリガーされすぎる）場合、以下のチェックを行います。

## チェックリスト

1. **スキーマ**: スキルが `npm run skills:validate` を通過することを確認する。

   ```bash
   # 正常時の出力例
   $ npm run skills:validate
   ✔ skills/midstream/security/SKILL.md — OK
   ✔ skills/midstream/perf/SKILL.md — OK
   ... (省略)
   All N skills passed validation.

   # 失敗時の出力例（未知の phase 値）
   $ npm run skills:validate
   ✖ skills/midstream/foo/SKILL.md
     ValidationError: "phase" must be one of [upstream, midstream, downstream]
       received: "release"

   # 失敗時の出力例（必須フィールド欠落）
   ✖ skills/upstream/bar/SKILL.md
     ValidationError: "applyTo" is required (or provide "files" / "path_patterns" / "trigger")
   ```

2. **カテゴリ/フェーズ**: `category` が現在のルーティング第一キー（`core` / `upstream` / `midstream` / `downstream`）。`phase` は後方互換エイリアスであり新規スキルでは非推奨。詳細は [config-schema](../reference/config-schema.md) を参照。
3. **applyTo グロブ**: パターンが PR 内のパスと一致しているか確認する。

   グロブの良し悪しの例:

   ```yaml
   # 悪い例 — ルート直下しかマッチしない
   applyTo:
     - '*.ts'

   # 良い例 — サブディレクトリを含むすべての .ts ファイル
   applyTo:
     - '**/*.ts'
   ```

4. **重要度/タグ**: ランナーのフィルタが、スキルを除外するタグや重要度を使用していないか確認する。
5. **最近の変更**: スキルファイルの git履歴を確認し、ルーティングロジックが変更されていないか見直す。

## クイックテスト

スキルの `applyTo` グロブに一致するファイルを変更するドラフト PR を開く。発見事項が表示されない場合は、`--debug` フラグを付けて実行すると、マッチしたスキルと除外されたスキルが確認できる。

```bash
node src/cli.mjs run . --debug
```

出力例（一部）:

```text
Debug info:
- Impact tags: security, performance
- Token estimate: 1240
Matched skills (3): security, perf, code-quality
Skipped skills (2): arch [glob no match], release [phase mismatch]
```

**ゼロトリガーの症状例**: `phase` に `release` など有効でない値を指定すると、validate は失敗し、スキルは一切トリガーされない。`npm run skills:validate` でエラーを確認してから再実行してください。

一時的にグロブを既知の単一パスに絞り込んでから、ワークフローを再実行することも有効です。

スキルの選択基準や推奨スターターセットについては [スキルの選択と組み合わせ](./choose-skills.md) を参照してください。
