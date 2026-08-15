---
title: Representative Skills Showcase
---

This page introduces why River Review skills matter, how they work, and what output they return, using real skills that ship with the repository. Use it as a starting point when designing a new skill, or when you want a reference for how existing skills are written.

For the concept of a skill itself see [Skills: The Heart of River Review](../explanation/skills.en.md), and for an index of every skill see the [Skills Catalog](../reference/skills-catalog.en.md).

Each skill is walked through in the same order:

1. The skill's purpose and why it was chosen
2. An excerpt of the `SKILL.md` frontmatter
3. The core of the review instruction
4. An example fixture (the code it is meant to detect)
5. A sample of the expected output
6. The false-positive avoidance rules

## Skill 1: Logging and Observability Guard

Its ID is `logging-observability`, and it runs in the midstream phase.

### Purpose and Why It Was Chosen

This skill detects swallowed exceptions and `catch` blocks without logging, keeping the code in a state where the cause of an incident can still be traced. Swallowing exceptions buries failures silently, which is why it was picked as a representative review perspective for observability.

### Frontmatter Excerpt

```yaml
id: logging-observability
name: Logging and Observability Guard
description: Ensure code changes keep logs/metrics/traces useful for debugging failures and regressions.
category: midstream
applyTo:
  - 'src/**/*.{ts,tsx,js,jsx,mjs,cjs}'
tags: [observability, logging, reliability, midstream]
severity: minor
inputContext: [diff]
dependencies: [tracing, code_search]
```

`severity` is `minor`. Missing observability is not a defect in itself, but it lowers debuggability in production, so it is worth flagging.

### The Core of the Review Instruction

`prompt/system.md` looks for three things:

- Whether the logs, metrics, and traces needed to trace the cause of a failure are present and not excessive
- Whether exceptions are handled with context (a requestId, a summary of the input) instead of being swallowed
- Whether retry / fallback / cache branches emit hit / miss / attempt signals

It does not weigh in on choosing a logging platform or on detailed design. Findings stay within what the diff shows.

### Example Fixture

`fixtures/01-silent-catch.diff` targets an empty `catch` with neither logging nor a rethrow.

```diff
+  } catch (error) {
+    // ignore
+  }
+}
```

### Expected Output Sample

`golden/01-silent-catch-happy.md` pins the finding for that fixture. The golden output is written in Japanese because review comments are returned in Japanese by default:

```text
src/services/user.ts:16: 例外が握りつぶされています。障害時に原因追跡が困難になります。
Fix: logger.error でエラーをログし、throw error で再送出するか、適切にハンドルしてください。
```

A finding takes the form `file:line: description. Fix: suggestion`. `severity` is `minor` or `major`, and `confidence` is one of high / medium / low.

### False-positive Avoidance Rules

The skill stays silent in these cases:

- The `catch` block logs, or propagates upward with `throw` or `return Promise.reject(...)`
- The ignore is clearly deliberate and carries a comment explaining why
- The ignore is intentional and lives in test code

`golden/02-proper-error-handling.md` pins the behavior of returning `NO_ISSUES` for code that has context-aware logging and a rethrow. A pre-execution gate additionally returns `NO_REVIEW` for diffs unrelated to observability.

## Skill 2: Coverage and Failure Path Gaps

Its ID is `coverage-gap`, and it runs in the downstream phase.

### Purpose and Why It Was Chosen

This skill detects missing tests for critical paths and failure flows in changed code. A change without tests is how regressions slip through, so it was chosen as a downstream quality gate.

### Frontmatter Excerpt

```yaml
id: coverage-gap
name: Coverage and Failure Path Gaps
description: Find missing tests for critical paths, edge cases, and failure handling in changed code.
category: downstream
applyTo:
  - 'src/**/*'
  - 'lib/**/*'
  - '**/*.test.*'
  - '**/*.spec.*'
tags: [tests, coverage, reliability, downstream]
severity: major
inputContext: [diff, tests]
dependencies: [test_runner, coverage_report]
```

`severity` is `major`. A missing test on a failure flow leads straight to a regression, so it carries a higher severity than missing logging.

### The Core of the Review Instruction

The Rule in `SKILL.md` checks three things:

- Whether both the main flow and the failure flow have tests
- Whether error handling — exceptions, timeouts, retries — is tested
- Whether the branches, boundary values, and fallbacks introduced by the change are covered

It does not go as far as rewriting existing tests wholesale or designing chaos experiments.

### Example Fixture

This skill detects through heuristics rather than fixture files. The typical signals are:

- A new conditional or guard was added, but no corresponding test exists
- No assertion is visible for exception handling or an error return
- A critical path such as authentication, billing, or data persistence lacks tests

### Expected Output Sample

Findings are tied to the diff and come with the evidence and the next action. Suggestions are phrased like this:

```text
新規/変更された分岐ごとに正常系・異常系のテストを追加してください（例外メッセージも検証）。
タイムアウト/リトライ/フォールバックをモックし、意図した失敗動作を確認してください。
```

### False-positive Avoidance Rules

The skill stays silent in these cases:

- Existing tests already cover an equivalent failure path sufficiently
- The change only tracks an external API spec change and adds no execution branch to in-house code

A pre-execution gate returns `NO_REVIEW` for diffs that do not affect the execution path, such as comment-only or documentation-only changes.

## Next Steps

- When writing a new skill, see the [Skill Authoring Guide](./write-a-skill.en.md).
- For selecting and combining skills, see [Choosing and Combining Skills](./choose-skills.en.md).
- For schema details, see the [Skill Schema Reference](../reference/skill-schema.en.md).
