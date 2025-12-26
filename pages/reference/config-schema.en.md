# Config / Schema Overview

## `.river-reviewer.json` (Runtime Config)

Place `.river-reviewer.json` in the repository root to customize review model settings and exclusion conditions. Verified by Zod schema in `src/config/schema.mjs`. Defaults to `src/config/default.mjs` if missing.

### Support Items and Defaults

- `model`
  - `provider`: `openai` (Default. Currently the only supported provider. `google`/`anthropic` are placeholders for future expansion)
  - `modelName`: `gpt-4o-mini` (Default)
  - `temperature`: `0`
  - `maxTokens`: `600`
- `review`
  - `language`: `ja` (Japanese) / `en` (English). Switches prompt body and output language.
  - `severity`: `normal` (Default) / `strict` / `relaxed`
  - `additionalInstructions`: Additional review policies (array). Listed at the end of the prompt.
- `exclude`
  - `files`: Glob patterns to exclude from change diffs.
  - `prLabelsToIgnore`: Skips review if Pull Request label contains target keywords. Matches partial case-insensitive against `RIVER_PR_LABELS` (comma separated) or GitHub Actions `GITHUB_EVENT_PATH`.

### Configuration Example

```json
{
  "model": { "provider": "openai", "modelName": "gpt-4o", "temperature": 0.2 },
  "review": {
    "language": "en",
    "severity": "strict",
    "additionalInstructions": ["Focus on security", "Prefer readable variable names"]
  },
  "exclude": {
    "files": ["**/*.md", "docs/**"],
    "prLabelsToIgnore": ["no-review", "wip"]
  }
}
```

### Operational Tips

- List labels to skip in CI in `prLabelsToIgnore` and ensure they can be read from `RIVER_PR_LABELS` (e.g., `RIVER_PR_LABELS=no-review,wip`) or GitHub event payload.
- Verify schema integrity and behavior with `npm test` or `npm run lint` after changing settings.

## JSON Schema (Skill / Output)

River Reviewer defines skills and outputs using JSON Schema. Skills assume YAML frontmatter, outputs assume JSON.

- `schemas/skill.schema.json`
  - Required: `id` / `name` / `phase` / `applyTo` / `description`
  - Optional: `tags` / `severity`
  - `phase`: `upstream` / `midstream` / `downstream`

- `schemas/output.schema.json`
  - Required: `issue` / `rationale` / `impact` / `suggestion` / `priority` / `skill_id`
  - `priority`: `P0` to `P3`

Skills are placed as Markdown files in `skills/{phase}/` and can be schema-validated with `scripts/rr_validate_skills.py`.
