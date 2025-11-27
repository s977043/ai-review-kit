# Metadata Fields

Use these fields to keep skill metadata consistent and easy to route.

| Field | Purpose |
| --- | --- |
| `id` | Unique identifier (recommended `rr-xxxx` format). |
| `name` | Human-readable skill name shown in reviews. |
| `description` | Short summary of what the skill checks. |
| `phase` | Flow segment the skill belongs to: `upstream`, `midstream`, or `downstream`. |
| `applyTo` | Glob patterns for files the skill should inspect. |
| `tags` | Optional classifiers (e.g., `security`, `performance`). |
| `severity` | Optional impact level: `info`, `minor`, `major`, `critical`. |

Keep metadata in front matter so it can be parsed before the instructions run. All required fields are validated against `/schemas/skill.schema.json`.
