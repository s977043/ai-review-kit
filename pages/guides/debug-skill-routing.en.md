# Debug Skill Routing

When a skill doesn't trigger (or triggers too often), walk through these checks.

## Checklist

1. **Schema**: confirm the skill passes `npm run skills:validate`.
2. **Phase**: ensure `phase` matches the files being changed (Upstream/Midstream/Downstream).
3. **applyTo globs**: verify the patterns match the paths in your PR. Use a minimal test file that should trigger the skill.
4. **Severity/tags**: check whether filters in the runner use tags or severity that might exclude the skill.
5. **Recent changes**: review git history for the skill file to see if routing logic changed.

## Quick test

Open a draft PR that modifies a file matching the skill's `applyTo` glob. If no findings appear, add debug logging or temporarily narrow the glob to a single known path, then re-run the workflow.
