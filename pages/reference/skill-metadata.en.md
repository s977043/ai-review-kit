# Skill Metadata Specification (Issue #68 Design)

River Reviewer skills hold metadata in YAML frontmatter, which loaders/runners use to select and execute them. This specification summarizes field definitions serving as the foundation for JSON Schema, TypeScript types, and runner implementation.

## 1. Purpose

- Enable mechanical skill selection and routing based solely on metadata.
- Serve as the "single source of truth" for implementing JSON Schema / TypeScript types.
- Design at a granularity that makes future runner/loader extensions (model selection, dependency tool calls, etc.) easy.

## 2. Current Basic Items (Inventory of `skills/*`)

Keys and roles used in current skills:

| Field         | Type                                              | Required | Role                                                                                  |
| ------------- | ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `id`          | string                                            | yes      | Unique Skill ID (Recommend `rr-<phase>-<slug>-###`). Invariant across rename/move.    |
| `name`        | string                                            | yes      | Human-readable name displayed in review output.                                       |
| `description` | string                                            | yes      | Short description of what the skill checks.                                           |
| `phase`       | enum (`upstream` \| `midstream` \| `downstream`)  | yes      | Which SDLC flow to apply in. Primary key for routing.                                 |
| `applyTo`     | string[]                                          | yes      | File glob for check target. Used by runner to filter files.                           |
| `trigger`     | object                                            | optional | Trigger container grouping `phase`/`applyTo`. `trigger.files` is alias for `applyTo`. |
| `tags`        | string[]                                          | optional | Classification tags (e.g., `security`, `performance`).                                |
| `severity`    | enum (`info` \| `minor` \| `major` \| `critical`) | optional | Severity. Used for output emphasis or sorting.                                        |

## 3. Extension Items (Designed Here)

Defining items with manageable granularity for future model selection and input preparation.

| Field          | Type          | Required                           | Purpose / Use Case                                                                                      | Example Allowed Values                                                                    |
| -------------- | ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `inputContext` | enum string[] | optional                           | Input source assumed by skill. Runner prepares context or decides to skip if missing.                   | `diff`, `fullFile`, `tests`, `adr`, `commitMessage`, `repoConfig`                         |
| `outputKind`   | enum string[] | optional (default: `["findings"]`) | Output category produced. Used for UI sorting/aggregation or downstream branching. Multiple allowed.    | `findings`, `summary`, `actions`, `tests`, `metrics`, `questions`                         |
| `modelHint`    | enum string   | optional                           | Cost/Accuracy guide for model selection. Hint for runner to choose model within token/cost constraints. | `cheap`, `balanced`, `high-accuracy`                                                      |
| `dependencies` | enum string[] | optional                           | Tools/Resources required by skill. Runner decides skip or degrade if unmet before execution.            | `code_search`, `test_runner`, `adr_lookup`, `repo_metadata`, `coverage_report`, `tracing` |

Values for `outputKind` (Guidelines to prevent interpretation drift):

- `findings`: Code issues/improvements (Default)
- `summary`: Summary of entire review
- `actions`: Concrete actions or commands for implementer
- `questions`: Confirmation items or unresolved questions for implementer
- `metrics`: Measured values like complexity/coverage
- `tests`: Generated tests or test case suggestions

Notes:

- Enums assume fixed lists in implementation. If outside values are needed, assume extension via `custom:<name>` prefix.
- Dependency tools are kept to units where runner/loader availability is clear (code search, test runner, ADR lookup, etc.).

## 4. TypeScript Interface Example

Example ready for implementation use.

```ts
type Phase = 'upstream' | 'midstream' | 'downstream';
type Severity = 'info' | 'minor' | 'major' | 'critical';

type InputContext = 'diff' | 'fullFile' | 'tests' | 'adr' | 'commitMessage' | 'repoConfig';

type OutputKind = 'findings' | 'summary' | 'actions' | 'tests' | 'metrics' | 'questions';

type ModelHint = 'cheap' | 'balanced' | 'high-accuracy';

type Dependency =
  | 'code_search'
  | 'test_runner'
  | 'adr_lookup'
  | 'repo_metadata'
  | 'coverage_report'
  | 'tracing';

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  phase: Phase;
  applyTo: string[];
  tags?: string[];
  severity?: Severity;
  inputContext?: InputContext[];
  outputKind?: OutputKind[]; // default ['findings']
  modelHint?: ModelHint;
  dependencies?: Dependency[];
}
```

## 5. JSON Schema Implementation Notes

- `phase` and `severity` remain fixed enums.
- `inputContext` is `type: array`, `items.enum` fixed to list above, `minItems: 1`, `uniqueItems: true` recommended.
- `outputKind` similarly array + enum + `minItems: 1`. Default `['findings']` only if field omitted; empty array not allowed if field exists.
- `modelHint` is single enum. Not required.
- `dependencies` is array + enum + `uniqueItems: true`. Disallow outside values to prevent unimplemented tools; allow pattern for `custom:*` only if exception needed.
- Maintain `additionalProperties: false` to prevent schema drift.

## 6. Sample Frontmatter (Before/After)

### Before (Current fields only)

```yaml
---
id: rr-midstream-code-quality-sample-001-en
name: 'Sample Code Quality Pass'
description: 'Checks common code quality and maintainability risks.'
phase: midstream
applyTo:
  - 'src/**/*.ts'
  - 'src/**/*.js'
  - 'src/**/*.py'
tags:
  - style
  - maintainability
  - midstream
severity: 'minor'
---
```

### After (Adding extension fields)

```yaml
---
id: rr-midstream-code-quality-sample-001-en
name: 'Sample Code Quality Pass'
description: 'Checks common code quality and maintainability risks.'
phase: midstream
applyTo:
  - 'src/**/*.ts'
  - 'src/**/*.js'
  - 'src/**/*.py'
tags:
  - style
  - maintainability
  - midstream
severity: 'minor'
inputContext:
  - diff
  - fullFile
outputKind:
  - findings
  - actions
modelHint: balanced
dependencies:
  - code_search
---
```

### After (Using trigger container)

```yaml
---
id: rr-midstream-code-quality-sample-001-en
name: 'Sample Code Quality Pass'
description: 'Checks common code quality and maintainability risks.'
trigger:
  phase: midstream
  files:
    - 'src/**/*.ts'
tags:
  - style
  - maintainability
  - midstream
severity: 'minor'
inputContext:
  - diff
  - fullFile
outputKind:
  - findings
  - actions
modelHint: balanced
dependencies:
  - code_search
---
```

## 7. Implementer Notes

- Runner skips skills where `inputContext` cannot be met (e.g., exclude skills requiring `adr` when ADRs are not fetched), combining with `phase` / `applyTo` checks.
- Use `outputKind` to separate UI/output formatting (e.g., `summary` at top, `actions` listed as ToDo).
- Use `modelHint` in combination with phase and cost limits to select models. 3-level enum is sufficient initially.
- Match `dependencies` against runner/loader's tool checklist; choose graceful skip or fallback if unsupported.
- If enum granularity needs increasing, agree before implementation (especially `outputKind` and `dependencies`).
