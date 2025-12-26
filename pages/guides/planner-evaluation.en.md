# Mini-guide for Skill Planner Evaluation and Optimization

## Purpose

- Visualize Planner output quality and create an improvement baseline.
- Enable simple diff evaluation when changing LLM prompts or heuristics.

## Unit of Evaluation

- Compare expected order (`expectedOrder`) vs Planner output (`plan` or LLM response) per case.
- Metrics (Simplified):
  - `exactMatch`: Percentage of exact matches with expected order
  - `top1Match`: Percentage where the first element matches
- `coverage`: Percentage of IDs in expected list that are included in output
  - `MRR`: Mean Reciprocal Rank of the expected top ID

## Usage

1. Prepare evaluation cases
   Describe `skills` / `context` / `plan` / `expectedOrder` in `tests/fixtures/planner-eval-cases.json`.
   - If `plan` is unspecified, `expectedOrder` is used as the LLM response (for offline evaluation).

2. Run evaluation

   ```bash
   npm run planner:eval  # Evaluates the above fixture by default
   # Or specify a custom fixture
   node scripts/evaluate-planner.mjs path/to/your-cases.json
   ```

3. Output
   - Summary (count, exactMatch/top1/coverage/MRR) and details for each case are printed to stdout.

## Implementation Notes

- Core: `src/lib/planner-eval.mjs` (Calls `planSkills` and calculates metrics)
- CLI: `scripts/evaluate-planner.mjs`
- Sample: `tests/fixtures/planner-eval-cases.json`
- Tests: `tests/planner-eval.test.mjs` (Verifies metric calculation validity)

## Improvement Ideas (Future)

- Expand evaluation metrics (Normalized DCG, etc.)
- Mechanism to capture and replay actual LLM responses
- Mechanism to fix representative PR / diff sets and compare snapshots
