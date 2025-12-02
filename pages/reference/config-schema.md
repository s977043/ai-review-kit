# コンフィグ / スキーマ概要

River Reviewer では、スキルや出力を JSON Schema で定義します。スキルは YAML frontmatter、出力は JSON を想定しています。

- `schemas/skill.schema.json`
  - 必須: `id` / `name` / `phase` / `applyTo` / `description`
  - 任意: `tags` / `severity`
  - `phase` は `upstream` / `midstream` / `downstream`

- `schemas/output.schema.json`
  - 必須: `issue` / `rationale` / `impact` / `suggestion` / `priority` / `skill_id`
  - `priority` は `P0`〜`P3` のいずれか

スキルは Markdown ファイルとして `skills/{phase}/` に配置し、`scripts/rr_validate_skills.py` でスキーマ検証ができます。
