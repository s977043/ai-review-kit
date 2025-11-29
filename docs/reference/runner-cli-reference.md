# Runner CLI Reference

Use the Runner CLI to validate River Reviewer agents and skills locally or in CI. A lightweight Python runner is also available
to emit structured review output that follows `schemas/output.schema.json` (install dependency with `pip install jsonschema`).

## Commands

- Agents: `npm run agents:validate` (or `node scripts/validate-agents.mjs`)
- Skills: `npm run skills:validate` (or `node scripts/validate-skills.mjs`)
- Structured output (Python): `python scripts/rr_runner.py --input tests/fixtures/structured-output/sample_llm_response.json`

## Exit codes

- `0`: validation completed successfully.
- `1`: schema checks did not pass or a schema error occurred.

## Examples

```bash
# Validate all agents
npm run agents:validate

# Validate all skills
npm run skills:validate

# Build structured review output (writes to artifacts/river-review-output.json)
python scripts/rr_runner.py --input tests/fixtures/structured-output/sample_llm_response.json
```
