# Config / Schema Overview

## `.river-review.json` (Runtime Config)

Place `.river-review.json` in the repository root to customize review model settings and exclusion conditions. Verified by Zod schema in `src/config/schema.mjs`. Defaults to `src/config/default.mjs` if missing.

### Support Items and Defaults

- `model`
  - `provider`: `openai` (Default). The config schema also accepts `google` / `anthropic`, but the current review pipeline is OpenAI-only (see #490).
  - `modelName`: `gpt-4o-mini` (Default)
  - `temperature`: `0`
  - `maxTokens`: `600`
- `review`
  - `language`: `ja` (Japanese) / `en` (English). Switches prompt body and output language.
  - `severity`: `normal` (Default) / `strict` / `relaxed`
  - `additionalInstructions`: Additional review policies (array). Listed at the end of the prompt.
  - `specDirs`: Extra spec/ADR directories (repo-relative paths, array) scanned when linking changed files to related design docs. Merged with the built-in defaults (`docs/adr` / `pages/explanation` / `specs`).
  - `walkthrough`: When `true`, asks the prompt to add a per-file walkthrough section (summary, risk, suggested reading order) to the review output (default `false`).
  - `agentHandoff`: When `true`, asks the prompt to emit a provider-agnostic Agent Handoff section (goal / target files / constraints / steps / tests / done criteria) so another AI agent can act on blocking findings (default `false`).
  - `promptCompiler` ([#1859](https://github.com/s977043/river-review/issues/1859)): execution mode for the Prompt Compiler. The design source is ADR-006 (`docs/adr/006-model-aware-review-prompt-compiler.md`).
    - `mode`: `off` (default) / `observe` / `active`. `off` bypasses the Prompt Compiler entirely and behaves exactly as before it was introduced. `observe` builds the compiled prompt but does **not** send it to the LLM; it records only the hash, the estimated token count, and the profile provenance under `debug.execution.promptCompiler`. No additional LLM call is made. `active` is accepted by the schema but is not wired up as of [#1859](https://github.com/s977043/river-review/issues/1859) — it behaves like `observe` and still sends the existing prompt. It is enabled in [#1861](https://github.com/s977043/river-review/issues/1861). Note that `shadow` is deliberately not used as a value.
  - `orchestrator` ([#1689](https://github.com/s977043/river-review/issues/1689)): observability settings for the parallel role execution behind `--reviewers`. The key is named `orchestrator` rather than `reviewers` so it cannot be confused with the `--reviewers` CLI flag, which takes a list of role names.
    - `timeoutMs`: per-role wall-clock budget in milliseconds (integer, `1`–`3600000`). Unset by default, meaning no timeout — every role is awaited to completion. A role that exceeds the budget is recorded as a failed role and the run continues with the other roles' findings (fail-soft). The `RIVER_REVIEWER_TIMEOUT` environment variable takes precedence over this key. Out-of-range or non-integer values are rejected with a warning, because `setTimeout` clamps anything above the 32-bit limit to 1 ms and would cut off every role immediately.
    - `progress`: set to `false` to suppress the per-role progress lines (default `true`). Progress is written to stderr only, so the stdout artifact stays clean. The CLI `--quiet` flag takes precedence over this key.
- `exclude`
  - `files`: Glob patterns to exclude from change diffs.
  - `prLabelsToIgnore`: Skips review if Pull Request label contains target keywords. Matches partial case-insensitive against `RIVER_PR_LABELS` (comma separated) or GitHub Actions `GITHUB_EVENT_PATH`.
- `security` ([#692](https://github.com/s977043/river-review/issues/692))
  - `redact.enabled`: `true` (default). Redacts secrets in repo-wide context and prompts before sending to the LLM.
  - `redact.categories`: Toggle individual categories. Keys:
    - Keys: `githubToken` / `openaiKey` / `anthropicKey` / `googleApiKey` / `awsAccessKey` / `awsSecretKey` / `privateKey`
    - Auth: `bearerToken` / `databaseUrl` / `webhookUrl` / `oauthSecret` / `envAssignment`
    - Fallback: `highEntropy`
  - `redact.extraPatterns`: Additional regex (`{ id, pattern, replacement? }`) for project-specific key formats.
  - `redact.allowlist`: Tokens matching these strings are not redacted (useful for protecting test fixtures).
  - `redact.denyFiles`: Globs added to the path-level deny list (on top of the built-in `.env*` / `*.pem` / `*.key` / `secrets.*`).
  - `redact.entropyThreshold`: `3.0`–`6.0` (default `4.5`). Threshold for the Shannon-entropy fallback detector.
  - `redact.entropyMinLength`: Default `24`. Minimum substring length the fallback detector considers.
- `memory` ([#687](https://github.com/s977043/river-review/issues/687))
  - `suppressionEnabled`: `true` (default). Applies suppression entries from Riverbed Memory. Set to `false` to bypass the gate (emergency override).
- `context` ([#689](https://github.com/s977043/river-review/issues/689))
  - `reviewMode`: `tiny` / `medium` / `large`. When `budget` is omitted, the preset from `src/lib/context-presets.mjs` is applied. An explicit `budget` always wins.
  - `budget.maxTokens`: `256`–`64000`.
  - `budget.maxChars`: `1024`–`200000`. Both char and token caps apply simultaneously.
  - `budget.perSectionCaps`: Per-section char caps for `fullFile` / `tests` / `usages` / `config`.
  - `ranking.enabled`: `true` to enable proximity-based reordering of context candidates.
  - `ranking.weights`: Per-signal weights for `pathProximity` / `symbolUsage` / `siblingTest` / `commitRecency`, each in `0.0`–`1.0`. Equal weighting if omitted.
  - `tokenizer`: Only `heuristic` is accepted (reserved for future expansion).
- `artifacts`
  - Declares paths to input artifacts. Accepts these 12 IDs: `pbi-input` / `plan` / `todo` / `test-cases` / `review-self` / `review-external` / `diff` / `junit` / `coverage` / `lint` / `typecheck` / `findings-pool`.
  - Each value is a string path, or an object `{ "path": "...", "optional": <boolean> }` (`optional` is a boolean).
  - Unknown keys are accepted for forward compatibility (catchall). See the [Artifact Input Contract](./artifact-input-contract.md) for the resolution order and per-artifact contract.

- `selection` (skill pack adoption)
  - `packs`: array of pack ids to adopt (e.g. `[typescript, ddd]`). Multiple packs are set-unioned by skill id so each skill runs at most once.
  - `tags`: cross-cutting additions; skills carrying any listed tag join the selection.
  - `skills.include` / `skills.exclude`: add or drop individual skills. Precedence: `exclude > include > union(packs, tags)`.
  - `minTier`: `official` / `community` / `experimental`. Explicitly listed `packs` below minTier still run (warning only).
  - When `--skill-set` is passed on the CLI it overrides the config selection. See [examples/selection/](https://github.com/s977043/river-review/tree/main/examples/selection) for samples.

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

River Review defines skills and outputs using JSON Schema. Skills assume YAML frontmatter, outputs assume JSON.

- `schemas/skill.schema.json`
  - Required: `id` / `name` / `description` / `category` (plus one of `phase` / `category` / `trigger`, and one of `applyTo` / `files` / `path_patterns` / `trigger`)
  - Optional: `tags` / `severity` / `inputContext` / `outputKind` / `modelHint` / `dependencies`
  - `category` is one of `core` / `upstream` / `midstream` / `downstream` and is the primary routing key. `phase` is kept for backward compatibility.

- `schemas/output.schema.json`
  - Required: `issue` / `rationale` / `impact` / `suggestion` / `priority` / `skill_id`
  - `priority`: `P0` to `P3`

Skills are placed as Markdown files in `skills/{category}/` and can be schema-validated with `npm run skills:validate`.
