# Runner CLI Reference

Use the Runner CLI to execute River Reviewer skills locally or in CI.

## Commands

- `npm run agents:validate`: validates skills against `/schemas/skill.schema.json`.
- `node scripts/validate-agents.mjs [options]`: run the validator directly with custom flags.

## Options

| Flag | Description |
| --- | --- |
| `--phase <upstream\|midstream\|downstream>` | Limit validation or execution to a single phase. |
| `--files <glob>` | Validate only skills that match files in the provided glob. |
| `--schema <path>` | Use a custom schema file instead of the default. |
| `--format <text\|json>` | Control output format for CI logs. |

## Exit codes

- `0`: validation completed successfully.
- `1`: validation failed or a schema error occurred.

## Examples

```bash
# Validate all skills
npm run agents:validate

# Validate only upstream skills that touch docs
node scripts/validate-agents.mjs --phase upstream --files \"docs/**/*\"
```
