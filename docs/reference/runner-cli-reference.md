# Runner CLI Reference

Use the Runner CLI to validate River Reviewer agents locally or in CI.

## Commands

- `npm run agents:validate`: runs schema checks for bundled agents.
- `node scripts/validate-agents.mjs`: run the validator directly (no CLI options).

## Exit codes

- `0`: validation completed successfully.
- `1`: schema checks did not pass or a schema error occurred.

## Examples

```bash
# Validate all skills
npm run agents:validate

# Validate all skills directly
node scripts/validate-agents.mjs
```
