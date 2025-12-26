# Evaluation Fixture Format (fixtures-based eval)

River Reviewer supports evaluation using fixtures (input and expectation) to continuously check the quality of review output against diffs. This page defines the fixture format and usage of the evaluation runner.

## Purpose

- Automatically validate consistency of skill output format (Labels, Severity/Confidence).
- Check mandatory phrases (must_include) for representative changes.
- Early detection of breaking changes via continuous evaluation (Local/CI).

## Input Format (cases.json)

Fixtures are defined in JSON. Default load path is `tests/fixtures/review-eval/cases.json`.

Each case has the following fields:

- `name` (string): Case name
- `phase` (string, optional): Applied phase (e.g., `upstream`/`midstream`/`downstream`)
- `diffFile` (string): Relative path to Unified Diff format file (Relative from `cases.json`)
- `planSkills` (string[]): Skill IDs to apply in this case (Simple plan)
- `mustInclude` (string[]): Phrases that must be included in output (AND condition)
- `expectNoFindings` (boolean, optional): `true` if expecting zero findings
- `minFindings` (number, optional): Minimum findings (0 if `expectNoFindings` is `true`)
- `maxFindings` (number, optional): Maximum findings limit

### Example

```json
{
  "name": "secrets: hardcoded token (export const)",
  "phase": "midstream",
  "diffFile": "../planner-dataset/diffs/midstream-security-hardcoded-token.diff",
  "planSkills": ["rr-midstream-security-basic-001"],
  "mustInclude": [
    "Finding:",
    "Evidence:",
    "Fix:",
    "GitHub Secrets",
    "Severity: blocker",
    "Confidence: high"
  ],
  "maxFindings": 3
}
```

## How to Run (Local)

- Install dependencies: `npm ci`
- Run: `npm run eval:fixtures`
  - Option: `--cases <path>` (Default: `tests/fixtures/review-eval/cases.json`)
  - Option: `--phase <upstream|midstream|downstream>` (Override `phase` for each case)
  - Option: `--verbose` (Detailed logs)

The evaluation runner entity is `scripts/evaluate-review-fixtures.mjs`, calling `src/lib/review-fixtures-eval.mjs` internally.

## Judgment Specifications

- Output Format Validation: Check consistency of `Finding:`/`Evidence:`/`Fix:` and `Severity:`/`Confidence:`.
- Finding Count: Between `minFindings` and `maxFindings`.
- Phrase Check: All phrases in `mustInclude` must be present.

Returns exit code 1 if any check fails.

## CI Integration (Optional)

Execution in GitHub Actions is optional. To integrate, add a step like:

```yaml
- name: Evaluate review fixtures
  run: npm run eval:fixtures -- --verbose
```

Job fails if `must_include` expectations are not met.

## Known Limitations

- Evaluates heuristic output only, without LLM (`dryRun: true`).
- `planSkills` accepts only IDs (Mocking metadata minimally).
- Diff optimization is not performed; evaluates hunks in fixture as-is.

## Related Files

- `scripts/evaluate-review-fixtures.mjs`
- `src/lib/review-fixtures-eval.mjs`
- `tests/fixtures/review-eval/cases.json`
