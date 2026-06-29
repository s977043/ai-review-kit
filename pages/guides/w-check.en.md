# W-Check (Double Review) Guide

## Overview

**W-check** (double review) is a feature that passes existing review results from other AI reviewers or human reviewers into River Review for re-verification. River Review cross-references the provided review results against the PR diff, validates the reality of each finding, and outputs a consolidated merge recommendation.

Typical use cases:

- Merge a Claude Code review with a Codex review to catch blind spots each reviewer may have missed
- Cross-check a human reviewer's findings against an AI review to remove hallucinated references
- Triage results from multiple AI tools run in parallel into a single, consolidated output

## Quick Start

This section walks through the minimal steps to run a W-check from scratch.

### Step 1: Save your AI review outputs as Markdown files

After running each AI reviewer (Codex, Gemini, etc.), save the output as a Markdown file:

```bash
# Example: save outputs from two AI reviewers
codex review > codex-review.md
# (or copy/paste the output manually)
```

### Step 2: Place the files in `.river/reviews/`

```bash
mkdir -p .river/reviews
cp codex-review.md   .river/reviews/codex.md
cp gemini-review.md  .river/reviews/gemini.md
# Optionally add your own self-review
cp self-review.md    .river/reviews/self.md
```

### Step 3: Run `river review exec`

```bash
river review exec \
  --ensemble .river/reviews/ \
  --phase midstream
```

Use `--artifact review-self=<path>` if your self-review is stored separately and should be tracked with the `self-review` provenance label.

### Step 4: Interpret the verdict

The synthesis skill emits one of three verdicts in `summary.notes`:

| Verdict        | Meaning                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `merge-ready`  | No confirmed critical or major findings. Safe to merge.                      |
| `human-review` | One or more major findings confirmed. Human review recommended before merge. |
| `block`        | One or more critical findings confirmed. Merge blocked until resolved.       |

> **Degraded mode**: W-check runs even if only one artifact is provided (e.g., `--ensemble` only, with no `--artifact review-self`). Synthesis accuracy is lower because cross-validation between reviewer types is skipped.

## Artifact Specification

W-check accepts two artifact types as input: `review-self` and `review-external`.

| Field               | `review-self`                                          | `review-external`                                      |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Role                | Implementer's own self-review                          | Output from an external AI or human reviewer           |
| Format              | UTF-8 Markdown free-form (no specific schema required) | UTF-8 Markdown free-form (no specific schema required) |
| Required / Optional | Optional                                               | Optional                                               |
| On missing          | W-check skills skip that input                         | W-check skills skip that input                         |
| Internal provenance | Tracked as `self-review`                               | Tracked as `ai-review` or `human-review`               |

Both artifacts are optional. W-check will still run if only one is provided (degraded mode), but having both enables higher-fidelity synthesis.

For full details, see the `review-self` / `review-external` section in [`pages/reference/artifact-input-contract.md`](../reference/artifact-input-contract.md).

## Running via CLI

### Pattern 1: Specify files individually

```bash
river review exec \
  --artifact review-self=./self-review.md \
  --artifact review-external=./codex-review.md \
  --phase midstream
```

### Pattern 2: Use `--ensemble` to pass a directory at once

Place multiple review result files in a directory and pass them all at once. `--ensemble` merges all `*.md` files in the specified directory in alphabetical order by filename and treats the result as the `review-external` artifact.

```bash
mkdir -p .river/reviews
# Place each review result .md in .river/reviews/
# e.g., .river/reviews/codex.md, .river/reviews/gemini.md, .river/reviews/human.md
river review exec \
  --ensemble .river/reviews/ \
  --phase midstream
```

If both `--artifact review-external` and `--ensemble` are specified, `--ensemble` takes precedence.

## Setting Up in GitHub Actions

GitHub Actions `inputs` do not yet have a built-in field for `review-self` / `review-external` (planned for a future release). As a workaround, you can call `runners/github-action/dist/index.mjs` directly to achieve equivalent behavior.

> **Warning**: Do not pass review content through environment variables (e.g., `echo "$REVIEW" > file.md`). GitHub Actions environment variables have a **48 KB silent truncation limit** — large review outputs will be silently cut off without any error, producing incomplete results.
> **Note**: `github.action_path` is only valid inside a composite action. Do not use it directly from a caller workflow — it will resolve incorrectly.

Use the `upload-artifact` / `download-artifact` pattern to safely transfer review files between jobs:

```yaml
jobs:
  ai-reviews:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Run AI reviews
        run: |
          mkdir -p .river/reviews
          # Run each AI reviewer and save output to .river/reviews/
          # e.g., codex review > .river/reviews/codex.md
          #        gemini review > .river/reviews/gemini.md

      - name: Upload review artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ai-reviews
          path: .river/reviews/

  w-check:
    runs-on: ubuntu-latest
    needs: ai-reviews
    steps:
      - uses: actions/checkout@v6

      - name: Download review artifacts
        uses: actions/download-artifact@v4
        with:
          name: ai-reviews
          path: .river/reviews/

      - name: Run W-check
        run: |
          node runners/github-action/dist/index.mjs run . \
            --phase midstream \
            --ensemble .river/reviews/
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## How the Synthesis Skill Works

The synthesis step of W-check is handled by the `independent-review-synthesis` skill (`recommended: true`). It operates in three main steps:

1. **Deduplicate**: When multiple reviewers flag the same location, findings are merged into a single entry based on file path, line range, and evidence text similarity.
2. **Hallucination guard**: Each finding's `evidence` is checked against the actual diff and source files. Findings that reference non-existent code are classified as `dismissed-hallucination` and excluded from the final output.
3. **Merge recommendation**: Based on the presence of confirmed critical / major findings, the skill emits one of `merge-ready`, `human-review`, or `block`.

### Output Example

The following is an example of the JSON structure emitted by the synthesis skill (field names are defined in [`schemas/output.schema.json`](../../schemas/output.schema.json)):

```json
{
  "summary": {
    "issueCountBySeverity": { "critical": 1, "major": 0, "minor": 1, "info": 0 },
    "issueCountByPhase": { "upstream": 0, "midstream": 2, "downstream": 0 },
    "notes": "verdict: block — confirmed critical finding present"
  },
  "issues": [
    {
      "id": "w-001",
      "ruleId": "independent-review-synthesis",
      "title": "Possible SQL injection",
      "message": "User input is interpolated directly into the query. Switch to parameterized binding.",
      "severity": "critical",
      "phase": "midstream",
      "file": "src/db/query.ts",
      "line": 42,
      "status": "verified",
      "evidence": ["+ const sql = `SELECT * FROM users WHERE id = ${userInput}`"]
    },
    {
      "id": "w-002",
      "ruleId": "independent-review-synthesis",
      "title": "Reference to non-existent function",
      "message": "The validateInput() function cited by the reviewer does not appear in the diff and has been excluded.",
      "severity": "minor",
      "phase": "midstream",
      "file": "src/utils/validate.ts",
      "line": 10,
      "status": "suppressed",
      "evidence": []
    }
  ]
}
```

`status: "verified"` means the finding was confirmed against the actual diff. `status: "suppressed"` means the finding was excluded (e.g., hallucinated reference). The verdict (`merge-ready` / `human-review` / `block`) is recorded in `summary.notes`. For the complete output schema, see [`schemas/output.schema.json`](../../schemas/output.schema.json).

Full skill reference: [`skills/midstream/independent-review-synthesis/SKILL.md`](https://github.com/s977043/river-review/blob/main/skills/midstream/independent-review-synthesis/SKILL.md)

## Related Pages

- [Artifact Input Contract](../reference/artifact-input-contract.md) — full specification of `review-self` / `review-external`
- [Independent Review Synthesis skill](https://github.com/s977043/river-review/blob/main/skills/midstream/independent-review-synthesis/SKILL.md) — complete synthesis skill rules
- [GitHub Actions Setup](./github-actions.md) — basic GitHub Actions configuration
