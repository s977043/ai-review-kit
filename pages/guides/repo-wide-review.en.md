# Adopting and tuning repo-wide review

This guide walks you through evolving River Review from "review the PR diff only" to "review with the surrounding repository context in mind." Japanese is the source of truth; this English version follows behind.

Related:

- Parent Epic: [#650 Greptile-inspired repo-wide review capabilities](https://github.com/s977043/river-review/issues/650)
- Existing guides: [Quickstart](./quickstart.en.md) / [GitHub Actions setup](./github-actions.en.md) / [Troubleshooting](./troubleshooting.en.md)
- See also: [Skill authoring guide](./write-a-skill.en.md) / [Review policy](../reference/review-policy.en.md)

## Intended audience

- Teams who already use River Review and want to go beyond diff-only review
- Engineers who need to catch cross-file inconsistencies that a single changed file cannot reveal — leftover locale entries, normalization drift, API compatibility breaks, missing tests, and so on
- Operators who want to organize how `.river-review.yaml` and `.river/rules.md` are governed

## Problems repo-wide review solves

Diff-only review has the following blind spots.

- Cannot notice that an `en.json` entry was left behind for a removed translation key
- Cannot confirm that naming and normalization for the same domain concept stay aligned with surrounding code
- Cannot confirm that tests are added when API compatibility is broken
- Cannot confirm consistency with shared patterns (loading state, null contracts, observability, …)

repo-wide review automatically gathers "related files," "tests," "symbol usages," and "config files" derived from the changed files and ships them to the review LLM as context. This raises the chance of catching the cross-file mismatches above.

## Minimal adoption steps

1. Place `.river-review.yaml` at the repo root (see the example below).
2. Create `.river/rules.md` (`cp` from `.river/rules.template.md`).
3. Optionally add `.river/risk-map.yaml` (omittable; the default action is `comment_only`).
4. Add a GitHub Actions workflow at `.github/workflows/river-review.yml`.
5. Register model keys such as `OPENAI_API_KEY` as repository Secrets.
6. Open a PR and verify findings are posted as comments.

### Minimal GitHub Actions workflow

```yaml
name: River Review (repo-wide)
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
jobs:
  river-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0 # required so the repo-wide context collector can read surrounding commit history
      - name: Run River Review (midstream)
        uses: s977043/river-review/runners/github-action@v1.22.0
        with:
          phase: midstream
          dry_run: false
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

> The example pins `@v1.22.0`. Replace it with the latest release tag when one ships.
>
> `fetch-depth: 0` is required so the repo-wide context collector can read commit history and related files around the changed files. A shallow clone degrades the collector.

## Configuration files

### `.river-review.yaml`

This is the legacy configuration that maps to `riverReviewerConfigSchema` in `src/config/schema.mjs`. Example:

```yaml
model:
  provider: openai
  modelName: gpt-4o-mini
  temperature: 0.2
  maxTokens: 600
review:
  language: ja
  severity: normal
  additionalInstructions:
    - 'Verify consistency not only against the PR diff but also with surrounding tests, locales, and type definitions.'
    - 'Severity has four levels: critical / major / minor / info. Major or higher requires concrete evidence.'
exclude:
  files:
    - 'package-lock.json'
    - 'pnpm-lock.yaml'
    - '**/*.snap'
  prLabelsToIgnore:
    - 'skip-review'
    - 'release'
```

> Values are validated by zod. Unknown keys produce only a warning and execution continues (see `src/config/loader.mjs`).

### `.river/rules.md`

Write repository-specific review policy in Markdown; it is auto-injected into the LLM prompt. The recommended workflow is to copy `.river/rules.template.md` and rewrite only the sections you need.

```markdown
# Project-specific Review Rules

## Architecture

- Prefer Next.js App Router and server components
- Place shared logic under `src/lib/` and UI under `src/components/`

## Forbidden Patterns

- Use of `any` (substitute with unknown + narrowing)
- Synchronous `fs` calls (use `fs.promises`)
- Direct `localStorage` access inside React components

## Recommended Libraries

- HTTP client: `fetch` or `ky`
- State management: Zustand
- Date handling: `date-fns` (`moment` is forbidden)

## Testing Requirements

- New use cases require unit tests (under `tests/use-cases/`)
- API boundary changes require integration tests
```

> Do not include repository secrets (tokens, internal IDs). Use dummy values when illustrating.

### `.river/risk-map.yaml`

Declares "how strictly to review" per file path glob. Rules match in order from the top, and the first hit wins (first-match-wins). See `schemas/risk-map.schema.json`.

```yaml
version: '1'
rules:
  - pattern: 'src/lib/security/**'
    action: require_human_review
    reason: 'Security logic must not be approved by the LLM alone'
  - pattern: 'src/lib/payments/**'
    action: escalate
    reason: 'Payment paths must be promoted to major or higher'
  - pattern: 'pages/**/*.md'
    action: comment_only
    reason: 'Docs receive findings but are not gated'
defaults:
  action: comment_only
```

`action` semantics (enum from `schemas/risk-map.schema.json`):

| action                 | Behavior                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `comment_only`         | Post findings as usual; never block merge                                               |
| `escalate`             | Promote finding severity and strengthen the warning at the top of the PR comment        |
| `require_human_review` | In addition to the LLM review, explicitly require a human reviewer in the PR commentary |

## How the repo-wide context collector works

It gathers four sections from the changed files (implementation: `src/lib/repo-context.mjs`).

| Section    | Source                                            | Default cap      |
| ---------- | ------------------------------------------------- | ---------------- |
| `fullFile` | The changed files themselves (up to 5 files)      | about 3000 chars |
| `tests`    | Matching tests found via path heuristics          | about 2000 chars |
| `usages`   | Usage sites of exported symbols, grepped via `rg` | about 1500 chars |
| `config`   | Sibling config files (`.json` / `.yaml`)          | about 500 chars  |

The total cap defaults to 8000 chars (override with the `context.budget` key in `.river-review.yaml`, or with the `maxChars` argument of `collectRepoContext`). Each section is truncated from the tail with `// ...[truncated]`.

In environments without `rg` (ripgrep) the `usages` section becomes best-effort empty. Make sure ripgrep is installed on the CI runner (the standard GitHub Actions Ubuntu image already ships it).

### Tuning the context budget / ranking

The configuration keys introduced in `#689` let you tune the token-unit budget, the `reviewMode` preset, and the ranking score from `.river-review.yaml`. See `src/config/schema.mjs` for the full schema.

```yaml
# .river-review.yaml
context:
  reviewMode: medium # tiny | medium | large. Omit budget to apply the preset
  budget:
    maxTokens: 4000 # 256–64000. An explicit value overrides reviewMode
    maxChars: 8000 # 1024–200000. Both the char cap and the token cap apply
    perSectionCaps:
      fullFile: 3000
      tests: 2000
      usages: 1500
      config: 500
  ranking:
    enabled: true # Reorder candidates by proximity score against the changed files
    weights: # 0.0–1.0. Defaults to equal weighting if omitted
      pathProximity: 0.4
      symbolUsage: 0.3
      siblingTest: 0.2
      commitRecency: 0.1
```

Default `maxTokens` for `reviewMode` presets (`src/lib/context-presets.mjs`):

| reviewMode | maxTokens | Intended use                                                     |
| ---------- | --------- | ---------------------------------------------------------------- |
| `tiny`     | 1024      | Short prompts, CI regression, models with a tight context window |
| `medium`   | 4000      | Typical PR on gpt-4o-mini / sonnet-class models                  |
| `large`    | 16000     | Deep dives on large models                                       |

Ranking is composed of `pathProximity` / `symbolUsage` / `siblingTest` / `commitRecency` in `src/lib/context-ranker.mjs`, narrowing candidates by "closeness" to the changed files. The score breakdown is available at `reviewDebug.repoContextRanking`.

If you still feel the noise is high, the existing knobs continue to apply — strengthen `exclude.files` in `.river-review.yaml`, or apply `action: comment_only` to docs in `risk-map.yaml` to remove gating without dropping findings.

## Secret redaction and safe defaults

Files read by the repo-wide context collector and any string injected into the prompt are **redacted in multiple stages** before being sent to the LLM ([Issue #692](https://github.com/s977043/river-review/issues/692)).

The implementation centers on `src/lib/secret-redactor.mjs` and is wired into three places: `src/lib/repo-context.mjs`, `src/lib/local-runner.mjs`, and `src/lib/review-engine.mjs`.

### Path-level deny (rejected before reading)

Files such as `.env*`, key material like `*.pem` / `*.key` / `*.p12`, `secrets.*` / `credentials.*`, and various lock / build artifacts **never even enter process memory**. `shouldExcludeForContext` filters them up front via `DEFAULT_DENY_GLOBS`.

### Content redaction (masked after reading)

Files that pass the deny list go through `redactText` before reaching the prompt.

Detection categories:

- `githubToken` / `openaiKey` / `anthropicKey` / `googleApiKey`
- `awsAccessKey` / `awsSecretKey`
- `privateKey` (multi-line `-----BEGIN ... PRIVATE KEY-----` blocks)
- `bearerToken` / `databaseUrl` / `webhookUrl` (Slack/Discord) / `oauthSecret`
- `envAssignment` (assignments such as `API_KEY=...`)
- `highEntropy` (Shannon-entropy-threshold fallback for tokens of 24 chars or more)

Replacements use a length-independent `<REDACTED:category>` form, so suppression fingerprint stability (#687) is unaffected.

### Narrow the behavior via config

```yaml
# .river-review.yaml
security:
  redact:
    enabled: true # default
    categories:
      highEntropy: false # Disable the entropy fallback if false positives are noisy
    allowlist:
      - 'TESTFIXTURE' # Tokens that match are not redacted (protects fixed test values)
    denyFiles:
      - 'vendor/**' # Add to the default deny list
    entropyThreshold: 4.7 # default 4.5. Higher values loosen detection
```

### Defense in depth

The `prompt` and `debug.promptPreview` flowing into debug output / artifacts / the dashboard are passed through `redactText` again at the final stage. Even if a token leaks in via `additionalInstructions` or similar, only redacted strings remain in logs and artifacts. The prompt used for the LLM API call is the post-redaction version (the PR-C repository-context redaction), so raw tokens never reach the LLM either.

### Observability

`reviewDebug.repoContextSecurity = { redactionHits, excludedPaths }` carries the aggregates (per-category replacement counts and excluded paths). Raw tokens are never included.

## Adding cross-context skills

Cross-context skills bundle patterns that are hard to detect from a single changed file. The following are already shipped under `skills/midstream/rr-midstream-*-001/` (completed via [Issue #654](https://github.com/s977043/river-review/issues/654)).

- `rr-midstream-i18n-unused-key-001` — translation key removal vs. locale entry consistency
- `rr-midstream-normalization-consistency-001` — normalization drift in domain values (ID format, lowercasing, …)
- `rr-midstream-loading-state-001` — missed transitions in early return / loading state
- `rr-midstream-nullability-contract-001` — broken null/undefined contracts
- `rr-midstream-api-compatibility-001` — API compatibility breaks and missing tests

For the full procedure, see the [skill authoring guide](./write-a-skill.en.md). Key points:

1. Create `skills/midstream/rr-midstream-<your-skill>-001/SKILL.md` (YAML frontmatter + body).
2. Include `fullFile` in `inputContext` in addition to `diff` (this passes collector output to the LLM).
3. Place fixtures at `fixtures/01-should-detect.md` / `02-should-not-detect.md`.
4. Validate the schema with `npm run skills:validate`.

## Reading the P1 / P2 / P3 / P4 priorities

The severity emitted by the LLM (`critical` / `major` / `minor` / `info`) is mapped to P1–P4 for display in PR comments (implementation: `src/lib/finding-format.mjs:severityToPriority`).

| Display | severity   | Examples                                                           |
| ------- | ---------- | ------------------------------------------------------------------ |
| P1      | `critical` | Security vulnerability, risk of data loss, system-down possibility |
| P2      | `major`    | Critical bug, performance issue, major design flaw                 |
| P3      | `minor`    | Small bug, readability concern, minor optimization opportunity     |
| P4      | `info`     | Suggestion, reference information, additional considerations       |

The summary at the top of the PR comment highlights the P1 / P2 counts. Paths matched by `require_human_review` in `risk-map.yaml` are explicitly flagged as "human review required" in the PR ([Issue #652](https://github.com/s977043/river-review/issues/652)).

## False positive suppression memory

A mechanism that accumulates feedback such as "this was a false positive" or "accepted as risk" and prevents findings with the same fingerprint from recurring ([Issue #687](https://github.com/s977043/river-review/issues/687)).

### How it works

- Each finding has a stable 16-hex fingerprint via `computeFingerprint(ruleId + file + normalized message)` (implementation: `src/lib/finding-fingerprint.mjs`).
- Writing a `type: 'suppression'` entry into Riverbed Memory with the fingerprint and feedbackType makes subsequent findings with the same fingerprint automatically excluded from `findings`.
- The matching PR comment is also not posted (implementation: `src/lib/suppression-apply.mjs`, `src/lib/local-runner.mjs`).
- **P1 guard**: findings whose severity is `major` / `critical` are auto-suppressed only when `feedbackType=accepted_risk`.
- For other feedback types they are not suppressed; the observation log carries `reason: high-severity-requires-accepted-risk`.

### Adding a suppression via CLI

```bash
# --scope defaults to "file"; --pr is optional (source PR)
river suppression add \
  --fingerprint <16-hex> \
  --feedback <false_positive|accepted_risk|wont_fix|not_relevant|duplicate> \
  --rationale "<why suppress>" \
  --scope <global|subsystem|file> \
  --severity <info|minor|major|critical> \
  --files src/auth.ts,src/login.ts \
  --pr 123
```

Pick the fingerprint from the `--debug` output or `reviewDebug.suppressionsApplied`. Strict `<16-hex>` checks and feedbackType enum checks run up front, so typos exit with code 1.

### Temporarily disabling suppression via config

```yaml
# .river-review.yaml
memory:
  suppressionEnabled: false # default true. false bypasses every suppression (emergency debugging)
```

Bypassing keeps the Riverbed Memory entries intact. Switching back to `true` re-enables them immediately.

### When to use which feedbackType

| feedbackType     | Purpose                                                              | Auto-suppress major/critical |
| ---------------- | -------------------------------------------------------------------- | ---------------------------- |
| `false_positive` | The detection pattern is a misfire                                   | ❌                           |
| `accepted_risk`  | A known risk that the team consciously accepts                       | ✅                           |
| `wont_fix`       | Fix cost is too high, low priority                                   | ❌                           |
| `not_relevant`   | The rule does not apply to this codebase                             | ❌                           |
| `duplicate`      | Equivalent to an existing suppression (`--duplicate-of` alternative) | ❌                           |

## Running eval fixtures

Regression fixtures that "measure detection difference with vs. without context" are prepared in [Issue #688](https://github.com/s977043/river-review/issues/688) (fully landed in v0.28.0).

```bash
npm run eval:repo-context        # run repo-wide eval alone
npm run eval:all                 # integration driver (planner / fixtures / regression / meta / repo-context)
```

### Fixture structure

`tests/fixtures/repo-wide-eval/` ships these 8 cases:

| Case                            | Category      | Purpose                                                             |
| ------------------------------- | ------------- | ------------------------------------------------------------------- |
| `i18n-unused-key-01`            | i18n          | A removed translation key still present in a locale                 |
| `normalization-id-format-01`    | normalization | A call that bypasses the existing normalization helper              |
| `loading-state-early-return-01` | loading       | Null deref caused by removing the loading guard                     |
| `nullability-api-response-01`   | nullability   | Unsafe dereference of a nullable contract                           |
| `api-contract-no-test-01`       | api-compat    | Missing test update when adding a required field                    |
| `guard-future-use-comment`      | guard         | Replacing a TODO with a rationale (any finding is a false positive) |
| `guard-generated-file`          | guard         | Header update for a generated file                                  |
| `guard-related-test-updated`    | guard         | Source change shipped with the corresponding test in the same PR    |

For how to add a new fixture, see `tests/fixtures/repo-wide-eval/README.md`.

### Emitted metrics

The summary returned by `evaluateRepoWideFixtures` includes:

| Metric                                             | Meaning                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `detectionRateWith / detectionRateWithout`         | Share of detection cases that produced a finding (with / without context)                       |
| `contextLiftRate`                                  | Mean of `withCtx − withoutCtx` (positive means repo-wide context improves detection)            |
| `falsePositiveRateWith / falsePositiveRateWithout` | Share of guard cases that produced a false positive (ideal value is 0)                          |
| `categoriesCovered`                                | List of detected categories (i18n / normalization / loading / nullability / api-compat / guard) |

### Nightly drift detection

`.github/workflows/nightly-eval.yml` invokes `evaluate-all.mjs`, so repo-context metrics are automatically appended to the ledger at `artifacts/evals/results.jsonl`. Day-over-day changes serve as drift detection.

## Troubleshooting

### Context arrives empty

- Verify that `actions/checkout` has `fetch-depth: 0` (a shallow clone can break the collector).
- Verify that ripgrep exists on the runner (`which rg`); the standard GitHub Actions Ubuntu image ships it.
- Verify you are not stuck in `dry_run: true` (dry run skips the LLM and returns heuristic-only output, which yields thin findings).

### Comments do not get posted

- Make sure the workflow `permissions` include `pull-requests: write` and `issues: write`.
- Forked PRs do not propagate secrets, so to run review on external contributors' PRs you need to use `pull_request_target` or similar and implement it on the safe side ([github-actions guide](./github-actions.en.md)).

### Too many or too few findings

- Toggle `review.severity` between `strict` / `relaxed` in `.river-review.yaml`.
- Add noisy paths (generated artifacts, vendor) to `exclude.files`.
- Conversely, lift "I want this watched strictly" paths via `risk-map.yaml` `action: escalate`.

### The same finding keeps appearing

- Suppress individually with `river suppression add --fingerprint <hex> --feedback <type> --rationale "..."` (see the [suppression memory section](#false-positive-suppression-memory)).
- Document "this is permitted" under `## Forbidden Patterns` in `.river/rules.md` to suppress on the LLM side (a lighter alternative).

### Configuration is not picked up

- Run `river run . --dry-run --debug` to confirm load logs (useful for verifying `.river/rules.md` recognition).
- YAML syntax errors in `.river-review.yaml` surface as loader warnings (refer to the message when zod validation fails).

## Further reading

- [Review policy](../reference/review-policy.en.md) — Severity definitions and operational standards
- [Riverbed Memory](./use-riverbed-memory.en.md) — Where wontfix / suppression entries are stored
- [Skill authoring guide](./write-a-skill.en.md) — Procedure for adding cross-context skills
- [Tracing / Observability](./tracing.en.md) — Runtime metrics and debug output
