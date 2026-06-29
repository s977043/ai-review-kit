# スキルの作り方

River Review では、各フェーズ向けのチェックを「スキル」として追加します。スキルは YAML frontmatter + Markdown で定義し、`schemas/skill.schema.json` に準拠します。

## 基本ルール

- 1スキルにつき1つの観点に絞る（例: セキュリティ、パフォーマンス、リリース前チェック）
- 必須フィールド: `id` / `name` / `description` / `category` / `applyTo`
- `category` はルーティングの第一キーで `core` / `upstream` / `midstream` / `downstream` のいずれかとし、ディレクトリ構造も合わせる（例: `skills/midstream/`）。`midstream` スキルをコア直下に置くか `community/` 配下に置くかは `pages/guides/add-new-skill.md` §「配置ディレクトリを選ぶ」を参照する
- `phase` は後方互換のためのみ残存しており、新規スキルでは使用しない

## サンプル

```markdown
---
id: architecture
name: アーキテクチャ整合性チェック
description: ADR と設計ガイドに沿っているかを上流で確認する。
category: upstream
applyTo:
  - 'docs/adr/**/*.md'
severity: major
tags: [architecture, decision-record]
---

- 変更が既存の ADR と矛盾しないかを確認する。
- 新しい決定が必要な場合、ADR のドラフト作成を促す。
- 影響範囲やリスクが明記されているかをチェックする。
```

保存後、`npm run skills:validate` を実行するとスキーマ検証を行えます。フェーズ別の検証が必要な場合は `scripts/rr_validate_skills.py --phase upstream` を直接実行してください。
