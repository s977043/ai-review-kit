# Runner CLI Reference

Use the Runner CLI to validate River Reviewer agents and skills locally or in CI.

## Commands

- Agents: `npm run agents:validate` (or `node scripts/validate-agents.mjs`)
- Skills: `npm run skills:validate` (or `node scripts/validate-skills.mjs`)

## Exit codes

- `0`: validation completed successfully.
- `1`: schema checks did not pass or a schema error occurred.

## Examples

```bash
# Validate all agents
npm run agents:validate

# Validate all skills
npm run skills:validate
```
