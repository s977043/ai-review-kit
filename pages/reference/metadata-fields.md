# Metadata Fields

Use these fields to keep skill metadata consistent and easy to route.

| Field | Purpose |
| --- | --- |
| `id` | Unique identifier (recommended `rr-xxxx` format). |
| `name` | Human-readable skill name shown in reviews. |
| `description` | Short summary of what the skill checks. |
| `phase` | Flow segment the skill belongs to: `upstream`, `midstream`, or `downstream`. |
| `applyTo` | Glob patterns for files the skill should inspect. |
| `tags` | Optional classifiers (for example, `security` or `performance`). |
| `severity` | Optional impact level: `info`, `minor`, `major`, `critical`. |
| `inputContext` | Required inputs the skill expects (for example `diff`, `fullFile`, `tests`, `adr`, `commitMessage`, `repoConfig`). |
| `outputKind` | Output categories produced (for example `findings`, `summary`, `actions`, `tests`, `metrics`, `questions`). Defaults to `findings` if omitted. |
| `modelHint` | Model selection hint: `cheap` / `balanced` / `high-accuracy`. |
| `dependencies` | Required tools/resources (for example `code_search`, `test_runner`, `adr_lookup`, `repo_metadata`, `coverage_report`, `tracing`, or `custom:*`). |

Keep metadata in front matter so it can be parsed before the instructions run. All required fields must pass checks using `/schemas/skill.schema.json`.
