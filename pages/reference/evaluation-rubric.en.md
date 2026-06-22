# Evaluation Rubric (Multi-Dimensional Scoring)

River Review's evaluation framework provides a rubric to quantify review quality across multiple dimensions. Each dimension has an independent score, and a weighted sum produces the overall score.

> **Status**: This document is a specification. Runtime integration (wiring `dimensionScores` generation into `scripts/evaluate-review-fixtures.mjs` / `src/lib/review-fixtures-eval.mjs`) is tracked separately. At present only the schema, rubric definitions, and the consistency test (`tests/eval-rubric.test.mjs`) are implemented.

## Dimension List

| ID                    | Name                | Description                                                 | Weight | Scoring Method | Direction        | Automatable |
| --------------------- | ------------------- | ----------------------------------------------------------- | ------ | -------------- | ---------------- | ----------- |
| `detection_accuracy`  | Detection Accuracy  | Whether the review detected expected issues                 | 0.25   | ratio          | higher_is_better | Yes         |
| `false_positive_rate` | False Positive Rate | Proportion of erroneous findings on guard cases             | 0.20   | ratio          | lower_is_better  | Yes         |
| `evidence_quality`    | Evidence Quality    | Whether findings include Evidence labels                    | 0.15   | ratio          | higher_is_better | Yes         |
| `severity_alignment`  | Severity Alignment  | Whether assigned severity matches expectation               | 0.15   | ratio          | higher_is_better | Yes         |
| `phase_consistency`   | Phase Consistency   | Whether findings are consistent with the review phase       | 0.10   | binary         | higher_is_better | Yes         |
| `actionability`       | Actionability       | Whether findings include actionable improvement suggestions | 0.10   | manual         | higher_is_better | No          |
| `token_efficiency`    | Token Efficiency    | Output efficiency relative to the Context Budget            | 0.05   | ratio          | higher_is_better | Yes         |

Weights sum to 1.0 (validated by `tests/eval-rubric.test.mjs`).

## Direction (Sign Correction)

Each dimension declares a `direction` field indicating whether a higher or lower score is better. When computing the weighted sum, `lower_is_better` dimensions must be transformed via `(1 - score)` before summing.

- `higher_is_better` (default): a higher score is better.
- `lower_is_better`: a lower score is better (e.g. `false_positive_rate`).

## Scoring Methods

### binary

- 1 if the condition is met, 0 otherwise.
- Example: `phase_consistency` — whether the finding's phase matches the expected phase.

### ratio

- Continuous value from 0.0 to 1.0.
- Example: `detection_accuracy` — proportion of expected issues that were detected.

### manual

- Score requiring human evaluation.
- Not automatable (`automatable: false`).
- Example: `actionability` — subjective judgment on whether a finding is actionable.

## Schema

- Dimension definitions: `schemas/eval-rubric.schema.json`
- Evaluation result recording: `schemas/eval-ledger-entry.schema.json` (`dimensionScores` field)

### dimensionScores Structure

A `dimensionScores` array has been added to each evaluation entry.

```json
{
  "dimensionScores": [
    {
      "dimensionId": "detection_accuracy",
      "score": 0.85,
      "scoringMethod": "ratio",
      "details": "17/20 expected findings detected"
    },
    {
      "dimensionId": "actionability",
      "score": null,
      "scoringMethod": "manual",
      "details": "Pending human review"
    }
  ]
}
```

- `dimensionId` (string, required): Corresponds to `id` in `eval-rubric.schema.json`
- `score` (number | null, required): Score value. `null` when manual evaluation is pending.
- `scoringMethod` (string): Scoring method used (matches the rubric's `scoringMethod`).
- `details` (string): Supplementary explanation.

## Relationship to Existing Fixtures

The `dimensions` section in `docs/eval/rubric.yaml` coexists with the existing `severity` and `phase` sections. Fixtures (`tests/fixtures/review-eval/cases.json`) fields such as `mustInclude` and `expectNoFindings` remain valid; multi-dimensional scoring functions as an additional layer.

- Fixture `mustInclude` maps primarily to `detection_accuracy` and `evidence_quality` validation.
- Fixture `expectNoFindings` maps to `false_positive_rate` validation.
- Fixture `maxFindings` serves as an indirect indicator for `token_efficiency`.

## Trade-offs and Limitations

- **Fixed weights**: Current weights are set heuristically and have not been optimized with real data. Future work may apply Bayesian optimization or grid search for tuning.
- **Scalability of manual dimensions**: `actionability` requires human evaluation and becomes a bottleneck in large-scale CI runs. Medium-term plans include exploring LLM-as-a-Judge as an alternative.
- **Binary granularity**: `phase_consistency` is binary, which cannot express partial matches for cases spanning multiple phases. Migration to ratio is worth considering.
- **token_efficiency baseline**: If the Context Budget definition changes, the calculation method for this dimension must also be updated.

## Related Files

- `docs/eval/rubric.yaml`
- `schemas/eval-rubric.schema.json`
- `schemas/eval-ledger-entry.schema.json`
- `pages/reference/evaluation-fixture-format.en.md`
