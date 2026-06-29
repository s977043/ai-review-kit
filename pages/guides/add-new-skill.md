---
title: スキルを追加する（最短手順）
---

River Review に新しいスキル（`skills/**/*.md`）を追加して、検証し、ローカルで動かすまでの **最短パス** をまとめます。

より詳しい書き方（アンチパターン、Evidence、Non-goals、誤検知ガードなど）は `pages/guides/write-a-skill.md` を参照してください。

## 0) 前提

- Node.js（このリポは `node --test` を使用する）
- 依存を入れていない場合は `npm ci` を実行する

## 1) 配置ディレクトリを選ぶ

スキルを置く場所は **category × first-party / community** の 2 軸で決まります。

### Category（`core` / `upstream` / `midstream` / `downstream`）

スキルの `category` フィールドと同名のディレクトリに置きます（例: `category: midstream` → `skills/midstream/`）。

### First-party vs Community

| 配置                          | 対象                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `skills/midstream/` (直下)    | コアメンテナーが管理・評価した第一級スキル。`recommended: true` が基本                                                      |
| `skills/midstream/community/` | 外部コントリビューター由来、またはサードパーティのライブラリ・フレームワーク固有のスキル。`recommended: false` がデフォルト |

**community/ に置く目安（いずれか 1 つでも該当すれば community）:**

- 特定の外部ライブラリ / フレームワークを対象にしている（例: Next.js、Tailwind、Prisma）
- コアメンテナー以外から提供されたスキル
- good/bad フィクスチャとゴールデン出力がまだ整備されていない実験的スキル

community スキルはフィクスチャと golden output を揃えると `recommended: true` 昇格の候補になります（詳細: `pages/guides/governance/skill-policy.md`）。

**決定例:**

- 「TypeScript の型安全チェック」→ 言語レベルの汎用スキル → `skills/midstream/` 直下
- 「Next.js App Router の境界チェック」→ フレームワーク固有 → `skills/midstream/community/`

## 2) ひな形からスキルを作る

1. `skills/_template.md` をコピーして、選んだディレクトリに配置する。
   - 例 (first-party): `skills/midstream/my-skill.md`
   - 例 (community): `skills/midstream/community/nextjs-my-skill/SKILL.md`
2. YAML frontmatter を最低限埋める（必須フィールドは `schemas/skill.schema.json` を参照する）。
   - `id`: 一意な ID（例: `my-skill`）
   - `name`: スキル名
   - `description`: 何を検知/指摘するか（短く）
   - `category`: `core` / `upstream` / `midstream` / `downstream` のいずれか（ルーティングの第一キー）
   - `applyTo`: 対象ファイルの glob（まずは狭めるのが推奨）。`files` / `path_patterns` も別名として利用可能。
   - `phase`: 後方互換が必要な場合のみ併記する（新規スキルでは `category` のみで十分）

メタデータの詳細定義は `pages/reference/metadata-fields.md` を参照してください。

## 3) スキーマ検証を通す

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
