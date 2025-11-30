# スキルの作り方

River Reviewer では、各フェーズ向けのチェックを「スキル」として追加します。スキルは YAML frontmatter + Markdown で定義し、`schemas/skill.schema.json` に準拠します。

## 基本ルール

- 1スキルにつき1つの観点に絞る（例: セキュリティ、パフォーマンス、リリース前チェック）
- 必須フィールド: `id` / `name` / `description` / `phase` / `applyTo`
- `phase` は `upstream` / `midstream` / `downstream` のいずれかとし、ディレクトリ構造も合わせる（例: `skills/midstream/`）

## サンプル

```markdown
---
id: rr-upstream-architecture-001
name: アーキテクチャ整合性チェック
description: ADR と設計ガイドに沿っているかを上流で確認する。
phase: upstream
applyTo:
  - 'docs/adr/**/*.md'
severity: major
tags: [architecture, decision-record]
---

- 変更が既存の ADR と矛盾しないかを確認する。
- 新しい決定が必要な場合、ADR のドラフト作成を促す。
- 影響範囲やリスクが明記されているかをチェックする。
```

保存後、`scripts/rr_validate_skills.py --phase upstream` を実行するとスキーマ検証やフェーズ別の読み込みを行えます。
