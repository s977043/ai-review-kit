---
title: スキルを追加する（最短手順）
---

River Reviewer に新しいスキル（`skills/**/*.md`）を追加して、検証し、ローカルで動かすまでの **最短パス** をまとめます。

より詳しい書き方（アンチパターン、Evidence、Non-goals、誤検知ガードなど）は `pages/guides/write-a-skill.md` を参照してください。

## 0) 前提

- Node.js（このリポは `node --test` を使用する）
- 依存を入れていない場合は `npm ci` を実行する

## 1) ひな形からスキルを作る

1. `skill_template.md` をコピーして、対象フェーズ配下に配置する。
   - 例: `skills/midstream/rr-midstream-my-skill-001.md`
2. YAML frontmatter を最低限埋める（必須フィールドは `schemas/skill.schema.json` を参照する）。
   - `id`: 一意な ID（例: `rr-midstream-my-skill-001`）
   - `name`: スキル名
   - `description`: 何を検知/指摘するか（短く）
   - `phase`: `upstream|midstream|downstream`
   - `applyTo`: 対象ファイルの glob（まずは狭めるのが推奨）

メタデータの詳細定義は `pages/reference/metadata-fields.md` を参照してください。

## 2) スキーマ検証を通す

```bash
npm run skills:validate
```

失敗したら、エラーメッセージに出るフィールド（必須欠落/enum 不一致など）を修正して再実行します。

## 3) ローカルで dry-run 実行する（API なし）

LLM を使わずにまず動作確認する場合（再現性重視）:

```bash
river run . --phase midstream --dry-run --debug --context diff,fullFile
```

ポイント:

- `applyTo` が変更ファイルにマッチしないと、そのスキルは選ばれない。
- `inputContext` を付けている場合、`--context` に含まれないとスキップされる。
  - 迷う場合は、まず `inputContext: [diff]` から始めるのが安全である。

## 4) PR に含める最小チェック

- `npm run skills:validate`
- `npm test`
- 可能なら、誤検知ガード/Non-goals の確認観点（何を言わないか）
