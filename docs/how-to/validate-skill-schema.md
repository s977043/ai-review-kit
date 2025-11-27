# Validate Skill Schema

Use the schema and validator to keep skills consistent across Upstream, Midstream, and Downstream checks.

## Steps

1. Edit or add a skill under `skills/`.
2. Run the validator:

```bash
npm run agents:validate
```

3. If validation fails, check that required fields from `/schemas/skill.schema.json` are present: `id`, `name`, `description`, `phase`, and `applyTo`.
4. Confirm `phase` matches the intended flow segment and adjust `applyTo` globs to avoid noisy matches.
5. Re-run the validator until you get a clean pass, then include the command output in your PR.

## Tips

- Keep tags and severity aligned with how you want findings prioritized.
- Add small sample files and open a draft PR to see how the reviewer routes the skill.
